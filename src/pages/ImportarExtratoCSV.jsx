import { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDt = d => {
  if (!d) return '—'
  const p = String(d).split('T')[0].split('-')
  if (p.length !== 3) return d
  return `${p[2]}/${p[1]}/${p[0]}`
}

const G = { g1: '#0D3D20', g2: '#145C30', g3: '#1A7A3E', g6: '#A8DCBA', g7: '#E8F5ED' }
const GRAY = { 0: '#0F172A', 1: '#1E293B', 2: '#475569', 3: '#94A3B8', 5: '#E2E8F0', 6: '#F1F5F9' }
const RED = '#DC2626'
const ORANGE = '#D97706'

const cardStyle = { background: '#fff', border: '1px solid #D4E6DA', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }
const inputStyle = { border: '1.5px solid ' + GRAY[5], borderRadius: 10, padding: '0 12px', fontSize: 13, color: GRAY[0], background: GRAY[6], height: 36 }
const labelStyle = { fontSize: 10, fontWeight: 700, color: GRAY[2], textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5, display: 'block' }
const thStyle = { padding: '9px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: G.g6, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }
const tdStyle = { padding: '8px 12px', borderBottom: '1px solid ' + GRAY[6], fontSize: 12.5 }
const btnPrimary = { height: 38, padding: '0 16px', borderRadius: 10, border: 'none', background: G.g3, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnGhost = { height: 38, padding: '0 16px', borderRadius: 10, border: '1px solid #D4E6DA', background: GRAY[6], color: GRAY[1], fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const badge = (bg, color, border) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: bg, color, border: '1px solid ' + border })

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ ...cardStyle, padding: '16px 18px' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'monospace', color: color || GRAY[0] }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY[3], marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Parser de CSV simples e tolerante — detecta ; ou , como separador, e mapeia
// colunas por nome (Data, Valor, Descrição), na ordem que estiverem no arquivo.
function parseCSV(text) {
  const linhas = text.split(/\r?\n/).filter(l => l.trim())
  if (!linhas.length) return []
  const sepConta = (linha, sep) => linha.split(sep).length
  const sep = sepConta(linhas[0], ';') > sepConta(linhas[0], ',') ? ';' : ','

  const splitLinha = (linha) => {
    // split simples respeitando aspas
    const out = []
    let atual = '', dentroAspas = false
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]
      if (c === '"') dentroAspas = !dentroAspas
      else if (c === sep && !dentroAspas) { out.push(atual); atual = '' }
      else atual += c
    }
    out.push(atual)
    return out.map(s => s.trim().replace(/^"|"$/g, ''))
  }

  const header = splitLinha(linhas[0]).map(h => normalizar(h))
  const idxData = header.findIndex(h => h.includes('data') || h.includes('date'))
  const idxValor = header.findIndex(h => h.includes('valor') || h.includes('amount') || h.includes('montante'))
  const idxDesc = header.findIndex(h => h.includes('descri') || h.includes('histor') || h.includes('memo'))

  if (idxValor < 0) return [] // sem coluna de valor não dá pra continuar

  const parseValor = (v) => {
    if (!v) return 0
    let s = String(v).trim().replace(/[R$\s]/g, '')
    // se tem vírgula como decimal (formato BR), remove pontos de milhar e troca vírgula por ponto
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    return parseFloat(s) || 0
  }

  const parseData = (v) => {
    if (!v) return ''
    const s = String(v).trim()
    // DD/MM/YYYY
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    // YYYY-MM-DD já ok
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    return ''
  }

  return linhas.slice(1).map(linha => {
    const cols = splitLinha(linha)
    const valor = parseValor(cols[idxValor])
    if (!valor) return null
    return {
      data: idxData >= 0 ? parseData(cols[idxData]) : '',
      valor: Math.abs(valor),
      descricao: idxDesc >= 0 ? cols[idxDesc] : '',
    }
  }).filter(Boolean)
}

// Sugere um médico pra cada transação, comparando o valor com os repasses esperados nas notas.
function sugerirMedicos(linhasCsv, notas) {
  const alvos = []
  notas.forEach(n => (n.medicos_nota || []).forEach(mn => {
    if (mn.repasse) alvos.push({ nome: mn.nome, valor: mn.repasse, nf: n.nf })
  }))

  return linhasCsv.map(l => {
    const candidatos = alvos.filter(a => Math.abs(a.valor - l.valor) <= Math.max(0.02, l.valor * 0.005))
    let sugestao = null
    if (candidatos.length === 1) sugestao = candidatos[0]
    else if (candidatos.length > 1) {
      const nomeNaDesc = candidatos.find(c => normalizar(l.descricao).includes(normalizar(c.nome).split(' ')[0]))
      sugestao = nomeNaDesc || null
    }
    return { ...l, medico: sugestao?.nome || '', nf: sugestao?.nf || '', ambiguo: candidatos.length > 1 && !sugestao }
  })
}

export function ImportarExtratoCSV({ notas = [], medicos = [], extratoBancario = [], onRefresh }) {
  const { toast } = useToast()
  const [linhas, setLinhas] = useState([])
  const [loading, setLoading] = useState(false)
  const [buscaMedico, setBuscaMedico] = useState('')
  const fileRef = useRef()

  const medicosOrdenados = useMemo(() => [...medicos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [medicos])

  function processarArquivo(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result)
      if (!parsed.length) { toast('Não encontrei nenhuma linha com valor válido no CSV.', 'error'); return }
      const comSugestao = sugerirMedicos(parsed, notas)
      setLinhas(comSugestao)
      const sugeridos = comSugestao.filter(l => l.medico).length
      toast(`${parsed.length} transação(ões) importada(s) · ${sugeridos} com sugestão automática`)
    }
    reader.onerror = () => toast('Erro ao ler o arquivo.', 'error')
    reader.readAsText(file, 'ISO-8859-1')
  }

  function atualizarLinha(i, campo, valor) {
    setLinhas(prev => prev.map((l, j) => j === i ? { ...l, [campo]: valor } : l))
  }

  function removerLinha(i) {
    setLinhas(prev => prev.filter((_, j) => j !== i))
  }

  async function salvarTudo() {
    const validas = linhas.filter(l => l.medico)
    if (!validas.length) { toast('Preencha o médico de pelo menos uma linha antes de salvar.', 'error'); return }
    setLoading(true)
    let sucesso = 0, falhas = 0
    for (const l of validas) {
      try {
        const { error } = await supabase.from('extrato_bancario').insert({
          data: l.data || null, valor: l.valor, descricao: l.descricao || null,
          medico_nome: l.medico, nf: l.nf || null, conferido: true,
        })
        if (error) throw error
        sucesso++
      } catch (e) { falhas++ }
    }
    setLoading(false)
    toast(`${sucesso} transação(ões) salva(s)${falhas ? ` · ${falhas} falha(s)` : ''}`)
    setLinhas(prev => prev.filter(l => !l.medico))
    if (onRefresh) onRefresh()
  }

  async function excluirSalva(id) {
    if (!window.confirm('Excluir esta transação do extrato salvo?')) return
    await supabase.from('extrato_bancario').delete().eq('id', id)
    toast('Removida.')
    if (onRefresh) onRefresh()
  }

  // Agregação por médico do que já está salvo — essa é a fonte confiável de "quanto recebeu"
  const porMedico = useMemo(() => {
    const m = {}
    extratoBancario.forEach(e => {
      const nome = e.medico_nome || '(sem médico)'
      if (!m[nome]) m[nome] = { medico: nome, total: 0, qtd: 0, itens: [] }
      m[nome].total += e.valor || 0
      m[nome].qtd++
      m[nome].itens.push(e)
    })
    return Object.values(m)
      .filter(m => !buscaMedico || m.medico.toLowerCase().includes(buscaMedico.toLowerCase()))
      .sort((a, b) => a.medico.localeCompare(b.medico, 'pt-BR'))
  }, [extratoBancario, buscaMedico])

  const totalGeralSalvo = extratoBancario.reduce((a, e) => a + (e.valor || 0), 0)
  const [expandido, setExpandido] = useState(null)

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>📤 Importar extrato bancário (CSV)</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
            Importe o extrato do banco em CSV e associe manualmente cada transação a um médico (o sistema sugere quando o valor bate com algum repasse esperado, mas você sempre pode escolher outro). O que for salvo aqui fica guardado de verdade e vira a fonte confiável de "quanto cada médico recebeu".
          </div>
        </div>

        {/* Upload */}
        <div
          style={{ border: '2px dashed #D4E6DA', borderRadius: 14, padding: 32, textAlign: 'center', cursor: 'pointer', background: GRAY[6], marginBottom: 20 }}
          onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]) }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: GRAY[1] }}>Arraste o CSV do extrato aqui, ou clique para selecionar</div>
          <div style={{ fontSize: 11, color: GRAY[3], marginTop: 4 }}>Colunas esperadas: Data, Valor, Descrição (em qualquer ordem)</div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) processarArquivo(e.target.files[0]) }} />

        {/* Linhas importadas, aguardando confirmação */}
        {linhas.length > 0 && (
          <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: GRAY[0] }}>Transações importadas ({linhas.length})</span>
              <div style={{ flex: 1 }} />
              <button style={btnGhost} onClick={() => setLinhas([])}>Descartar todas</button>
              <button style={btnPrimary} onClick={salvarTudo} disabled={loading}>
                {loading ? 'Salvando…' : '✓ Salvar preenchidas'}
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr style={{ background: G.g1 }}>
                  <th style={thStyle}>Data</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
                  <th style={thStyle}>Descrição</th>
                  <th style={thStyle}>Médico</th>
                  <th style={thStyle}></th>
                </tr></thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i} style={{ background: l.medico ? '#F0FDF4' : l.ambiguo ? '#FFFBEB' : 'transparent' }}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{l.data ? fmtDt(l.data) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>R$ {brl(l.valor)}</td>
                      <td style={{ ...tdStyle, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.descricao}>{l.descricao || '—'}</td>
                      <td style={tdStyle}>
                        <input type="text" list="ie-med-datalist" value={l.medico} placeholder={l.ambiguo ? '⚠ vários possíveis, escolha' : 'Selecionar médico...'}
                          onChange={e => atualizarLinha(i, 'medico', e.target.value)}
                          style={{ ...inputStyle, width: 220, fontSize: 12 }} />
                      </td>
                      <td style={tdStyle}>
                        <button onClick={() => removerLinha(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: GRAY[3], fontSize: 14 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="ie-med-datalist">
                {medicosOrdenados.map(m => <option key={m.id} value={m.nome} />)}
              </datalist>
            </div>
          </div>
        )}

        {/* Resumo do que já foi salvo, por médico */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
          <Kpi label="Total já confirmado" value={`R$ ${brl(totalGeralSalvo)}`} sub={`${extratoBancario.length} transação(ões) salvas`} color={G.g2} />
          <Kpi label="Médicos com recebimento confirmado" value={porMedico.length} sub="via extrato bancário" />
        </div>

        <div style={{ ...cardStyle, padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="text" placeholder="🔍 Buscar médico..." value={buscaMedico} onChange={e => setBuscaMedico(e.target.value)}
            style={{ ...inputStyle, minWidth: 220 }} />
        </div>

        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
            Total recebido por médico (confirmado via extrato)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr style={{ background: G.g1 }}>
                <th style={thStyle}>Médico</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Nº transações</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Total recebido</th>
                <th style={{ ...thStyle, textAlign: 'center' }}></th>
              </tr></thead>
              <tbody>
                {porMedico.length === 0 && (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma transação confirmada ainda. Importe um CSV acima pra começar.</td></tr>
                )}
                {porMedico.map((m, i) => (
                  <>
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{m.medico}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.qtd}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: G.g2 }}>R$ {brl(m.total)}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button onClick={() => setExpandido(expandido === i ? null : i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: G.g3, fontSize: 12, fontWeight: 600 }}>
                          {expandido === i ? 'Ocultar' : 'Ver transações'}
                        </button>
                      </td>
                    </tr>
                    {expandido === i && (
                      <tr>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', background: GRAY[6] }}>
                            <thead><tr>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Data</th>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'right' }}>Valor</th>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>NF</th>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Descrição</th>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}></th>
                            </tr></thead>
                            <tbody>
                              {m.itens.map((it, j) => (
                                <tr key={j}>
                                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtDt(it.data)}</td>
                                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(it.valor)}</td>
                                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{it.nf || '—'}</td>
                                  <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 300 }}>{it.descricao || '—'}</td>
                                  <td style={tdStyle}>
                                    <button onClick={() => excluirSalva(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: 12 }}>✕ excluir</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

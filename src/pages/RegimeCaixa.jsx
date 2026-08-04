import { useMemo, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMes = m => {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  const ms = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${ms[+mo - 1]}/${y}`
}
const fmtDt = d => {
  if (!d) return '—'
  const p = d.split('T')[0].split('-')
  return `${p[2]}/${p[1]}/${p[0]}`
}

const G = { g1: '#0D3D20', g2: '#145C30', g3: '#1A7A3E', g4: '#22994D', g6: '#A8DCBA', g7: '#E8F5ED' }
const GRAY = { 0: '#0F172A', 1: '#1E293B', 2: '#475569', 3: '#94A3B8', 5: '#E2E8F0', 6: '#F1F5F9' }
const RED = '#DC2626'
const ORANGE = '#D97706'

const cardStyle = { background: '#fff', border: '1px solid #D4E6DA', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }
const inputStyle = { border: '1.5px solid ' + GRAY[5], borderRadius: 10, padding: '0 12px', fontSize: 13, color: GRAY[0], background: GRAY[6], height: 38, minWidth: 160 }
const labelStyle = { fontSize: 10, fontWeight: 700, color: GRAY[2], textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5, display: 'block' }
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: G.g6, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }
const tdStyle = { padding: '10px 14px', borderBottom: '1px solid ' + GRAY[6], fontSize: 12.5, whiteSpace: 'nowrap' }
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

// ── Parser OFX (mesmo formato usado no ExtratoOFX.jsx, Banco Inter / SGML Latin-1) ──
function parseOFX(text) {
  const transacoes = []
  const blocos = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || []
  blocos.forEach((bloco, i) => {
    const get = (tag) => {
      const match = bloco.match(new RegExp(`<${tag}>([^<\r\n]+)`, 'i'))
      return match ? match[1].trim() : ''
    }
    const tipo = get('TRNTYPE').toUpperCase()
    const valorStr = get('TRNAMT').replace(',', '.')
    const valor = parseFloat(valorStr) || 0
    const dtRaw = get('DTPOSTED')
    const memo = get('MEMO') || get('NAME') || ''
    const nome = get('NAME') || ''
    const fitid = get('FITID') || `T${i}`
    let data = ''
    if (dtRaw.length >= 8) data = `${dtRaw.substring(0, 4)}-${dtRaw.substring(4, 6)}-${dtRaw.substring(6, 8)}`
    if (valor !== 0) {
      transacoes.push({
        id: fitid, valor, data,
        memo: memo.replace(/["]/g, '').trim(),
        nome: nome.trim(),
        tipo: valor > 0 ? 'credito' : 'debito',
        trntype: tipo,
      })
    }
  })
  return transacoes
}

function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Cruza débitos do extrato com os médicos de cada nota fiscal ainda não marcada como "Paga ao médico"
function cruzarDebitosComNotas(transacoes, notas) {
  const MARGEM = 0.02
  const debitos = transacoes.filter(t => t.tipo === 'debito')
  const usados = new Set() // índices de transações já usadas em algum match

  const notasRelevantes = notas.filter(n => n.status !== 'Paga ao médico' && (n.medicos_nota || []).length)

  const resultado = notasRelevantes.map(nota => {
    const medicosStatus = (nota.medicos_nota || []).map(mn => {
      const valorAlvo = mn.repasse || 0
      const nomeAlvoNorm = normalizar(mn.nome).split(' ')[0]

      const candidatos = debitos
        .map((t, idx) => ({ t, idx }))
        .filter(({ t, idx }) => !usados.has(idx) && Math.abs(Math.abs(t.valor) - valorAlvo) <= Math.max(MARGEM, valorAlvo * 0.005))

      let melhor = null
      if (candidatos.length === 1) melhor = candidatos[0]
      else if (candidatos.length > 1) {
        melhor = candidatos.find(({ t }) => normalizar(t.nome || t.memo).includes(nomeAlvoNorm)) || candidatos[0]
      }

      if (melhor) usados.add(melhor.idx)

      return {
        nome: mn.nome,
        valor: valorAlvo,
        transacao: melhor?.t || null,
        pago: !!melhor,
      }
    })

    const totalMedicos = medicosStatus.length
    const pagos = medicosStatus.filter(m => m.pago).length

    return {
      nota, medicosStatus, totalMedicos, pagos,
      completo: totalMedicos > 0 && pagos === totalMedicos,
    }
  }).filter(r => r.pagos > 0) // só mostra notas com pelo menos 1 médico identificado no extrato

  resultado.sort((a, b) => (b.completo - a.completo) || (b.pagos / b.totalMedicos - a.pagos / a.totalMedicos))
  return resultado
}

// Cruza débitos do extrato com TODAS as notas (independente do status) e agrega por médico,
// para conferir quanto cada médico realmente recebeu segundo o banco.
function cruzarDebitosPorMedico(transacoes, notas) {
  const MARGEM = 0.02
  const debitos = transacoes.filter(t => t.tipo === 'debito')
  const usados = new Set()

  const linhas = [] // uma linha por (médico, nota)
  notas.forEach(nota => {
    ;(nota.medicos_nota || []).forEach(mn => {
      const valorAlvo = mn.repasse || 0
      if (!valorAlvo) return
      const nomeAlvoNorm = normalizar(mn.nome).split(' ')[0]

      const candidatos = debitos
        .map((t, idx) => ({ t, idx }))
        .filter(({ t, idx }) => !usados.has(idx) && Math.abs(Math.abs(t.valor) - valorAlvo) <= Math.max(MARGEM, valorAlvo * 0.005))

      let melhor = null
      if (candidatos.length === 1) melhor = candidatos[0]
      else if (candidatos.length > 1) {
        melhor = candidatos.find(({ t }) => normalizar(t.nome || t.memo).includes(nomeAlvoNorm)) || candidatos[0]
      }
      if (melhor) usados.add(melhor.idx)

      linhas.push({
        medico: mn.nome,
        nf: nota.nf, tomador: nota.tomador, comp: nota.comp, statusNota: nota.status,
        valorEsperado: valorAlvo,
        transacao: melhor?.t || null,
        pago: !!melhor,
      })
    })
  })

  const porMedico = {}
  linhas.forEach(l => {
    if (!porMedico[l.medico]) porMedico[l.medico] = { medico: l.medico, notas: [], valorEsperadoTotal: 0, valorEncontradoTotal: 0, qtdTotal: 0, qtdEncontrada: 0 }
    const m = porMedico[l.medico]
    m.notas.push(l)
    m.valorEsperadoTotal += l.valorEsperado
    m.qtdTotal += 1
    if (l.pago) {
      m.valorEncontradoTotal += Math.abs(l.transacao.valor)
      m.qtdEncontrada += 1
    }
  })

  return Object.values(porMedico)
    .map(m => ({ ...m, diferenca: m.valorEncontradoTotal - m.valorEsperadoTotal }))
    .sort((a, b) => a.medico.localeCompare(b.medico, 'pt-BR'))
}

function AbaExtratoOFX({ notas = [], onRefresh }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [dandoBaixa, setDandoBaixa] = useState(false)
  const [cruzamento, setCruzamento] = useState(null)
  const [porMedico, setPorMedico] = useState(null)
  const [modoView, setModoView] = useState('nota') // 'nota' | 'medico'
  const [selecionadas, setSelecionadas] = useState(new Set())
  const [expandida, setExpandida] = useState(null)
  const [expandidoMedico, setExpandidoMedico] = useState(null)
  const [buscaMedico, setBuscaMedico] = useState('')
  const fileRef = useRef()

  async function processarArquivo(file) {
    setLoading(true)
    try {
      const buffer = await file.arrayBuffer()
      const decoder = new TextDecoder('iso-8859-1')
      const text = decoder.decode(buffer)
      const trans = parseOFX(text)
      if (!trans.length) { toast('Nenhuma transação encontrada no extrato.', 'error'); setLoading(false); return }
      const cruz = cruzarDebitosComNotas(trans, notas)
      const pm = cruzarDebitosPorMedico(trans, notas)
      setCruzamento(cruz)
      setPorMedico(pm)
      setSelecionadas(new Set(cruz.map((r, i) => r.completo ? i : -1).filter(i => i >= 0)))
      toast(`${trans.length} transação(ões) no extrato · ${cruz.filter(r => r.completo).length} nota(s) totalmente conferida(s)`)
    } catch (e) {
      toast('Erro ao processar o extrato: ' + e.message, 'error')
    }
    setLoading(false)
  }

  function reiniciar() { setCruzamento(null); setPorMedico(null); setSelecionadas(new Set()); if (fileRef.current) fileRef.current.value = '' }
  function toggleSel(i) { setSelecionadas(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n }) }

  async function darBaixa() {
    const sels = cruzamento.filter((_, i) => selecionadas.has(i))
    if (!sels.length) { toast('Selecione ao menos uma nota completa.', 'error'); return }
    setDandoBaixa(true)
    let sucesso = 0, falhas = 0
    for (const item of sels) {
      try {
        await supabase.from('notas_fiscais').update({ status: 'Paga ao médico' }).eq('id', item.nota.id)
        sucesso++
      } catch (e) { falhas++ }
    }
    setDandoBaixa(false)
    toast(`${sucesso} nota(s) marcada(s) como "Paga ao médico"${falhas ? ` · ${falhas} falha(s)` : ''}`)
    if (onRefresh) onRefresh()
    reiniciar()
  }

  if (!cruzamento) {
    return (
      <div>
        <div style={{ ...cardStyle, padding: '18px 22px', marginBottom: 16, background: 'linear-gradient(135deg, #EBF5FF, #F0F9FF)', border: '1px solid #BFDBFE' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: G.g2, marginBottom: 6 }}>🏦 Baixa automática de notas via extrato bancário</div>
          <div style={{ fontSize: 12, color: GRAY[2], lineHeight: 1.5 }}>
            Envie o extrato OFX do banco. O sistema pega os <strong>débitos</strong> (pagamentos a médicos) e casa cada um com o valor de repasse de cada médico dentro das notas fiscais ainda não marcadas como pagas.
            Quando <strong>todos os médicos de uma nota</strong> tiverem pagamento identificado no extrato, ela fica disponível pra você confirmar a baixa (status muda para <strong>"Paga ao médico"</strong>). Notas com pagamento parcial aparecem, mas não são marcadas — assim nenhuma nota é dada como paga antes da hora.
          </div>
        </div>
        <div
          style={{ border: '2px dashed #D4E6DA', borderRadius: 14, padding: 40, textAlign: 'center', cursor: 'pointer', background: GRAY[6] }}
          onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]) }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: GRAY[1], marginBottom: 4 }}>Arraste o extrato OFX aqui</div>
          <div style={{ fontSize: 12, color: GRAY[3] }}>ou clique para selecionar (.ofx, .qfx)</div>
        </div>
        <input ref={fileRef} type="file" accept=".ofx,.qfx,.ofc,.txt" style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) processarArquivo(e.target.files[0]) }} />
        {loading && <div style={{ textAlign: 'center', padding: 20, color: GRAY[2] }}>Processando extrato...</div>}
      </div>
    )
  }

  const completas = cruzamento.filter(r => r.completo).length
  const parciais = cruzamento.filter(r => !r.completo).length

  const medicosFiltrados = (porMedico || []).filter(m => !buscaMedico || m.medico.toLowerCase().includes(buscaMedico.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[{ k: 'nota', label: '📄 Por nota (dar baixa)' }, { k: 'medico', label: '👨‍⚕️ Por médico (conferência)' }].map(t => (
          <button key={t.k} onClick={() => setModoView(t.k)} style={{
            padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            border: '1px solid ' + (modoView === t.k ? G.g3 : '#D4E6DA'),
            background: modoView === t.k ? G.g3 : '#fff',
            color: modoView === t.k ? '#fff' : GRAY[2],
          }}>{t.label}</button>
        ))}
      </div>

      {modoView === 'nota' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <Kpi label="Notas totalmente conferidas" value={completas} sub="todos os médicos pagos" color={G.g2} />
            <Kpi label="Notas com pagamento parcial" value={parciais} sub="alguns médicos ainda sem match" color={ORANGE} />
            <Kpi label="Selecionadas para baixa" value={selecionadas.size} sub="serão marcadas como pagas" />
          </div>

          <div style={{ ...cardStyle, padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnGhost} onClick={reiniciar}>← Voltar</button>
            <div style={{ flex: 1 }} />
            <button style={{ ...btnPrimary, opacity: dandoBaixa || !selecionadas.size ? 0.6 : 1 }} onClick={darBaixa} disabled={dandoBaixa || !selecionadas.size}>
              {dandoBaixa ? 'Processando…' : `✓ Dar baixa em ${selecionadas.size} nota(s)`}
            </button>
          </div>

          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
              Notas identificadas no extrato ({cruzamento.length})
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                <thead><tr style={{ background: G.g1 }}>
                  <th style={thStyle}></th>
                  <th style={thStyle}>NF</th>
                  <th style={thStyle}>Tomador</th>
                  <th style={thStyle}>Competência</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Médicos pagos</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}></th>
                </tr></thead>
                <tbody>
                  {cruzamento.map((r, i) => (
                    <>
                      <tr key={i} style={{ background: r.completo ? '#F0FDF4' : '#FFFBEB' }}>
                        <td style={tdStyle}>
                          {r.completo && <input type="checkbox" checked={selecionadas.has(i)} onChange={() => toggleSel(i)} />}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.nota.nf || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 220 }}>{r.nota.tomador || '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtMes(r.nota.comp)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{r.pagos}/{r.totalMedicos}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {r.completo
                            ? <span style={badge(G.g7, G.g2, G.g6)}>✓ Completa</span>
                            : <span style={badge('#FFFBEB', ORANGE, '#FDE68A')}>Parcial</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button onClick={() => setExpandida(expandida === i ? null : i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: G.g3, fontSize: 12, fontWeight: 600 }}>
                            {expandida === i ? 'Ocultar' : 'Ver médicos'}
                          </button>
                        </td>
                      </tr>
                      {expandida === i && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid ' + GRAY[6] }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', background: GRAY[6] }}>
                              <thead><tr>
                                <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Médico</th>
                                <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'right' }}>Repasse esperado</th>
                                <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Data no banco</th>
                                <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'center' }}>Status</th>
                              </tr></thead>
                              <tbody>
                                {r.medicosStatus.map((m, j) => (
                                  <tr key={j}>
                                    <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{m.nome}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(m.valor)}</td>
                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{m.transacao ? fmtDt(m.transacao.data) : '—'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                      {m.pago
                                        ? <span style={badge(G.g7, G.g2, G.g6)}>✓ Encontrado</span>
                                        : <span style={badge('#FEF2F2', RED, '#FECACA')}>❌ Não encontrado</span>}
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
        </>
      ) : (
        <>
          <div style={{ ...cardStyle, padding: '18px 22px', marginBottom: 16, background: 'linear-gradient(135deg, #EBF5FF, #F0F9FF)', border: '1px solid #BFDBFE' }}>
            <div style={{ fontSize: 13, color: GRAY[2], lineHeight: 1.5 }}>
              Para cada médico: <strong>Valor esperado</strong> é a soma dos repasses de todas as notas fiscais dele no sistema (pagas ou não). <strong>Valor no extrato</strong> é a soma dos débitos do banco que bateram com algum desses valores. Se as duas colunas não baterem, use a lista de notas expandida pra achar qual NF específica está causando a diferença.
            </div>
          </div>

          <div style={{ ...cardStyle, padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnGhost} onClick={reiniciar}>← Voltar</button>
            <input type="text" placeholder="🔍 Buscar médico..." value={buscaMedico} onChange={e => setBuscaMedico(e.target.value)}
              style={{ ...inputStyle, minWidth: 220 }} />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: GRAY[3] }}>{medicosFiltrados.length} médico(s)</span>
          </div>

          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                <thead><tr style={{ background: G.g1 }}>
                  <th style={thStyle}>Médico</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Notas conferidas</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Valor esperado (sistema)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Valor no extrato (banco)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Diferença</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}></th>
                </tr></thead>
                <tbody>
                  {medicosFiltrados.length === 0 && (
                    <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhum médico encontrado.</td></tr>
                  )}
                  {medicosFiltrados.map((m, i) => {
                    const completo = m.qtdEncontrada === m.qtdTotal
                    return (
                      <>
                        <tr key={i} style={{ background: Math.abs(m.diferenca) < 0.01 ? '#F0FDF4' : '#FFFBEB' }}>
                          <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'normal' }}>{m.medico}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.qtdEncontrada}/{m.qtdTotal}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(m.valorEsperadoTotal)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: G.g2 }}>R$ {brl(m.valorEncontradoTotal)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: Math.abs(m.diferenca) < 0.01 ? GRAY[3] : m.diferenca > 0 ? G.g2 : RED }}>
                            {m.diferenca >= 0 ? '+' : '-'}R$ {brl(Math.abs(m.diferenca))}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button onClick={() => setExpandidoMedico(expandidoMedico === i ? null : i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: G.g3, fontSize: 12, fontWeight: 600 }}>
                              {expandidoMedico === i ? 'Ocultar' : 'Ver notas'}
                            </button>
                          </td>
                        </tr>
                        {expandidoMedico === i && (
                          <tr>
                            <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid ' + GRAY[6] }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', background: GRAY[6] }}>
                                <thead><tr>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>NF</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Tomador</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Competência</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'right' }}>Esperado</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Data banco</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'center' }}>Status nota</th>
                                  <th style={{ ...thStyle, background: 'transparent', color: GRAY[2], textAlign: 'center' }}>Match</th>
                                </tr></thead>
                                <tbody>
                                  {m.notas.map((n, j) => (
                                    <tr key={j}>
                                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{n.nf || '—'}</td>
                                      <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{n.tomador || '—'}</td>
                                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtMes(n.comp)}</td>
                                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(n.valorEsperado)}</td>
                                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{n.transacao ? fmtDt(n.transacao.data) : '—'}</td>
                                      <td style={{ ...tdStyle, textAlign: 'center' }}>{n.statusNota || '—'}</td>
                                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                                        {n.pago
                                          ? <span style={badge(G.g7, G.g2, G.g6)}>✓</span>
                                          : <span style={badge('#FEF2F2', RED, '#FECACA')}>❌</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function RegimeCaixa({ notas = [], comprovantes = [], medicos = [], tomadores = [], onRefresh }) {
  const [aba, setAba] = useState('caixa')
  const [fMedico, setFMedico] = useState('')
  const [fCompDe, setFCompDe] = useState('')
  const [fCompAte, setFCompAte] = useState('')
  const [fDimensao, setFDimensao] = useState('emissao') // 'emissao' | 'recebimento'
  const [fTomador, setFTomador] = useState('')
  const [fStatus, setFStatus] = useState('')

  const medicosOpts = useMemo(() => {
    const s = new Set(medicos.map(m => m.nome).filter(Boolean))
    notas.forEach(n => (n.medicos_nota || []).forEach(mn => mn.nome && s.add(mn.nome)))
    return [...s].sort()
  }, [medicos, notas])

  const tomadoresOpts = useMemo(() => {
    const s = new Set(tomadores.map(t => t.nome).filter(Boolean))
    notas.forEach(n => n.tomador && s.add(n.tomador))
    return [...s].sort()
  }, [tomadores, notas])

  const linhas = useMemo(() => {
    const out = []
    notas.forEach(n => {
      if (fTomador && n.tomador !== fTomador) return
      // Usa a competência de emissão ou o mês de recebimento, conforme a dimensão escolhida.
      // Se o mês de recebimento não estiver preenchido, cai de volta pra competência de emissão.
      const mesRef = fDimensao === 'recebimento' ? (n.mes_recebimento || n.comp) : n.comp
      if (fCompDe && mesRef && mesRef < fCompDe) return
      if (fCompAte && mesRef && mesRef > fCompAte) return
      if (fStatus && n.status !== fStatus) return
      ;(n.medicos_nota || []).forEach(mn => {
        if (fMedico && mn.nome !== fMedico) return
        out.push({
          nf: n.nf, tomador: n.tomador, comp: n.comp, mesRecebimento: n.mes_recebimento, status: n.status,
          medico: mn.nome, bruto: mn.valor_bruto_medico || 0, repasse: mn.repasse || 0,
        })
      })
    })
    return out
  }, [notas, fMedico, fCompDe, fCompAte, fDimensao, fTomador, fStatus])


  const totalBruto = linhas.reduce((a, l) => a + l.bruto, 0)
  const totalDevido = linhas.reduce((a, l) => a + l.repasse, 0)
  const totalPago = linhas.filter(l => l.status === 'Paga ao médico').reduce((a, l) => a + l.repasse, 0)
  const diferenca = totalPago - totalDevido

  const porMedico = useMemo(() => {
    const m = {}
    linhas.forEach(l => {
      if (!m[l.medico]) m[l.medico] = { medico: l.medico, qtdNotas: 0, qtdPagas: 0, bruto: 0, devido: 0, pago: 0 }
      m[l.medico].qtdNotas++
      m[l.medico].bruto += l.bruto
      m[l.medico].devido += l.repasse
      if (l.status === 'Paga ao médico') {
        m[l.medico].qtdPagas++
        m[l.medico].pago += l.repasse
      }
    })
    return Object.values(m).sort((a, b) => a.medico.localeCompare(b.medico))
  }, [linhas])

  function limparFiltros() { setFMedico(''); setFCompDe(''); setFCompAte(''); setFDimensao('emissao'); setFTomador(''); setFStatus('') }

  function exportarCSV() {
    const headers = ['NF', 'Tomador', 'Competência (emissão)', 'Mês recebimento', 'Médico', 'Bruto', 'Repasse (devido)', 'Status']
    const rows = linhas.map(l => [l.nf, l.tomador, fmtMes(l.comp), l.mesRecebimento ? fmtMes(l.mesRecebimento) : '', l.medico, l.bruto.toFixed(2).replace('.', ','), l.repasse.toFixed(2).replace('.', ','), l.status])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio_medico_competencia_tomador.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>📈 Regime de caixa</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 620, lineHeight: 1.5 }}>
            Cruza os valores lançados nas notas fiscais com o que foi efetivamente pago aos médicos, e confere com o extrato bancário real.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #D4E6DA' }}>
          {[{ k: 'caixa', label: '📊 Regime de caixa' }, { k: 'ofx', label: '🏦 Extrato bancário (OFX)' }].map(t => (
            <button key={t.k} onClick={() => setAba(t.k)} style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: aba === t.k ? G.g2 : GRAY[3],
              borderBottom: aba === t.k ? `2px solid ${G.g3}` : '2px solid transparent', marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        {aba === 'ofx' ? (
          <AbaExtratoOFX notas={notas} onRefresh={onRefresh} />
        ) : (
          <>
            <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Médico</label>
                <select style={inputStyle} value={fMedico} onChange={e => setFMedico(e.target.value)}>
                  <option value="">Todos os médicos</option>
                  {medicosOpts.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Filtrar período por</label>
                <select style={inputStyle} value={fDimensao} onChange={e => setFDimensao(e.target.value)}>
                  <option value="emissao">Competência de emissão</option>
                  <option value="recebimento">Mês de recebimento</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>De</label>
                <input type="month" style={inputStyle} value={fCompDe} onChange={e => setFCompDe(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Até</label>
                <input type="month" style={inputStyle} value={fCompAte} onChange={e => setFCompAte(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Tomador</label>
                <select style={inputStyle} value={fTomador} onChange={e => setFTomador(e.target.value)}>
                  <option value="">Todos</option>
                  {tomadoresOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status da nota</label>
                <select style={inputStyle} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="Emitida">Emitida</option>
                  <option value="Recebida">Recebida</option>
                  <option value="Paga ao médico">Paga ao médico</option>
                </select>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={limparFiltros} style={btnGhost}>Limpar filtros</button>
              <button onClick={exportarCSV} style={btnPrimary}>📥 Exportar CSV</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              <Kpi label="Total bruto" value={`R$ ${brl(totalBruto)}`} sub="valor emitido nas notas" />
              <Kpi label="Total devido (repasse)" value={`R$ ${brl(totalDevido)}`} sub="segundo as notas fiscais" />
              <Kpi label="Total pago (caixa)" value={`R$ ${brl(totalPago)}`} sub="notas marcadas 'Paga ao médico'" color={G.g2} />
              <Kpi label="Diferença" value={`${diferenca >= 0 ? '' : '-'}R$ ${brl(Math.abs(diferenca))}`} sub="pago − devido" color={Math.abs(diferenca) < 0.01 ? GRAY[3] : diferenca > 0 ? G.g2 : RED} />
            </div>

            <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
                Resumo por médico ({porMedico.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead><tr style={{ background: G.g1 }}>
                    <th style={thStyle}>Médico</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Nº notas</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Nº pagas</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Bruto</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Devido (repasse)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Pago (caixa)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Diferença</th>
                  </tr></thead>
                  <tbody>
                    {porMedico.length === 0 && (
                      <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhum resultado para os filtros selecionados.</td></tr>
                    )}
                    {porMedico.map(m => {
                      const dif = m.pago - m.devido
                      return (
                        <tr key={m.medico}>
                          <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'normal', color: GRAY[1] }}>{m.medico}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.qtdNotas}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace', color: m.qtdPagas === m.qtdNotas ? G.g2 : ORANGE, fontWeight: 700 }}>{m.qtdPagas}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(m.bruto)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(m.devido)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(m.pago)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: Math.abs(dif) < 0.01 ? GRAY[3] : dif > 0 ? G.g2 : RED }}>
                            {dif >= 0 ? '+' : '-'}R$ {brl(Math.abs(dif))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
                Detalhamento por nota ({linhas.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                  <thead><tr style={{ background: G.g1 }}>
                    <th style={thStyle}>NF</th>
                    <th style={thStyle}>Tomador</th>
                    <th style={thStyle}>Competência</th>
                    <th style={thStyle}>Receb.</th>
                    <th style={thStyle}>Médico</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Bruto</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Repasse</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  </tr></thead>
                  <tbody>
                    {linhas.length === 0 && (
                      <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma nota encontrada para os filtros selecionados.</td></tr>
                    )}
                    {linhas.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{l.nf || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{l.tomador || '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtMes(l.comp)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', color: l.mesRecebimento && l.mesRecebimento !== l.comp ? ORANGE : GRAY[3], fontWeight: l.mesRecebimento && l.mesRecebimento !== l.comp ? 700 : 400 }}>
                          {l.mesRecebimento ? fmtMes(l.mesRecebimento) : '—'}
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{l.medico}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(l.bruto)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: G.g2 }}>R$ {brl(l.repasse)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{l.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

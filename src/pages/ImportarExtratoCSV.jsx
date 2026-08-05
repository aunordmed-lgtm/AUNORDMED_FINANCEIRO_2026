import { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'

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

  const splitCom = (linha, sep) => {
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

  // Extratos de banco costumam ter linhas de metadados (conta, período, saldo)
  // antes do cabeçalho de verdade. Procura, nas primeiras linhas, aquela que
  // realmente tem uma coluna "valor" — essa é o cabeçalho de fato.
  let sep = ';', headerIdx = -1, header = []
  for (const tentativaSep of [';', ',']) {
    for (let i = 0; i < Math.min(linhas.length, 20); i++) {
      const cols = splitCom(linhas[i], tentativaSep).map(c => normalizar(c))
      if (cols.length >= 3 && cols.some(c => c.includes('valor') || c.includes('amount'))) {
        sep = tentativaSep; headerIdx = i; header = cols
        break
      }
    }
    if (headerIdx >= 0) break
  }
  if (headerIdx < 0) return [] // não achou nenhuma linha de cabeçalho reconhecível

  const idxData = header.findIndex(h => h.includes('data') || h.includes('date'))
  const idxValor = header.findIndex(h => h.includes('valor') || h.includes('amount'))
  const idxDesc = header.findIndex(h => h.includes('descri'))
  const idxHistorico = header.findIndex(h => h.includes('histor'))

  const parseValor = (v) => {
    if (!v) return 0
    let s = String(v).trim().replace(/[R$\s]/g, '')
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    return parseFloat(s) || 0
  }

  const parseData = (v) => {
    if (!v) return ''
    const s = String(v).trim()
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    return ''
  }

  return linhas.slice(headerIdx + 1).map(linha => {
    const cols = splitCom(linha, sep)
    const valorBruto = parseValor(cols[idxValor])
    if (!valorBruto) return null
    // Só nos interessam saídas (pagamentos/pix enviado) — dinheiro saindo pro médico
    if (valorBruto >= 0) return null
    const descricao = idxDesc >= 0 ? cols[idxDesc] : ''
    const historico = idxHistorico >= 0 ? cols[idxHistorico] : ''
    return {
      data: idxData >= 0 ? parseData(cols[idxData]) : '',
      valor: Math.abs(valorBruto),
      descricao: descricao || historico,
      historico,
    }
  }).filter(Boolean)
}

// Compara nomes de forma tolerante (mesma lógica usada na importação de Excel de médicos em Notas.jsx)
function nomesSimilares(nomeA, nomeB) {
  const norm = s => normalizar(s).trim()
  const a = norm(nomeA).split(' ').filter(Boolean)
  const b = norm(nomeB).split(' ').filter(Boolean)
  if (norm(nomeA) === norm(nomeB)) return true
  if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1]) return true
  if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]) return true
  if (b.length >= 2 && a.includes(b[0]) && a.includes(b[1])) return true
  if (a.length >= 2 && b.includes(a[0]) && b.includes(a[1])) return true
  return false
}

// Sugere um médico pra cada transação: primeiro tenta casar pelo NOME que veio na
// descrição do banco (muito mais confiável), e só cai pro valor quando não achar por nome.
function sugerirMedicos(linhasCsv, notas, medicos) {
  const alvosValor = []
  notas.forEach(n => (n.medicos_nota || []).forEach(mn => {
    if (mn.repasse) alvosValor.push({ nome: mn.nome, valor: mn.repasse, nf: n.nf })
  }))

  return linhasCsv.map(l => {
    // 1) match por nome direto contra o cadastro de médicos
    const porNome = medicos.find(m => nomesSimilares(l.descricao, m.nome))
    if (porNome) {
      const alvoValor = alvosValor.find(a => nomesSimilares(a.nome, porNome.nome) && Math.abs(a.valor - l.valor) <= Math.max(0.02, l.valor * 0.005))
      return { ...l, medico: porNome.nome, nf: alvoValor?.nf || '', origemSugestao: 'nome' }
    }
    // 2) fallback: match por valor batendo com algum repasse esperado
    const candidatos = alvosValor.filter(a => Math.abs(a.valor - l.valor) <= Math.max(0.02, l.valor * 0.005))
    let sugestao = null
    if (candidatos.length === 1) sugestao = candidatos[0]
    else if (candidatos.length > 1) {
      sugestao = candidatos.find(c => normalizar(l.descricao).includes(normalizar(c.nome).split(' ')[0])) || null
    }
    return { ...l, medico: sugestao?.nome || '', nf: sugestao?.nf || '', ambiguo: candidatos.length > 1 && !sugestao, origemSugestao: sugestao ? 'valor' : null }
  })
}

export function ImportarExtratoCSV({ notas = [], medicos = [], extratoBancario = [], onRefresh }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const usuarioAtual = user?.email || 'desconhecido'
  const [aba, setAba] = useState('importar') // 'importar' | 'relatorio'
  const [linhas, setLinhas] = useState([])
  const [loading, setLoading] = useState(false)
  const [buscaMedico, setBuscaMedico] = useState('')
  const [relMedico, setRelMedico] = useState('')
  const [relDe, setRelDe] = useState('')
  const [relAte, setRelAte] = useState('')
  const [relMesRapido, setRelMesRapido] = useState('')
  const [editandoId, setEditandoId] = useState(null)
  const [editForm, setEditForm] = useState({ data: '', valor: '', medico_nome: '', nf: '', descricao: '' })
  const [modalManual, setModalManual] = useState(false)
  const [formManual, setFormManual] = useState({ data: '', medico_nome: '', valor: '', nf: '', descricao: '' })
  const [salvandoManual, setSalvandoManual] = useState(false)
  const fileRef = useRef()

  const medicosOrdenados = useMemo(() => [...medicos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [medicos])
  const medicosComExtrato = useMemo(() => [...new Set(extratoBancario.map(e => e.medico_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [extratoBancario])
  const mesesDisponiveis = useMemo(() => [...new Set(extratoBancario.map(e => e.data ? String(e.data).slice(0, 7) : null).filter(Boolean))].sort().reverse(), [extratoBancario])

  function processarArquivo(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result)
      if (!parsed.length) { toast('Não encontrei nenhuma linha de saída (débito) com valor válido no CSV.', 'error'); return }
      const comSugestao = sugerirMedicos(parsed, notas, medicos)
      setLinhas(comSugestao)
      const sugeridos = comSugestao.filter(l => l.medico).length
      const porNome = comSugestao.filter(l => l.origemSugestao === 'nome').length
      toast(`${parsed.length} transação(ões) de saída · ${sugeridos} sugerida(s) (${porNome} por nome)`)
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

  async function registrarLog(extratoId, acao, dadosAntes, dadosDepois) {
    try {
      await supabase.from('extrato_bancario_log').insert({
        extrato_id: extratoId, acao, dados_antes: dadosAntes || null, dados_depois: dadosDepois || null, usuario: usuarioAtual,
      })
    } catch (e) { /* auditoria não deve travar a operação principal */ }
  }

  async function salvarTudo() {
    const validas = linhas.filter(l => l.medico)
    if (!validas.length) { toast('Preencha o médico de pelo menos uma linha antes de salvar.', 'error'); return }
    setLoading(true)
    let sucesso = 0, falhas = 0
    for (const l of validas) {
      try {
        const payload = {
          data: l.data || null, valor: l.valor, descricao: l.descricao || null,
          medico_nome: l.medico, nf: l.nf || null, conferido: true,
          origem: 'csv', criado_por: usuarioAtual,
        }
        const { data: inserida, error } = await supabase.from('extrato_bancario').insert(payload).select().single()
        if (error) throw error
        await registrarLog(inserida?.id, 'criado', null, payload)
        sucesso++
      } catch (e) { falhas++ }
    }
    setLoading(false)
    toast(`${sucesso} transação(ões) salva(s)${falhas ? ` · ${falhas} falha(s)` : ''}`)
    setLinhas(prev => prev.filter(l => !l.medico))
    if (onRefresh) onRefresh()
  }

  async function excluirSalva(item) {
    if (!window.confirm('Excluir esta transação do extrato salvo?')) return
    await supabase.from('extrato_bancario').delete().eq('id', item.id)
    await registrarLog(item.id, 'excluido', item, null)
    toast('Removida.')
    if (onRefresh) onRefresh()
  }

  function abrirEdicao(item) {
    setEditandoId(item.id)
    setEditForm({
      data: item.data || '', valor: String(item.valor ?? ''), medico_nome: item.medico_nome || '',
      nf: item.nf || '', descricao: item.descricao || '',
    })
  }

  function cancelarEdicao() { setEditandoId(null) }

  async function salvarEdicao(itemOriginal) {
    if (!editForm.medico_nome || !editForm.valor) { toast('Médico e valor são obrigatórios.', 'error'); return }
    const payload = {
      data: editForm.data || null, valor: parseFloat(editForm.valor) || 0, medico_nome: editForm.medico_nome,
      nf: editForm.nf || null, descricao: editForm.descricao || null,
      atualizado_em: new Date().toISOString(), atualizado_por: usuarioAtual,
    }
    try {
      const { error } = await supabase.from('extrato_bancario').update(payload).eq('id', itemOriginal.id)
      if (error) throw error
      await registrarLog(itemOriginal.id, 'editado', itemOriginal, { ...itemOriginal, ...payload })
      toast('Transação corrigida!')
      setEditandoId(null)
      if (onRefresh) onRefresh()
    } catch (e) {
      toast('Erro ao salvar correção: ' + e.message, 'error')
    }
  }

  async function salvarPagamentoManual() {
    if (!formManual.medico_nome || !formManual.valor) { toast('Médico e valor são obrigatórios.', 'error'); return }
    setSalvandoManual(true)
    try {
      const payload = {
        data: formManual.data || null, valor: parseFloat(formManual.valor) || 0, medico_nome: formManual.medico_nome,
        nf: formManual.nf || null, descricao: formManual.descricao || '(lançamento manual)', conferido: true,
        origem: 'manual', criado_por: usuarioAtual,
      }
      const { data: inserida, error } = await supabase.from('extrato_bancario').insert(payload).select().single()
      if (error) throw error
      await registrarLog(inserida?.id, 'criado', null, payload)
      toast('Pagamento manual registrado!')
      setModalManual(false)
      setFormManual({ data: '', medico_nome: '', valor: '', nf: '', descricao: '' })
      if (onRefresh) onRefresh()
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'error')
    }
    setSalvandoManual(false)
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

  // ── RELATÓRIO ──
  const extratoRelFiltrado = useMemo(() => {
    return extratoBancario.filter(e => {
      if (relMedico && e.medico_nome !== relMedico) return false
      const mes = e.data ? String(e.data).slice(0, 7) : ''
      if (relMesRapido) return mes === relMesRapido
      if (relDe && mes && mes < relDe) return false
      if (relAte && mes && mes > relAte) return false
      return true
    })
  }, [extratoBancario, relMedico, relDe, relAte, relMesRapido])

  const porMesRel = useMemo(() => {
    const m = {}
    extratoRelFiltrado.forEach(e => {
      const mes = e.data ? String(e.data).slice(0, 7) : 'Sem data'
      if (!m[mes]) m[mes] = { mes, total: 0, qtd: 0 }
      m[mes].total += e.valor || 0
      m[mes].qtd++
    })
    return Object.values(m).sort((a, b) => b.mes.localeCompare(a.mes))
  }, [extratoRelFiltrado])

  const porMedicoRel = useMemo(() => {
    const m = {}
    extratoRelFiltrado.forEach(e => {
      const nome = e.medico_nome || '(sem médico)'
      if (!m[nome]) m[nome] = { medico: nome, total: 0, qtd: 0 }
      m[nome].total += e.valor || 0
      m[nome].qtd++
    })
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [extratoRelFiltrado])

  const relTotal = extratoRelFiltrado.reduce((a, e) => a + (e.valor || 0), 0)
  const relMedicosUnicos = new Set(extratoRelFiltrado.map(e => e.medico_nome).filter(Boolean)).size

  function limparFiltrosRel() { setRelMedico(''); setRelDe(''); setRelAte(''); setRelMesRapido('') }

  function exportarRelatorio() {
    const headers = ['Data', 'Médico', 'Valor', 'NF', 'Descrição']
    const rows = extratoRelFiltrado
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
      .map(e => [e.data ? fmtDt(e.data) : '', e.medico_nome || '', e.valor.toFixed(2).replace('.', ','), e.nf || '', e.descricao || ''])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio_extrato_bancario.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>📤 Importar extrato bancário (CSV)</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
            Importe o extrato do banco em CSV e associe manualmente cada transação a um médico (o sistema sugere quando o valor bate com algum repasse esperado, mas você sempre pode escolher outro). O que for salvo aqui fica guardado de verdade e vira a fonte confiável de "quanto cada médico recebeu".
          </div>
        </div>

        {/* Toggle de abas */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
          {[{ k: 'importar', label: '📤 Importar' }, { k: 'relatorio', label: '📊 Relatório' }].map(t => (
            <button key={t.k} onClick={() => setAba(t.k)} style={{
              padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
              border: '1px solid ' + (aba === t.k ? G.g3 : '#D4E6DA'),
              background: aba === t.k ? G.g3 : '#fff',
              color: aba === t.k ? '#fff' : GRAY[2],
            }}>{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => setModalManual(true)} style={btnPrimary}>+ Adicionar pagamento manual</button>
        </div>

        {modalManual && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setModalManual(false)}>
            <div style={{ ...cardStyle, width: 420, maxWidth: '100%', padding: 22 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 15, fontWeight: 700, color: GRAY[0], marginBottom: 4 }}>💵 Adicionar pagamento manual</div>
              <div style={{ fontSize: 11.5, color: GRAY[3], marginBottom: 16 }}>Use quando o pagamento não veio de um extrato importado (ex: dinheiro, outro banco, etc.)</div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Médico *</label>
                <input type="text" list="ie-med-datalist" value={formManual.medico_nome} onChange={e => setFormManual(f => ({ ...f, medico_nome: e.target.value }))}
                  style={{ ...inputStyle, width: '100%' }} placeholder="Nome do médico" />
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Data</label>
                  <input type="date" value={formManual.data} onChange={e => setFormManual(f => ({ ...f, data: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Valor (R$) *</label>
                  <input type="number" step="0.01" min="0" value={formManual.valor} onChange={e => setFormManual(f => ({ ...f, valor: e.target.value }))} style={{ ...inputStyle, width: '100%' }} placeholder="0,00" />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Nº da NF (opcional)</label>
                <input type="text" value={formManual.nf} onChange={e => setFormManual(f => ({ ...f, nf: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Observação (opcional)</label>
                <input type="text" value={formManual.descricao} onChange={e => setFormManual(f => ({ ...f, descricao: e.target.value }))} style={{ ...inputStyle, width: '100%' }} placeholder="Ex: pago em dinheiro" />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setModalManual(false)} style={btnGhost}>Cancelar</button>
                <button onClick={salvarPagamentoManual} style={btnPrimary} disabled={salvandoManual}>
                  {salvandoManual ? 'Salvando…' : '✓ Registrar pagamento'}
                </button>
              </div>
            </div>
          </div>
        )}

        {aba === 'importar' && (<>
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
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}>Origem</th>
                              <th style={{ ...thStyle, background: 'transparent', color: GRAY[2] }}></th>
                            </tr></thead>
                            <tbody>
                              {m.itens.map((it, j) => (
                                editandoId === it.id ? (
                                  <tr key={j} style={{ background: '#FFFBEB' }}>
                                    <td style={tdStyle}><input type="date" value={editForm.data} onChange={e => setEditForm(f => ({ ...f, data: e.target.value }))} style={{ ...inputStyle, height: 30, width: 130, fontSize: 11 }} /></td>
                                    <td style={tdStyle}><input type="number" step="0.01" value={editForm.valor} onChange={e => setEditForm(f => ({ ...f, valor: e.target.value }))} style={{ ...inputStyle, height: 30, width: 100, fontSize: 11, textAlign: 'right' }} /></td>
                                    <td style={tdStyle}><input type="text" value={editForm.nf} onChange={e => setEditForm(f => ({ ...f, nf: e.target.value }))} style={{ ...inputStyle, height: 30, width: 90, fontSize: 11 }} /></td>
                                    <td style={tdStyle}>
                                      <input type="text" list="ie-med-datalist" value={editForm.medico_nome} onChange={e => setEditForm(f => ({ ...f, medico_nome: e.target.value }))} style={{ ...inputStyle, height: 30, width: 180, fontSize: 11 }} placeholder="Médico" />
                                    </td>
                                    <td style={{ ...tdStyle, fontSize: 10, color: GRAY[3] }}>{it.origem || 'csv'}</td>
                                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                      <button onClick={() => salvarEdicao(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: G.g2, fontSize: 12, fontWeight: 700, marginRight: 8 }}>✓ Salvar</button>
                                      <button onClick={cancelarEdicao} style={{ background: 'none', border: 'none', cursor: 'pointer', color: GRAY[3], fontSize: 12 }}>Cancelar</button>
                                    </td>
                                  </tr>
                                ) : (
                                  <tr key={j}>
                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtDt(it.data)}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(it.valor)}</td>
                                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{it.nf || '—'}</td>
                                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 260 }}>{it.descricao || '—'}</td>
                                    <td style={{ ...tdStyle, fontSize: 10 }}>
                                      <span style={badge(it.origem === 'manual' ? '#FFFBEB' : G.g7, it.origem === 'manual' ? ORANGE : G.g2, it.origem === 'manual' ? '#FDE68A' : G.g6)}>
                                        {it.origem === 'manual' ? 'Manual' : 'CSV'}
                                      </span>
                                      {it.atualizado_em && <div style={{ color: GRAY[3], marginTop: 2 }}>editado por {it.atualizado_por}</div>}
                                    </td>
                                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                      <button onClick={() => abrirEdicao(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: G.g3, fontSize: 12, marginRight: 10 }}>✏️ Corrigir</button>
                                      <button onClick={() => excluirSalva(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: 12 }}>✕ excluir</button>
                                    </td>
                                  </tr>
                                )
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
        </>)}

        {aba === 'relatorio' && (<>
          <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Médico</label>
              <select style={inputStyle} value={relMedico} onChange={e => setRelMedico(e.target.value)}>
                <option value="">Todos</option>
                {medicosComExtrato.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Mês (atalho)</label>
              <select style={inputStyle} value={relMesRapido} onChange={e => { setRelMesRapido(e.target.value); if (e.target.value) { setRelDe(''); setRelAte('') } }}>
                <option value="">— nenhum —</option>
                {mesesDisponiveis.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Período de</label>
              <input type="month" style={inputStyle} value={relDe} onChange={e => { setRelDe(e.target.value); setRelMesRapido('') }} disabled={!!relMesRapido} />
            </div>
            <div>
              <label style={labelStyle}>até</label>
              <input type="month" style={inputStyle} value={relAte} onChange={e => { setRelAte(e.target.value); setRelMesRapido('') }} disabled={!!relMesRapido} />
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => { limparFiltrosRel(); setRelMesRapido('') }} style={btnGhost}>Limpar filtros</button>
            <button onClick={exportarRelatorio} style={btnPrimary}>📥 Exportar CSV</button>
          </div>

          <div style={{ fontSize: 11, color: GRAY[3], marginBottom: 12, marginTop: -8 }}>
            📅 Os filtros de período/mês sempre consideram a <strong>data de recebimento</strong> registrada em cada transação do extrato (não a competência da nota).
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <Kpi label="Total no período" value={`R$ ${brl(relTotal)}`} sub={`${extratoRelFiltrado.length} transação(ões)`} color={G.g2} />
            <Kpi label="Médicos únicos" value={relMedicosUnicos} sub="com recebimento no período" />
            <Kpi label="Meses com movimento" value={porMesRel.length} />
          </div>

          <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
              Por mês
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                <thead><tr style={{ background: G.g1 }}>
                  <th style={thStyle}>Mês</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Nº transações</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                </tr></thead>
                <tbody>
                  {porMesRel.length === 0 && (
                    <tr><td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma transação no período selecionado.</td></tr>
                  )}
                  {porMesRel.map((m, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{m.mes}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.qtd}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: G.g2 }}>R$ {brl(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
              Por médico
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead><tr style={{ background: G.g1 }}>
                  <th style={thStyle}>Médico</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Nº transações</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                </tr></thead>
                <tbody>
                  {porMedicoRel.length === 0 && (
                    <tr><td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma transação no período selecionado.</td></tr>
                  )}
                  {porMedicoRel.map((m, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{m.medico}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.qtd}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: G.g2 }}>R$ {brl(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </div>
    </div>
  )
}

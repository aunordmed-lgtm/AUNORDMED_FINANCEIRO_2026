import { useState, useMemo, useRef, useEffect } from 'react'
import { supabase, getUser } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl, pct, fmtMes, uid } from '../lib/helpers'
import * as XLSX from 'xlsx'

function normalizarTxt(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function fmtDtExtrato(d) {
  if (!d) return '—'
  const p = String(d).split('T')[0].split('-')
  if (p.length !== 3) return d
  return `${p[2]}/${p[1]}/${p[0]}`
}

// Parser de CSV de extrato bancário — mesma lógica usada em ImportarExtratoCSV.jsx
function parseExtratoCSV(text) {
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

  let sep = ';', headerIdx = -1, header = []
  for (const tentativaSep of [';', ',']) {
    for (let i = 0; i < Math.min(linhas.length, 20); i++) {
      const cols = splitCom(linhas[i], tentativaSep).map(c => normalizarTxt(c))
      if (cols.length >= 3 && cols.some(c => c.includes('valor') || c.includes('amount'))) {
        sep = tentativaSep; headerIdx = i; header = cols
        break
      }
    }
    if (headerIdx >= 0) break
  }
  if (headerIdx < 0) return []

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
    if (!valorBruto || valorBruto >= 0) return null // só débitos (saídas)
    const descricao = idxDesc >= 0 ? cols[idxDesc] : ''
    const historico = idxHistorico >= 0 ? cols[idxHistorico] : ''
    return {
      data: idxData >= 0 ? parseData(cols[idxData]) : '',
      valor: Math.abs(valorBruto),
      descricao: descricao || historico,
    }
  }).filter(Boolean)
}

function nomesSimilaresExtrato(nomeA, nomeB) {
  const norm = s => normalizarTxt(s).trim()
  const a = norm(nomeA).split(' ').filter(Boolean)
  const b = norm(nomeB).split(' ').filter(Boolean)
  if (norm(nomeA) === norm(nomeB)) return true
  if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1]) return true
  if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]) return true
  if (b.length >= 2 && a.includes(b[0]) && a.includes(b[1])) return true
  if (a.length >= 2 && b.includes(a[0]) && b.includes(a[1])) return true
  return false
}

// Cruza cada transação do extrato com os médicos das notas (via nome na descrição, depois valor)
function cruzarExtratoComNotasEMedicos(linhasCsv, notas, medicos) {
  const alvosValor = []
  notas.forEach(n => (n.medicos_nota || []).forEach(mn => {
    if (mn.repasse) alvosValor.push({ nome: mn.nome, valor: mn.repasse, nf: n.nf, notaId: n.id })
  }))

  return linhasCsv.map(l => {
    const porNome = medicos.find(m => nomesSimilaresExtrato(l.descricao, m.nome))
    if (porNome) {
      const alvo = alvosValor.find(a => nomesSimilaresExtrato(a.nome, porNome.nome) && Math.abs(a.valor - l.valor) <= Math.max(0.02, l.valor * 0.005))
      return { ...l, medico: porNome.nome, nf: alvo?.nf || '', notaId: alvo?.notaId || null }
    }
    const candidatos = alvosValor.filter(a => Math.abs(a.valor - l.valor) <= Math.max(0.02, l.valor * 0.005))
    let sugestao = null
    if (candidatos.length === 1) sugestao = candidatos[0]
    else if (candidatos.length > 1) {
      sugestao = candidatos.find(c => normalizarTxt(l.descricao).includes(normalizarTxt(c.nome).split(' ')[0])) || null
    }
    return { ...l, medico: sugestao?.nome || '', nf: sugestao?.nf || '', notaId: sugestao?.notaId || null, ambiguo: candidatos.length > 1 && !sugestao }
  })
}

const IMPOSTOS = 0.0615
const ALIQ_IR = 0.015
const ALIQ_CSLL = 0.01
const ALIQ_PIS = 0.0065
const ALIQ_COFINS = 0.03

function calcNota(bruto, medsSel) {
  const b = parseFloat(bruto) || 0
  const recebido = b * (1 - IMPOSTOS)
  const ir = b * ALIQ_IR
  const csll = b * ALIQ_CSLL
  const pis = b * ALIQ_PIS
  const cofins = b * ALIQ_COFINS
  let totalRepasse = 0
  let totalBrutoEquivalente = 0
  const meds = medsSel.map(ms => {
    const valor = parseFloat(ms.valor || 0)
    const ret = parseFloat(ms.ret) / 100
    // Se o modo for "líquido", o valor digitado JÁ é o repasse final — não aplica retenção.
    // Se for "bruto" (padrão), calcula o repasse descontando a retenção %.
    const repasse = ms.modoValor === 'liquido' ? valor : valor * (1 - ret)
    // "Bruto equivalente": pra quem está em modo líquido, traduz de volta pro valor bruto que
    // teria gerado esse líquido com a alíquota daquele médico — é o que permite comparar
    // valores líquidos e brutos na mesma base, e detectar líquido "passado a maior".
    const brutoEquivalente = ms.modoValor === 'liquido' && ret < 1 ? valor / (1 - ret) : valor
    totalRepasse += repasse
    totalBrutoEquivalente += brutoEquivalente
    return { ...ms, repasse, brutoEquivalente }
  })
  const margem = recebido - totalRepasse
  return { bruto: b, recebido, totalRepasse, totalBrutoEquivalente, margem, pct_margem: recebido > 0 ? margem / recebido : 0, meds, ir, csll, pis, cofins }
}

export function Notas({ notas, medicos, tomadores = [], extratoBancario = [], onRefresh }) {
  const { toast } = useToast()
  const [aba, setAba] = useState('lista')
  const [fPlanCompDe, setFPlanCompDe] = useState('')
  const [fPlanCompAte, setFPlanCompAte] = useState('')
  const [fPlanCaixa, setFPlanCaixa] = useState('') // '' | 'pago' | 'pendente'
  const [fPlanMedico, setFPlanMedico] = useState('')
  const [fPrazoSituacao, setFPrazoSituacao] = useState('') // '' | 'vencida' | 'vence_breve' | 'em_dia' | 'paga'
  const [fPrazoTomador, setFPrazoTomador] = useState('')
  const [editandoPlanId, setEditandoPlanId] = useState(null)
  const [editFormPlan, setEditFormPlan] = useState({ comp: '', nf: '', tomador: '', medico: '', bruto: '', retencao: '', status: '', dataPagamento: '' })
  const [salvandoPlan, setSalvandoPlan] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [abaModal, setAbaModal] = useState('dados') // dados | importar | particularidades
  const [particularidadesDaNota, setParticularidadesDaNota] = useState([])
  const [novaParticCategoria, setNovaParticCategoria] = useState('acordo_verbal')
  const [novaParticDescricao, setNovaParticDescricao] = useState('')
  const [salvandoPartic, setSalvandoPartic] = useState(false)

  const CATEGORIAS_PARTICULARIDADE = {
    acordo_verbal: '🤝 Acordo verbal',
    erro_terceiros: '⚠️ Erro de terceiros',
    excecao_fiscal: '🧾 Exceção fiscal',
    atraso_justificado: '⏱️ Atraso justificado',
    ajuste_manual: '✏️ Ajuste manual',
    outro: '📌 Outro',
  }

  async function carregarParticularidades(notaId) {
    if (!notaId) { setParticularidadesDaNota([]); return }
    try {
      const { data } = await supabase.from('particularidades').select('*').eq('nota_id', notaId).order('criado_em', { ascending: false })
      setParticularidadesDaNota(data || [])
    } catch (e) { setParticularidadesDaNota([]) }
  }

  async function adicionarParticularidade() {
    if (!novaParticDescricao.trim()) { toast('Descreva a particularidade antes de salvar.', 'error'); return }
    if (!editando) return
    setSalvandoPartic(true)
    try {
      const { error } = await supabase.from('particularidades').insert({
        nota_id: editando.id, nf: editando.nf, tomador: editando.tomador,
        categoria: novaParticCategoria, descricao: novaParticDescricao.trim(),
      })
      if (error) throw error
      setNovaParticDescricao('')
      await carregarParticularidades(editando.id)
      toast('Particularidade registrada!')
    } catch (e) {
      toast('Erro ao registrar: ' + e.message, 'error')
    }
    setSalvandoPartic(false)
  }

  async function excluirParticularidade(id) {
    if (!window.confirm('Remover essa particularidade?')) return
    await supabase.from('particularidades').delete().eq('id', id)
    await carregarParticularidades(editando?.id)
    toast('Removida.')
  }

  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [fltStatus, setFltStatus] = useState('')
  const [fltCompDe, setFltCompDe] = useState('')
  const [fltCompAte, setFltCompAte] = useState('')
  const [fltTomador, setFltTomador] = useState('')
  const [fltMedico, setFltMedico] = useState('')
  const [sortKey, setSortKey] = useState('criado_em')
  const [sortDir, setSortDir] = useState('desc')
  const [medSel, setMedSel] = useState([])
  const [form, setForm] = useState({ nf: '', tomador: '', tomador_cnpj: '', comp: '', mes_recebimento: '', valor_recebido_real: '', data_pagamento: '', data_vencimento: '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
  // Importação Excel médicos
  const [importPreview, setImportPreview] = useState([])
  const [importErro, setImportErro] = useState('')
  const [importTotal, setImportTotal] = useState(0)
  const importRef = useRef()
  // Relatório
  const [relTipo, setRelTipo] = useState('mes')
  const [relMes, setRelMes] = useState(new Date().toISOString().substring(0, 7))
  const [relDe, setRelDe] = useState('')
  const [relAte, setRelAte] = useState('')
  const [prefillIds, setPrefillIds] = useState([])
  // Extrato (nova aba)
  const [linhasExtrato, setLinhasExtrato] = useState([])
  const [loadingExtrato, setLoadingExtrato] = useState(false)
  const [sincronizandoExtrato, setSincronizandoExtrato] = useState(false)
  const [corrigindoStatus, setCorrigindoStatus] = useState(false)
  const [modalAvisoNota, setModalAvisoNota] = useState(null) // nota selecionada, ou null
  const [buscaExtratoConfirmado, setBuscaExtratoConfirmado] = useState('')
  const [expandidoExtratoConfirmado, setExpandidoExtratoConfirmado] = useState(null)
  const [editandoExtratoId, setEditandoExtratoId] = useState(null)
  const [editFormExtrato, setEditFormExtrato] = useState({ data: '', valor: '', medico_nome: '', nf: '' })
  const extratoFileRef = useRef()

  useEffect(() => {
    const raw = localStorage.getItem('aunordmed_prefill_nota')
    if (!raw) return
    try {
      const p = JSON.parse(raw)
      setEditando(null)
      setForm({ nf: '', tomador: p.tomador || '', comp: p.comp || '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
      setMedSel((p.medicos || []).map(m => ({ nome: m.nome, crm: '', ret: 13, valor: m.valor || '' })))
      setPrefillIds(p.solicitacaoIds || [])
      setAbaModal('dados')
      setImportPreview([])
      setImportErro('')
      setModalOpen(true)
    } catch {}
    localStorage.removeItem('aunordmed_prefill_nota')
  }, [])

  const medicosOrdenados = useMemo(() => [...medicos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [medicos])

  // Tomadores cadastrados, ordenados, com CNPJ — usado no formulário da nota pra
  // evitar confusão entre filiais que compartilham o mesmo nome.
  const tomadoresOrdenados = useMemo(() => [...tomadores].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')), [tomadores])

  function buscarTomadorPorNomeExato(nome) {
    return tomadores.find(t => t.nome === nome)
  }

  // Cadastro rápido de tomador, direto do formulário da nota
  const [cadastroTomadorAberto, setCadastroTomadorAberto] = useState(false)
  const [novoTomadorCnpj, setNovoTomadorCnpj] = useState('')
  const [salvandoTomador, setSalvandoTomador] = useState(false)

  async function cadastrarTomadorRapido() {
    if (!form.tomador?.trim()) { toast('Digite o nome do tomador primeiro.', 'error'); return }
    setSalvandoTomador(true)
    try {
      const { error } = await supabase.from('tomadores').insert({ nome: form.tomador.trim(), cnpj: novoTomadorCnpj.trim() || null })
      if (error) throw error
      setForm(f => ({ ...f, tomador_cnpj: novoTomadorCnpj.trim() || '' }))
      setCadastroTomadorAberto(false)
      setNovoTomadorCnpj('')
      toast('Tomador cadastrado!')
      onRefresh?.()
    } catch (e) {
      toast('Erro ao cadastrar: ' + e.message, 'error')
    }
    setSalvandoTomador(false)
  }

  const tomadoresLista = useMemo(() => [...new Set(notas.map(n => n.tomador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [notas])

  // Rótulo do tomador no filtro, mostrando o CNPJ do cadastro quando existir —
  // ajuda a diferenciar filiais que usam o mesmo nome.
  function rotuloTomador(nome) {
    const cad = tomadores.find(t => t.nome === nome)
    return cad?.cnpj ? `${nome} — CNPJ ${cad.cnpj}` : nome
  }
  // Quanto foi realmente pago (segundo o extrato bancário) por número de NF —
  // usado pra detectar quando uma nota foi paga a menor do que o repasse calculado.
  const pagoRealPorNf = useMemo(() => {
    const m = {}
    extratoBancario.forEach(e => {
      if (!e.nf) return
      m[e.nf] = (m[e.nf] || 0) + (e.valor || 0)
    })
    return m
  }, [extratoBancario])

  // "Paga a menor": só faz sentido quando JÁ HOUVE algum pagamento registrado pra essa NF
  // (senão seria só "ainda não paga", não "paga a menor").
  function notaPagaAMenor(nota) {
    const pago = pagoRealPorNf[nota.nf]
    if (!pago) return false
    return pago < (nota.total_repasse || 0) - 0.01
  }

  // ── ABA CONCILIAÇÃO: situação de cada nota, extrato x sistema, num só lugar ──
  const [fConcSituacao, setFConcSituacao] = useState('') // '' | 'bate' | 'menor' | 'maior' | 'sem_pagamento'
  const [fConcTomador, setFConcTomador] = useState('')
  const [fConcMedico, setFConcMedico] = useState('')
  const [fConcCompDe, setFConcCompDe] = useState('')
  const [fConcCompAte, setFConcCompAte] = useState('')

  function situacaoConciliacao(nota) {
    const esperado = nota.total_repasse || 0
    const pago = pagoRealPorNf[nota.nf] || 0
    if (!pago) return 'sem_pagamento'
    if (Math.abs(pago - esperado) <= 0.01) return 'bate'
    if (pago < esperado) return 'menor'
    return 'maior'
  }

  const linhasConciliacao = useMemo(() => {
    let out = notas.map(n => ({
      nota: n,
      esperado: n.total_repasse || 0,
      pago: pagoRealPorNf[n.nf] || 0,
      situacao: situacaoConciliacao(n),
    }))
    if (fConcSituacao) out = out.filter(l => l.situacao === fConcSituacao)
    if (fConcTomador) out = out.filter(l => l.nota.tomador === fConcTomador)
    if (fConcMedico) out = out.filter(l => (l.nota.medicos_nota || []).some(mn => mn.nome === fConcMedico))
    if (fConcCompDe) out = out.filter(l => l.nota.comp && l.nota.comp >= fConcCompDe)
    if (fConcCompAte) out = out.filter(l => l.nota.comp && l.nota.comp <= fConcCompAte)
    // Prioriza mostrar primeiro o que não bate, depois o que está sem pagamento, depois o que bate
    const ordem = { menor: 0, maior: 1, sem_pagamento: 2, bate: 3 }
    out.sort((a, b) => (ordem[a.situacao] ?? 9) - (ordem[b.situacao] ?? 9))
    return out
  }, [notas, pagoRealPorNf, fConcSituacao, fConcTomador, fConcMedico, fConcCompDe, fConcCompAte])

  const resumoConciliacao = useMemo(() => {
    const todas = notas.map(n => situacaoConciliacao(n))
    return {
      bate: todas.filter(s => s === 'bate').length,
      menor: todas.filter(s => s === 'menor').length,
      maior: todas.filter(s => s === 'maior').length,
      semPagamento: todas.filter(s => s === 'sem_pagamento').length,
    }
  }, [notas, pagoRealPorNf])

  const medicosDasNotas = useMemo(() => {
    const s = new Set()
    notas.forEach(n => {
      const meds = n.medicos_nota?.length ? n.medicos_nota : (n.nomes_medicos ? n.nomes_medicos.split(',').map(nm => ({ nome: nm.trim() })) : [])
      meds.forEach(mn => mn.nome && s.add(mn.nome))
    })
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [notas])

  // Só os que estão de fato no cadastro — usado no filtro da Planilha,
  // que não deve listar/mostrar nomes que não são médicos cadastrados.
  const medicosCadastradosDasNotas = useMemo(() => {
    const nomesCadastrados = new Set(medicos.map(m => m.nome))
    return medicosDasNotas.filter(nome => nomesCadastrados.has(nome))
  }, [medicosDasNotas, medicos])

  // ── Planilha por médico: uma linha por (nota, médico), agrupada por médico ──
  const linhasPlanilha = useMemo(() => {
    const nomesCadastrados = new Set(medicos.map(m => m.nome))
    const out = []
    notas.forEach(n => {
      if (fPlanCompDe && n.comp && n.comp < fPlanCompDe) return
      if (fPlanCompAte && n.comp && n.comp > fPlanCompAte) return
      const pago = n.status === 'Paga ao médico'
      if (fPlanCaixa === 'pago' && !pago) return
      if (fPlanCaixa === 'pendente' && pago) return
      ;(n.medicos_nota || []).forEach((mn, idx) => {
        if (!nomesCadastrados.has(mn.nome)) return // só médicos cadastrados aparecem na planilha
        if (fPlanMedico && mn.nome !== fPlanMedico) return
        out.push({
          medico: mn.nome, medicoIndex: idx, notaId: n.id, nf: n.nf, tomador: n.tomador, comp: n.comp,
          bruto: mn.valor_bruto_medico || 0, retencao: mn.retencao_individual || 13,
          repasse: mn.repasse || 0, status: n.status, pago,
          dataPagamento: n.data_pagamento || null,
        })
      })
    })
    return out
  }, [notas, medicos, fPlanCompDe, fPlanCompAte, fPlanCaixa, fPlanMedico])

  const planilhaPorMedico = useMemo(() => {
    const m = {}
    linhasPlanilha.forEach(l => {
      if (!m[l.medico]) m[l.medico] = { medico: l.medico, linhas: [], bruto: 0, repasse: 0, pago: 0, qtd: 0 }
      m[l.medico].linhas.push(l)
      m[l.medico].bruto += l.bruto
      m[l.medico].repasse += l.repasse
      if (l.pago) m[l.medico].pago += l.repasse
      m[l.medico].qtd++
    })
    Object.values(m).forEach(g => g.linhas.sort((a, b) => (b.comp || '').localeCompare(a.comp || '')))
    return Object.values(m).sort((a, b) => a.medico.localeCompare(b.medico, 'pt-BR'))
  }, [linhasPlanilha])

  const totaisPlanilha = useMemo(() => linhasPlanilha.reduce((a, l) => ({
    bruto: a.bruto + l.bruto, repasse: a.repasse + l.repasse, pago: a.pago + (l.pago ? l.repasse : 0),
  }), { bruto: 0, repasse: 0, pago: 0 }), [linhasPlanilha])

  // ── ABA PRAZOS: situação de cada nota em relação à data de vencimento ──
  function situacaoPrazo(nota) {
    if (nota.status === 'Paga ao médico') return 'paga'
    if (!nota.data_vencimento) return 'sem_prazo'
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const venc = new Date(nota.data_vencimento.split('T')[0] + 'T00:00:00')
    const dias = Math.round((venc - hoje) / 86400000)
    if (dias < 0) return 'vencida'
    if (dias <= 5) return 'vence_breve'
    return 'em_dia'
  }

  function diasParaVencimento(nota) {
    if (!nota.data_vencimento) return null
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const venc = new Date(nota.data_vencimento.split('T')[0] + 'T00:00:00')
    return Math.round((venc - hoje) / 86400000)
  }

  const linhasPrazos = useMemo(() => {
    let out = notas.map(n => ({ nota: n, situacao: situacaoPrazo(n), dias: diasParaVencimento(n) }))
    if (fPrazoSituacao) out = out.filter(l => l.situacao === fPrazoSituacao)
    if (fPrazoTomador) out = out.filter(l => l.nota.tomador === fPrazoTomador)
    // Ordena: vencidas primeiro (mais vencida no topo), depois vence em breve, depois o resto
    const ordem = { vencida: 0, vence_breve: 1, sem_prazo: 2, em_dia: 3, paga: 4 }
    out.sort((a, b) => {
      const diffOrdem = (ordem[a.situacao] ?? 9) - (ordem[b.situacao] ?? 9)
      if (diffOrdem !== 0) return diffOrdem
      return (a.dias ?? 999) - (b.dias ?? 999)
    })
    return out
  }, [notas, fPrazoSituacao, fPrazoTomador])

  const resumoPrazos = useMemo(() => ({
    vencidas: notas.filter(n => situacaoPrazo(n) === 'vencida').length,
    venceBreve: notas.filter(n => situacaoPrazo(n) === 'vence_breve').length,
    emDia: notas.filter(n => situacaoPrazo(n) === 'em_dia').length,
    semPrazo: notas.filter(n => situacaoPrazo(n) === 'sem_prazo').length,
  }), [notas])

  const extratoPorMedico = useMemo(() => {
    const m = {}
    extratoBancario.forEach(e => {
      const nome = e.medico_nome || '(sem médico)'
      if (!m[nome]) m[nome] = { medico: nome, total: 0, qtd: 0, itens: [] }
      m[nome].total += e.valor || 0
      m[nome].qtd++
      m[nome].itens.push(e)
    })
    return Object.values(m)
      .filter(x => !buscaExtratoConfirmado || x.medico.toLowerCase().includes(buscaExtratoConfirmado.toLowerCase()))
      .sort((a, b) => a.medico.localeCompare(b.medico, 'pt-BR'))
  }, [extratoBancario, buscaExtratoConfirmado])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortArrow(key) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const filtradas = useMemo(() => {
    let f = notas.filter(n =>
      (!busca || n.nf?.toLowerCase().includes(busca.toLowerCase()) || n.tomador?.toLowerCase().includes(busca.toLowerCase())) &&
      (fltStatus === '__diferenca__'
        ? !!(n.mes_recebimento && n.mes_recebimento !== n.comp)
        : fltStatus === '__prejuizo__'
        ? (n.margem || 0) < 0
        : fltStatus === '__paga_a_menor__'
        ? notaPagaAMenor(n)
        : (!fltStatus || n.status === fltStatus)) &&
      (!fltCompDe || (n.comp && n.comp >= fltCompDe)) &&
      (!fltCompAte || (n.comp && n.comp <= fltCompAte)) &&
      (!fltTomador || n.tomador === fltTomador) &&
      (!fltMedico || (n.medicos_nota?.length ? n.medicos_nota : (n.nomes_medicos ? n.nomes_medicos.split(',').map(nm => ({ nome: nm.trim() })) : [])).some(mn => mn.nome === fltMedico))
    )
    f = [...f].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey]
      if (sortKey === 'nf') {
        // ordena numericamente quando possível (NFs são strings de números)
        const na = parseFloat(String(va || '').replace(/\D/g, '')) || 0
        const nb = parseFloat(String(vb || '').replace(/\D/g, '')) || 0
        return sortDir === 'asc' ? na - nb : nb - na
      }
      if (typeof va === 'string' || typeof vb === 'string') {
        va = va || ''; vb = vb || ''
        return sortDir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
      }
      va = va || 0; vb = vb || 0
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return f
  }, [notas, busca, fltStatus, fltCompDe, fltCompAte, fltTomador, fltMedico, sortKey, sortDir, pagoRealPorNf])

  // Resumo da lista atual (respeita os filtros aplicados acima)
  const kpisLista = useMemo(() => {
    const bruto = filtradas.reduce((a, n) => a + (n.bruto || 0), 0)
    const repasse = filtradas.reduce((a, n) => a + (n.total_repasse || 0), 0)
    const margem = filtradas.reduce((a, n) => a + (n.margem || 0), 0)
    const pendentes = filtradas.filter(n => n.status !== 'Paga ao médico').length
    return { qtd: filtradas.length, bruto, repasse, margem, pendentes }
  }, [filtradas])

  const notasRel = useMemo(() => {
    if (relTipo === 'todos') return notas
    if (relTipo === 'mes') return relMes ? notas.filter(n => n.comp === relMes) : notas
    return notas.filter(n => {
      if (!n.comp) return false
      if (relDe && n.comp < relDe) return false
      if (relAte && n.comp > relAte) return false
      return true
    })
  }, [notas, relTipo, relMes, relDe, relAte])

  const byComp = useMemo(() => {
    const m = {}
    notasRel.forEach(n => {
      const k = n.comp || 'S/D'
      if (!m[k]) m[k] = { comp: k, label: fmtMes(k), bruto: 0, recebido: 0, repasse: 0, margem: 0, count: 0 }
      m[k].bruto += n.bruto || 0
      m[k].recebido += n.recebido || 0
      m[k].repasse += n.total_repasse || 0
      m[k].margem += n.margem || 0
      m[k].count++
    })
    return Object.values(m).sort((a, b) => a.comp.localeCompare(b.comp))
  }, [notasRel])

  const totaisRel = useMemo(() => notasRel.reduce((a, n) => ({
    bruto: a.bruto + (n.bruto || 0),
    recebido: a.recebido + (n.recebido || 0),
    repasse: a.repasse + (n.total_repasse || 0),
    margem: a.margem + (n.margem || 0),
    count: a.count + 1
  }), { bruto: 0, recebido: 0, repasse: 0, margem: 0, count: 0 }), [notasRel])

  const v = calcNota(form.bruto, medSel)

  const abrirNova = () => {
    setEditando(null)
    setForm({ nf: '', tomador: '', tomador_cnpj: '', comp: '', mes_recebimento: '', valor_recebido_real: '', data_pagamento: '', data_vencimento: '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
    setMedSel([])
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    setParticularidadesDaNota([])
    setModalOpen(true)
  }

  const abrirEditar = (nota) => {
    setEditando(nota)
    setForm({ nf: nota.nf || '', tomador: nota.tomador || '', tomador_cnpj: nota.tomador_cnpj || '', comp: nota.comp || '', mes_recebimento: nota.mes_recebimento || '', valor_recebido_real: nota.valor_recebido_real ?? '', data_pagamento: nota.data_pagamento?.split('T')[0] || '', data_vencimento: nota.data_vencimento?.split('T')[0] || '', emissao: nota.emissao?.split('T')[0] || '', status: nota.status || 'Emitida', obs: nota.obs || '', bruto: nota.bruto || '' })
    setMedSel(nota.medicos_nota?.map(mn => ({ nome: mn.nome, crm: mn.crm || '', ret: mn.retencao_individual || 13, valor: mn.valor_bruto_medico || '', modoValor: mn.modo_valor || 'bruto' })) || [])
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    carregarParticularidades(nota.id)
    setModalOpen(true)
  }

  const adicionarMed = (nome) => {
    if (!nome) return
    if (medSel.find(m => m.nome === nome)) { toast('Médico já adicionado.', 'error'); return }
    const med = medicos.find(m => m.nome === nome)
    if (!med) return
    const brutoTotal = parseFloat(form.bruto) || 0
    const jaAlocado = medSel.reduce((a, m) => a + (parseFloat(m.valor) || 0), 0)
    const restante = brutoTotal - jaAlocado
    const valorSugerido = restante > 0 ? restante.toFixed(2) : ''
    setMedSel(prev => [...prev, { nome, crm: med?.crm || '', ret: med?.retencao || 13, valor: valorSugerido, modoValor: 'bruto' }])
  }

  // Importação Excel médicos
  const processarExcelMedicos = async (file) => {
    setImportErro('')
    setImportPreview([])
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (rows.length < 2) { setImportErro('Arquivo vazio.'); return }

      const header = rows[0].map(h => String(h).toLowerCase().trim())
      const colMed = header.findIndex(h => h.includes('médico') || h.includes('medico') || h.includes('nome'))
      const colVal = header.findIndex(h => h.includes('valor') || h.includes('subtotal') || h.includes('sub'))
      const colRet = header.findIndex(h => h.includes('reten') || h.includes('%'))

      if (colMed < 0 || colVal < 0) {
        setImportErro('Colunas não encontradas. O arquivo precisa ter colunas "Médico" e "Valor".')
        return
      }

      // Função de similaridade: compara primeiro e segundo nome
      const nomeSimilar = (nomeArquivo, nomeSistema) => {
        const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        const a = norm(nomeArquivo).split(' ').filter(Boolean)
        const b = norm(nomeSistema).split(' ').filter(Boolean)
        // Igual exato
        if (norm(nomeArquivo) === norm(nomeSistema)) return true
        // Primeiro e segundo nome batem
        if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1]) return true
        // Primeiro nome bate e último nome bate
        if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length-1] === b[b.length-1]) return true
        // Arquivo contém os dois primeiros nomes do sistema
        if (b.length >= 2 && a.includes(b[0]) && a.includes(b[1])) return true
        // Sistema contém os dois primeiros nomes do arquivo
        if (a.length >= 2 && b.includes(a[0]) && b.includes(a[1])) return true
        return false
      }

      const preview = []
      rows.slice(1).forEach(row => {
        if (!row.some(c => c !== '')) return
        const nomeMed = String(row[colMed] || '').trim()
        // Ignorar linha de total
        if (nomeMed.toUpperCase() === 'TOTAL' || nomeMed.toUpperCase() === 'TOTAL GERAL') return
        const valorStr = String(row[colVal] || '0').replace(/[R$\s.]/g, '').replace(',', '.')
        const valor = parseFloat(valorStr) || 0
        const ret = colRet >= 0 ? parseFloat(String(row[colRet] || '13').replace(',', '.')) || 13 : 13
        if (!nomeMed || valor <= 0) return

        // Buscar médico por similaridade (nome exato, primeiro+segundo nome, primeiro+último)
        const medCad = medicos.find(m => nomeSimilar(nomeMed, m.nome))
        preview.push({
          nome: nomeMed,
          nomeCadastrado: medCad?.nome || '',
          crm: medCad?.crm || '',
          ret,
          valor,
          encontrado: !!medCad,
          similar: !!medCad && medCad.nome.toLowerCase() !== nomeMed.toLowerCase()
        })
      })

      if (!preview.length) { setImportErro('Nenhum médico encontrado no arquivo.'); return }

      // Total é a SOMA dos individuais (ignora linha TOTAL do Excel)
      const total = preview.reduce((a, m) => a + m.valor, 0)
      setImportTotal(total)

      const bruto = parseFloat(form.bruto) || 0
      const diff = Math.abs(total - bruto)
      if (bruto > 0 && diff > 0.01) {
        setImportErro(`DIFERENÇA: Total importado R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ≠ Valor bruto da nota R$ ${bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — Diferença: R$ ${diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
      }

      setImportPreview(preview)
    } catch(e) { setImportErro('Erro ao ler arquivo: ' + e.message) }
  }

  const confirmarImport = () => {
    const novos = importMedPreview => importMedPreview.map(m => ({
      nome: m.nomeCadastrado || m.nome, crm: m.crm || '', ret: m.ret, valor: String(m.valor), modoValor: 'bruto'
    }))
    setMedSel(novos(importPreview))
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    toast(`${importPreview.length} médico(s) importado(s)!`)
  }

  const salvar = async () => {
    if (!form.nf || !form.tomador || !form.bruto) { toast('Preencha NF, tomador e valor bruto.', 'error'); return }
    // Removido o bloqueio antigo que exigia soma dos médicos === bruto da nota.
    // Agora é permitido o total repassado ser maior (ou menor) que o bruto — o aviso
    // visual continua aparecendo, mas não impede mais de salvar.
    const calc = calcNota(form.bruto, medSel)
    const medicos_nota = calc.meds.length ? calc.meds.map(ms => ({
      nome: ms.nome, crm: ms.crm || '',
      valor_bruto_medico: parseFloat(ms.valor) || 0,
      retencao_individual: parseFloat(ms.ret) || 13,
      modo_valor: ms.modoValor || 'bruto',
      repasse: ms.repasse,
    })) : []
    const payload = {
      ...form, bruto: calc.bruto, recebido: calc.recebido, total_repasse: calc.totalRepasse,
      margem: calc.margem, pct_margem: calc.pct_margem,
      ir: calc.ir, csll: calc.csll, pis: calc.pis, cofins: calc.cofins,
      mes_recebimento: form.mes_recebimento || null,
      valor_recebido_real: form.valor_recebido_real !== '' ? parseFloat(form.valor_recebido_real) : null,
      data_pagamento: form.data_pagamento || null,
      data_vencimento: form.data_vencimento || null,
      medicos_nota: medicos_nota.length ? medicos_nota : null, nomes_medicos: medSel.map(m => m.nome).join(', ') || null
    }
    setLoading(true)
    try {
      if (editando) {
        const { error } = await supabase.from('notas_fiscais').update(payload).eq('id', editando.id)
        if (error) throw error
        registrarAuditoria('nota_editada', editando.id, {
          nf: payload.nf,
          bruto_antes: editando.bruto, bruto_depois: payload.bruto,
          status_antes: editando.status, status_depois: payload.status,
        })
        await sincronizarExtratoDaNota({ ...editando, ...payload, id: editando.id, nf: payload.nf || editando.nf })
        toast('Nota atualizada!')
      } else {
        const { data: nova, error } = await supabase.from('notas_fiscais').insert(payload).select().single()
        if (error) throw error
        registrarAuditoria('nota_criada', nova?.id, { nf: payload.nf, tomador: payload.tomador, bruto: payload.bruto })
        for (const ms of medSel) {
          const med = medicos.find(m => m.nome === ms.nome)
          const repMed = parseFloat(ms.valor || 0) * (1 - parseFloat(ms.ret || 13) / 100)
          try {
            await supabase.from('comprovantes').insert({ token: uid(), nf_id: nova?.id, medico_nome: ms.nome, medico_crm: med?.crm || null, tomador: form.tomador, valor_repasse: repMed, competencia: form.comp || null, dados_extras: { nf: form.nf, pix: med?.chave_pix } })
          } catch (e) {}
        }
        if (prefillIds.length) {
          try {
            await supabase.from('solicitacoes_medicos').update({ status: 'Nota emitida', nota_fiscal_id: nova?.id }).in('id', prefillIds)
          } catch (e) {}
          setPrefillIds([])
        }
        toast('Nota adicionada!')
      }
      setModalOpen(false)
      onRefresh()
    } catch(e) { toast('Erro ao salvar: ' + e.message, 'error') }
    setLoading(false)
  }

  // ── ABA EXTRATO: importar CSV, casar com médicos das notas, salvar ──
  function processarExtratoNota(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const parsed = parseExtratoCSV(e.target.result)
      if (!parsed.length) { toast('Não encontrei nenhuma linha de saída (débito) com valor válido no CSV.', 'error'); return }
      const comSugestao = cruzarExtratoComNotasEMedicos(parsed, notas, medicos)
      // Marca como duplicada qualquer transação que já exista no extrato_bancario
      // (mesma data e mesmo valor, com pequena margem de centavos)
      const comDuplicidade = comSugestao.map(l => {
        const jaExiste = extratoBancario.some(e =>
          e.data === l.data && Math.abs((e.valor || 0) - l.valor) <= 0.01
        )
        return { ...l, jaImportada: jaExiste }
      })
      setLinhasExtrato(comDuplicidade)
      const sugeridos = comDuplicidade.filter(l => l.medico && !l.jaImportada).length
      const duplicadas = comDuplicidade.filter(l => l.jaImportada).length
      toast(`${parsed.length} transação(ões) de saída · ${sugeridos} sugerida(s)${duplicadas ? ` · ${duplicadas} já importada(s) antes` : ''}`)
    }
    reader.onerror = () => toast('Erro ao ler o arquivo.', 'error')
    reader.readAsText(file, 'ISO-8859-1')
  }

  function atualizarLinhaExtrato(i, campo, valor) {
    setLinhasExtrato(prev => prev.map((l, j) => j === i ? { ...l, [campo]: valor } : l))
  }

  function removerLinhaExtrato(i) {
    setLinhasExtrato(prev => prev.filter((_, j) => j !== i))
  }

  async function salvarExtratoNota() {
    const validas = linhasExtrato.filter(l => l.medico && !l.jaImportada)
    if (!validas.length) { toast('Preencha o médico de pelo menos uma linha (não duplicada) antes de salvar.', 'error'); return }
    setLoadingExtrato(true)
    let sucesso = 0, falhas = 0

    // 1) Salva cada transação no extrato_bancario (fonte usada pelo Regime de Caixa / Comprovante)
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

    // 2) Se TODOS os médicos de uma nota já têm transação identificada, marca a data de
    //    pagamento OFICIAL (a data real que veio do extrato do banco) e o status da nota
    const notasAfetadas = new Map()
    validas.forEach(l => {
      if (!l.notaId) return
      if (!notasAfetadas.has(l.notaId)) notasAfetadas.set(l.notaId, new Set())
      notasAfetadas.get(l.notaId).add(l.medico)
    })
    for (const [notaId, medicosPagos] of notasAfetadas) {
      const nota = notas.find(n => n.id === notaId)
      if (!nota) continue
      const totalMedicos = (nota.medicos_nota || []).length
      if (totalMedicos > 0 && medicosPagos.size >= totalMedicos) {
        const datasDaNota = validas.filter(l => l.notaId === notaId).map(l => l.data).filter(Boolean)
        const dataMaisRecente = datasDaNota.sort().slice(-1)[0] || null
        try {
          await supabase.from('notas_fiscais').update({ data_pagamento: dataMaisRecente, status: 'Paga ao médico' }).eq('id', notaId)
        } catch (e) {}
      }
    }

    setLoadingExtrato(false)
    toast(`${sucesso} transação(ões) salva(s)${falhas ? ` · ${falhas} falha(s)` : ''}`)
    setLinhasExtrato(prev => prev.filter(l => !l.medico))
    onRefresh()
  }

  async function excluirExtratoConfirmado(item) {
    if (!window.confirm(`Excluir esse recebimento de ${item.medico_nome} (${brl(item.valor)}) do extrato confirmado?`)) return
    await supabase.from('extrato_bancario').delete().eq('id', item.id)
    toast('Transação removida do extrato.')
    onRefresh()
  }

  function abrirEdicaoExtrato(item) {
    setEditandoExtratoId(item.id)
    setEditFormExtrato({
      data: item.data ? String(item.data).split('T')[0] : '',
      valor: String(item.valor ?? ''),
      medico_nome: item.medico_nome || '',
      nf: item.nf || '',
    })
  }

  function cancelarEdicaoExtrato() { setEditandoExtratoId(null) }

  async function salvarEdicaoExtrato(itemOriginal) {
    if (!editFormExtrato.medico_nome || !editFormExtrato.valor) { toast('Médico e valor são obrigatórios.', 'error'); return }
    try {
      const { error } = await supabase.from('extrato_bancario').update({
        data: editFormExtrato.data || null,
        valor: parseFloat(editFormExtrato.valor) || 0,
        medico_nome: editFormExtrato.medico_nome,
        nf: editFormExtrato.nf || null,
      }).eq('id', itemOriginal.id)
      if (error) throw error
      toast('Transação atualizada!')
      setEditandoExtratoId(null)
      onRefresh()
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'error')
    }
  }

  const excluir = async (id) => {
    if (!window.confirm('Excluir esta nota?')) return
    await supabase.from('notas_fiscais').delete().eq('id', id)
    toast('Nota removida.')
    onRefresh()
  }

  // Quando uma nota é marcada como "Paga ao médico", garante que cada médico
  // dela tenha um lançamento no extrato_bancario (data + valor do repasse).
  // Não duplica se já existir um lançamento pra essa NF + médico.
  // Monta a data de referência mais fiel possível pra um pagamento, SEM nunca
  // inventar "hoje" — se não houver informação real, usa a competência (mais
  // próximo da verdade que uma data arbitrária) ou deixa em branco.
  function dataReferenciaPagamento(nota) {
    if (nota.data_pagamento) return nota.data_pagamento
    if (nota.mes_recebimento) return `${nota.mes_recebimento}-01`
    if (nota.comp) return `${nota.comp}-01`
    return null
  }

  // Considera duplicata só quando NF + médico + data + valor batem exatamente —
  // isso evita duplicar de verdade, mas ainda permite duas notas diferentes que
  // por acaso reaproveitam o mesmo número de NF em meses diferentes.
  function existeNoExtrato(lista, { nf, medico, data, valor }) {
    return lista.some(e =>
      e.nf === nf && e.medico_nome === medico && e.data === data && Math.abs((e.valor || 0) - valor) <= 0.01
    )
  }

  async function sincronizarExtratoDaNota(nota) {
    if (!nota || nota.status !== 'Paga ao médico' || !nota.medicos_nota?.length) return
    const dataRef = dataReferenciaPagamento(nota)
    for (const mn of nota.medicos_nota) {
      const valor = mn.repasse || 0
      if (existeNoExtrato(extratoBancario, { nf: nota.nf, medico: mn.nome, data: dataRef, valor })) continue
      try {
        await supabase.from('extrato_bancario').insert({
          data: dataRef,
          valor,
          medico_nome: mn.nome,
          nf: nota.nf,
          descricao: '(gerado automaticamente ao marcar a nota como paga)',
          conferido: true,
        })
      } catch (e) {}
    }
  }

  // Sincronização retroativa: varre TODAS as notas já marcadas "Paga ao médico"
  // (inclusive as que já estavam assim antes dessa funcionalidade existir) e cria
  // no extrato_bancario o que estiver faltando, sem duplicar o que já existe.
  function abrirEdicaoPlanilha(linha) {
    setEditandoPlanId(`${linha.notaId}-${linha.medicoIndex}`)
    setEditFormPlan({
      comp: linha.comp || '', nf: linha.nf || '', tomador: linha.tomador || '',
      medico: linha.medico || '', bruto: String(linha.bruto ?? ''), retencao: String(linha.retencao ?? 13),
      status: linha.status || 'Emitida', dataPagamento: linha.dataPagamento || '',
    })
  }

  function cancelarEdicaoPlanilha() { setEditandoPlanId(null) }

  async function salvarEdicaoPlanilha(linha) {
    if (!editFormPlan.medico || editFormPlan.bruto === '') { toast('Médico e valor bruto são obrigatórios.', 'error'); return }
    const nota = notas.find(n => n.id === linha.notaId)
    if (!nota) { toast('Nota não encontrada.', 'error'); return }
    setSalvandoPlan(true)
    try {
      const novoBruto = parseFloat(editFormPlan.bruto) || 0
      const novaRetencao = parseFloat(editFormPlan.retencao) || 13
      const novoRepasse = novoBruto * (1 - novaRetencao / 100)
      const medicosAtualizados = [...(nota.medicos_nota || [])]
      medicosAtualizados[linha.medicoIndex] = {
        ...medicosAtualizados[linha.medicoIndex],
        nome: editFormPlan.medico,
        valor_bruto_medico: novoBruto,
        retencao_individual: novaRetencao,
        repasse: novoRepasse,
      }
      const totalRepasse = medicosAtualizados.reduce((a, m) => a + (m.repasse || 0), 0)
      const payloadNota = {
        comp: editFormPlan.comp || null,
        nf: editFormPlan.nf || null,
        tomador: editFormPlan.tomador || null,
        status: editFormPlan.status,
        data_pagamento: editFormPlan.dataPagamento || null,
        medicos_nota: medicosAtualizados,
        total_repasse: totalRepasse,
        nomes_medicos: medicosAtualizados.map(m => m.nome).join(', '),
      }
      const { error } = await supabase.from('notas_fiscais').update(payloadNota).eq('id', nota.id)
      if (error) throw error
      // Se virou "Paga ao médico", já sincroniza o extrato bancário também
      if (payloadNota.status === 'Paga ao médico') {
        await sincronizarExtratoDaNota({ ...nota, ...payloadNota })
      }
      toast('Linha atualizada!')
      setEditandoPlanId(null)
      onRefresh()
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'error')
    }
    setSalvandoPlan(false)
  }

  async function sincronizarTodasNotasPagas() {
    setSincronizandoExtrato(true)
    const notasPagas = notas.filter(n => n.status === 'Paga ao médico' && n.medicos_nota?.length)
    let criados = 0, jaExistiam = 0, semData = 0
    const criadosNesteLote = []
    for (const nota of notasPagas) {
      const dataRef = dataReferenciaPagamento(nota)
      for (const mn of nota.medicos_nota) {
        const valor = mn.repasse || 0
        const chaveLote = { nf: nota.nf, medico: mn.nome, data: dataRef, valor }
        const jaExisteNoBanco = existeNoExtrato(extratoBancario, chaveLote) || existeNoExtrato(criadosNesteLote, chaveLote)
        if (jaExisteNoBanco) { jaExistiam++; continue }
        if (!dataRef) semData++
        try {
          await supabase.from('extrato_bancario').insert({
            data: dataRef, valor, medico_nome: mn.nome, nf: nota.nf,
            descricao: '(sincronizado retroativamente de notas já pagas)', conferido: true,
          })
          criadosNesteLote.push({ nf: nota.nf, medico_nome: mn.nome, data: dataRef, valor })
          criados++
        } catch (e) {}
      }
    }
    setSincronizandoExtrato(false)
    toast(`${criados} lançamento(s) criado(s) · ${jaExistiam} já existiam${semData ? ` · ${semData} sem data conhecida (preencher manualmente)` : ''}`)
    onRefresh()
  }

  // Corrige o histórico: usa o que já está importado no extrato_bancario
  // (de importações anteriores, mesmo antes da correção do bug de status) pra
  // marcar retroativamente as notas como "Paga ao médico" quando TODOS os
  // médicos daquela nota já têm um lançamento correspondente no extrato.
  // Não precisa reimportar CSV nenhum — usa o que já está salvo.
  async function corrigirStatusUsandoExtratoExistente() {
    setCorrigindoStatus(true)
    const candidatas = notas.filter(n => n.status !== 'Paga ao médico' && n.medicos_nota?.length)
    let corrigidas = 0
    for (const nota of candidatas) {
      const medicosComMatch = []
      for (const mn of nota.medicos_nota) {
        const match = extratoBancario.find(e =>
          (e.nf && e.nf === nota.nf && e.medico_nome === mn.nome) ||
          (!e.nf && e.medico_nome === mn.nome && Math.abs((e.valor || 0) - (mn.repasse || 0)) <= 0.02)
        )
        if (match) medicosComMatch.push(match)
      }
      if (medicosComMatch.length > 0 && medicosComMatch.length === nota.medicos_nota.length) {
        const datas = medicosComMatch.map(m => m.data).filter(Boolean).sort()
        const dataRef = datas[datas.length - 1] || nota.data_pagamento || null
        try {
          await supabase.from('notas_fiscais').update({ status: 'Paga ao médico', data_pagamento: dataRef }).eq('id', nota.id)
          corrigidas++
        } catch (e) {}
      }
    }
    setCorrigindoStatus(false)
    toast(`${corrigidas} nota(s) corrigida(s) para "Paga ao médico", usando o extrato já importado`)
    onRefresh()
  }

  // Trilha de auditoria automática — grava um evento sempre que algo relevante
  // muda numa nota, sem precisar de ação manual. Nunca sobrescreve nada, só soma.
  async function registrarAuditoria(acao, registroId, dados) {
    try {
      let usuarioEmail = null
      try { const { data } = await getUser(); usuarioEmail = data?.user?.email || null } catch (e) {}
      await supabase.from('auditoria').insert({
        usuario_email: usuarioEmail, acao, tabela: 'notas_fiscais', registro_id: registroId, dados,
      })
    } catch (e) { /* auditoria não deve travar a ação principal se falhar */ }
  }

  const alterarStatus = async (id, status) => {
    const notaAntes = notas.find(n => n.id === id)
    await supabase.from('notas_fiscais').update({ status }).eq('id', id)
    registrarAuditoria('status_alterado', id, { nf: notaAntes?.nf, status_anterior: notaAntes?.status, status_novo: status })
    if (status === 'Paga ao médico') {
      const nota = notas.find(n => n.id === id)
      if (nota) await sincronizarExtratoDaNota({ ...nota, status })
    }
    onRefresh()
  }

  const gerarComprovante = async (nota) => {
    if (!nota.medicos_nota?.length) { toast('Esta nota não tem médicos vinculados.', 'error'); return }
    setLoading(true)
    let gerados = 0
    for (const mn of nota.medicos_nota) {
      try {
        const med = medicos.find(m => m.nome === mn.nome)
        const repasse = mn.repasse || (mn.valor_bruto_medico * (1 - (mn.retencao_individual || 13) / 100))
        // Verificar se já existe comprovante para essa nota + médico
        const { data: exist } = await supabase.from('comprovantes').select('id').eq('nf_id', nota.id).eq('medico_nome', mn.nome).maybeSingle()
        if (exist) { toast(`Comprovante de ${mn.nome} já existe.`, 'error'); continue }
        await supabase.from('comprovantes').insert({
          token: uid(),
          nf_id: nota.id,
          medico_nome: mn.nome,
          medico_crm: mn.crm || med?.crm || null,
          tomador: nota.tomador,
          valor_repasse: repasse,
          competencia: nota.comp || null,
          dados_extras: { nf: nota.nf, pix: med?.chave_pix, tipo_pix: med?.tipo_pix }
        })
        gerados++
      } catch(e) {}
    }
    setLoading(false)
    if (gerados > 0) { toast(`${gerados} comprovante(s) gerado(s) com sucesso!`); onRefresh() }
  }

  // Aviso de "NF emitida" — mensagem informativa pro médico, deixando claro
  // que ainda NÃO é o pagamento, só a emissão da nota. Inclui link público
  // (comprovante_emissao.html), reaproveitando a mesma tabela "comprovantes",
  // distinguindo pelo campo "tipo" = 'emissao'.
  const BASE_URL_COMPROVANTES = 'https://aunordmed-app1.vercel.app'

  // Link permanente de visualização do faturamento (baseado nas notas, não no
  // extrato) — gera um token único por médico na primeira vez, e reaproveita
  // depois. Diferente do comprovante, esse link não muda por nota, é fixo pro médico.
  async function copiarLinkFaturamentoMedico(nomeMedico) {
    const med = medicos.find(m => m.nome === nomeMedico)
    if (!med) { toast('Médico não encontrado no cadastro.', 'error'); return }
    try {
      let token = med.token_portal
      if (!token) {
        token = uid()
        const { error } = await supabase.from('medicos').update({ token_portal: token }).eq('id', med.id)
        if (error) throw error
        onRefresh()
      }
      const link = `${BASE_URL_COMPROVANTES}/faturamento_medico.html?token=${token}`
      const msg = `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${med.nome}*!\nSeu painel de faturamento está disponível — sempre atualizado, é só abrir quando quiser conferir.\n📄 Acesse:\n${link}\n\n_AunordMED — Gestão financeira médica_`
      await navigator.clipboard.writeText(msg)
      toast('Mensagem copiada! Já pode colar no WhatsApp.')
    } catch (e) {
      toast('Erro ao gerar link: ' + e.message, 'error')
    }
  }

  async function obterOuCriarComprovanteEmissao(nota, mn) {
    try {
      const { data: existentes, error: erroSelect } = await supabase.from('comprovantes')
        .select('token')
        .eq('nf_id', nota.id)
        .eq('medico_nome', mn.nome)
        .eq('tipo', 'emissao')
        .limit(1)
      if (erroSelect) throw erroSelect
      if (existentes?.length) return { token: existentes[0].token, erro: null }
      const token = uid()
      const { error: erroInsert } = await supabase.from('comprovantes').insert({
        token, nf_id: nota.id, medico_nome: mn.nome, tomador: nota.tomador,
        valor_repasse: mn.repasse || 0, competencia: nota.comp || null,
        tipo: 'emissao',
        dados_extras: { nf: nota.nf, bruto: mn.valor_bruto_medico || 0 },
      })
      if (erroInsert) throw erroInsert
      return { token, erro: null }
    } catch (e) {
      return { token: null, erro: e.message || 'Erro desconhecido ao salvar o comprovante.' }
    }
  }

  async function montarMensagemAvisoEmissao(nota, mn) {
    const { token, erro } = await obterOuCriarComprovanteEmissao(nota, mn)
    const link = token ? `${BASE_URL_COMPROVANTES}/comprovante_emissao.html?token=${token}` : null
    const msg = `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${mn.nome}*!\nSua nota fiscal *#${nota.nf || '—'}* foi *emitida*.\n🏢 *Tomador:* ${nota.tomador || '—'}\n📅 *Competência:* ${fmtMes(nota.comp)}\n💰 *Valor bruto:* R$ ${(mn.valor_bruto_medico || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${link ? `\n📄 Acesse:\n${link}` : ''}\n\n_Este é só um aviso de emissão — o repasse ainda será processado e comunicado separadamente._\n_AunordMED — Gestão financeira médica_`
    return { msg, erro }
  }

  async function enviarAvisoEmissao(nota, mn) {
    const med = medicos.find(m => m.nome === mn.nome)
    const tel = med?.telefone_whatsapp || med?.telefone
    toast('Preparando aviso…')
    const { msg, erro } = await montarMensagemAvisoEmissao(nota, mn)
    if (erro) { toast('⚠️ O link não pôde ser salvo (' + erro + ') — mensagem gerada sem link.', 'error') }
    if (!tel) {
      navigator.clipboard.writeText(msg).then(() => toast(`${mn.nome} sem WhatsApp cadastrado — mensagem copiada.`, 'error'))
      return
    }
    window.open(`https://wa.me/${tel.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
    if (!erro) toast('Abrindo WhatsApp…')
  }

  async function copiarAvisoEmissao(nota, mn) {
    toast('Preparando aviso…')
    const { msg, erro } = await montarMensagemAvisoEmissao(nota, mn)
    if (erro) { toast('⚠️ O link não pôde ser salvo (' + erro + ') — mensagem copiada sem link.', 'error') }
    navigator.clipboard.writeText(msg).then(() => { if (!erro) toast('Mensagem copiada!') }).catch(() => toast('Erro ao copiar.', 'error'))
  }

  function abrirAvisoEmissao(nota) {
    if (!nota.medicos_nota?.length) { toast('Esta nota não tem médicos vinculados.', 'error'); return }
    setModalAvisoNota(nota)
  }

  const exportarRelatorio = () => {
    const rows = [['NF','Tomador','Médicos','Competência','Bruto','Recebido','Repasse','Margem','% Margem','Status']]
    notasRel.forEach(n => rows.push([n.nf, n.tomador, n.nomes_medicos, fmtMes(n.comp), +(n.bruto||0).toFixed(2), +(n.recebido||0).toFixed(2), +(n.total_repasse||0).toFixed(2), +(n.margem||0).toFixed(2), +((n.pct_margem||0)*100).toFixed(2)+'%', n.status]))
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Notas')
    XLSX.writeFile(wb, `notas_${relMes || 'periodo'}.xlsx`)
    toast('Excel exportado!')
  }

  const brutoNum = parseFloat(form.bruto) || 0
  const diffImport = Math.abs(importTotal - brutoNum)
  const importOk = brutoNum > 0 && importPreview.length > 0 && diffImport <= 0.01

  return (
    <div className="page-content">
      <style>{`
        .med-hover-wrap { position: relative; }
        .med-hover-tooltip {
          display: none;
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          z-index: 999;
          background: var(--n1);
          color: #fff;
          border-radius: var(--radius-lg);
          padding: 8px 12px;
          min-width: 220px;
          max-width: 320px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
          white-space: nowrap;
          line-height: 1.8;
        }
        .med-hover-wrap:hover .med-hover-tooltip { display: block; }
      `}</style>
      {/* Abas principais */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        {[['lista','📄 Notas fiscais'],['relatorio','📊 Relatório por período'],['extrato','🏦 Extrato'],['planilha','📋 Planilha'],['prazos','📅 Prazos'],['conciliacao','🔄 Conciliação']].map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)} style={{ padding: '8px 18px', border: 'none', borderBottom: aba===id?'2px solid var(--g5)':'2px solid transparent', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: aba===id?600:400, color: aba===id?'var(--g3)':'var(--n5)', fontFamily: 'var(--sans)' }}>
            {label}
          </button>
        ))}
        {aba === 'lista' && (
          <>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={corrigirStatusUsandoExtratoExistente} disabled={corrigindoStatus}
              title="Usa o extrato bancário já importado (mesmo de antes) pra corrigir retroativamente o status das notas que já foram pagas mas ficaram marcadas errado">
              {corrigindoStatus ? '🔧 Corrigindo…' : '🔧 Corrigir status com extrato já importado'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={sincronizarTodasNotasPagas} disabled={sincronizandoExtrato}
              title="Cria no extrato bancário os lançamentos que faltam para notas já marcadas como 'Paga ao médico' antes dessa sincronização existir">
              {sincronizandoExtrato ? '🔄 Sincronizando…' : '🔄 Sincronizar extrato com notas pagas'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={abrirNova}>+ Nova nota</button>
          </>
        )}
      </div>

      {/* ABA LISTA */}
      {aba === 'lista' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
            <div className="kpi">
              <div className="kpi-bar" style={{ background: 'var(--g5)' }} />
              <div className="kpi-icon" style={{ background: 'var(--g10)' }}>📄</div>
              <div className="kpi-label">Notas (filtro atual)</div>
              <div className="kpi-value">{kpisLista.qtd}</div>
              <div className="kpi-sub">{kpisLista.pendentes} pendente(s)</div>
            </div>
            <div className="kpi">
              <div className="kpi-bar" style={{ background: 'var(--g5)' }} />
              <div className="kpi-icon" style={{ background: 'var(--g10)' }}>💰</div>
              <div className="kpi-label">Bruto total</div>
              <div className="kpi-value">{brl(kpisLista.bruto)}</div>
              <div className="kpi-sub">Soma das notas listadas</div>
            </div>
            <div className="kpi">
              <div className="kpi-bar" style={{ background: 'var(--blue)' }} />
              <div className="kpi-icon" style={{ background: 'var(--blue-l)' }}>📤</div>
              <div className="kpi-label">Repasse total</div>
              <div className="kpi-value">{brl(kpisLista.repasse)}</div>
              <div className="kpi-sub">Devido aos médicos</div>
            </div>
            <div className="kpi">
              <div className="kpi-bar" style={{ background: kpisLista.margem >= 0 ? 'var(--g5)' : '#DC2626' }} />
              <div className="kpi-icon" style={{ background: kpisLista.margem >= 0 ? 'var(--g10)' : '#FEF2F2' }}>{kpisLista.margem >= 0 ? '✅' : '🚨'}</div>
              <div className="kpi-label">Margem total</div>
              <div className="kpi-value" style={{ color: kpisLista.margem >= 0 ? 'inherit' : '#DC2626' }}>{brl(kpisLista.margem)}</div>
              <div className="kpi-sub">{kpisLista.margem >= 0 ? 'Resultado positivo' : 'Resultado negativo'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-bar" style={{ background: 'var(--orange)' }} />
              <div className="kpi-icon" style={{ background: 'var(--orange-l)' }}>⚠️</div>
              <div className="kpi-label">Alertas</div>
              <div className="kpi-value">{notas.filter(n => (n.margem || 0) < 0).length + notas.filter(n => notaPagaAMenor(n)).length}</div>
              <div className="kpi-sub">Prejuízo + pagas a menor</div>
            </div>
          </div>

          <div className="card">
          <div className="table-toolbar">
            <span className="table-title">Notas fiscais</span>
            {notas.filter(n => (n.margem || 0) < 0).length > 0 && (
              <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                🚨 {notas.filter(n => (n.margem || 0) < 0).length} nota(s) em prejuízo
              </span>
            )}
            {notas.filter(n => notaPagaAMenor(n)).length > 0 && (
              <span style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                📉 {notas.filter(n => notaPagaAMenor(n)).length} nota(s) paga(s) a menor
              </span>
            )}
            <input className="search-input" placeholder="🔍 Buscar NF ou tomador…" value={busca} onChange={e => setBusca(e.target.value)} />
            <select className="filter-select" value={fltStatus} onChange={e => setFltStatus(e.target.value)}>
              <option value="">Todos status</option>
              <option value="Emitida">Emitida</option>
              <option value="Recebida">Recebida</option>
              <option value="Paga ao médico">Paga ao médico</option>
              <option value="__diferenca__">⚠️ Recebida com diferença</option>
              <option value="__prejuizo__">🚨 Em prejuízo (margem negativa)</option>
              <option value="__paga_a_menor__">📉 Paga a menor (extrato)</option>
            </select>
            <input type="month" className="filter-select" style={{ width: 140 }} value={fltCompDe} onChange={e => setFltCompDe(e.target.value)} title="Competência de" />
            <input type="month" className="filter-select" style={{ width: 140 }} value={fltCompAte} onChange={e => setFltCompAte(e.target.value)} title="Competência até" />
            <select className="filter-select" value={fltTomador} onChange={e => setFltTomador(e.target.value)}>
              <option value="">Todos tomadores</option>
              {tomadoresLista.map(t => <option key={t} value={t}>{rotuloTomador(t)}</option>)}
            </select>
            <select className="filter-select" value={fltMedico} onChange={e => setFltMedico(e.target.value)}>
              <option value="">Todos médicos</option>
              {medicosDasNotas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('nf')}>Nº NF{sortArrow('nf')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('tomador')}>Tomador{sortArrow('tomador')}</th>
                <th>Médicos</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('comp')}>Competência{sortArrow('comp')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('bruto')}>Bruto{sortArrow('bruto')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('total_repasse')}>Repasse{sortArrow('total_repasse')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('margem')}>Margem{sortArrow('margem')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
                <th>Ações</th>
              </tr></thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">📄</div><h4>Nenhuma nota</h4><p>Clique em "+ Nova nota" para registrar</p></div></td></tr>
                ) : filtradas.map((n) => (
                  <tr key={n.id}>
                    <td className="mono" style={{ fontWeight:600 }}>{n.nf||'—'}</td>
                    <td>{n.tomador||'—'}</td>
                    <td style={{ maxWidth:200 }}>
                      {(() => {
                        const meds = n.medicos_nota || (n.nomes_medicos ? n.nomes_medicos.split(',').map(s => ({ nome: s.trim() })) : [])
                        if (!meds.length) return '—'
                        const primeiro = meds[0].nome
                        const count = meds.length
                        return (
                          <div style={{ position:'relative', display:'inline-block' }} className="med-hover-wrap">
                            <span className="tag" style={{ cursor: count > 1 ? 'help' : 'default', display:'flex', alignItems:'center', gap:4 }}>
                              {primeiro}
                              {count > 1 && <span style={{ background:'var(--g5)', color:'#fff', borderRadius:99, fontSize:9, fontWeight:700, padding:'1px 5px', flexShrink:0 }}>+{count-1}</span>}
                            </span>
                            {count > 1 && (
                              <div className="med-hover-tooltip">
                                {meds.map((m, i) => (
                                  <div key={i} style={{ padding:'3px 0', borderBottom: i < meds.length-1 ? '1px solid rgba(255,255,255,.1)' : 'none', fontSize:11 }}>
                                    {m.nome}
                                    {m.valor_bruto_medico > 0 && <span style={{ float:'right', opacity:.7, marginLeft:8, fontFamily:'var(--mono)' }}>R$ {Number(m.valor_bruto_medico).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="mono">
                      {fmtMes(n.comp)}
                      {n.mes_recebimento && n.mes_recebimento !== n.comp && (
                        <div style={{ fontSize:10, color:'var(--orange, #D97706)', fontWeight:700 }} title="Recebido em mês diferente da competência de emissão">
                          receb. {fmtMes(n.mes_recebimento)}
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ fontWeight:600 }}>
                      {brl(n.bruto)}
                      <div style={{ fontSize:10, color:'var(--n5)', fontWeight:400 }}>líq. {brl(n.recebido)}</div>
                    </td>
                    <td className="mono" style={{ color:'var(--n4)' }}>
                      {brl(n.total_repasse||0)}
                      {notaPagaAMenor(n) && <div style={{ fontSize:9, color:'#D97706', fontWeight:700, whiteSpace:'nowrap' }} title={`Pago real: ${brl(pagoRealPorNf[n.nf])}`}>📉 Paga a menor</div>}
                    </td>
                    <td className="mono" style={{ color: n.margem < 0 ? '#DC2626' : 'var(--g3)', fontWeight:600 }}>
                      {brl(n.margem)}
                      {n.margem < 0 && <div style={{ fontSize:9, color:'#DC2626', fontWeight:700, whiteSpace:'nowrap' }}>⚠️ Prejuízo</div>}
                    </td>
                    <td>
                      <select style={{ height:26, fontSize:11, width:130, border:'1px solid var(--border)', borderRadius:6, padding:'0 6px', fontFamily:'var(--sans)' }}
                        value={n.status} onChange={e => alterarStatus(n.id, e.target.value)}>
                        <option value="Emitida">Emitida</option>
                        <option value="Recebida">Recebida</option>
                        <option value="Paga ao médico">Paga ao médico</option>
                      </select>
                    </td>
                    <td style={{ display:'flex', gap:4, paddingTop:6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => abrirEditar(n)}>✏️</button>
                      <button className="btn btn-outline btn-xs" style={{ fontSize:10, color:'var(--g3)', borderColor:'var(--g8)' }}
                        onClick={() => gerarComprovante(n)} title="Gerar comprovante para os médicos vinculados">🧾</button>
                      <button className="btn btn-outline btn-xs" style={{ fontSize:10, color:'#25D366', borderColor:'#BBF7D0' }}
                        onClick={() => abrirAvisoEmissao(n)} title="Avisar médico(s) por WhatsApp que a NF foi emitida (ainda não é pagamento)">📨</button>
                      <button className="btn btn-danger btn-xs" onClick={() => excluir(n.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}

      {/* ABA RELATÓRIO */}
      {aba === 'relatorio' && (
        <>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-body">
              <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                <div className="field"><label>Período</label>
                  <select style={{ height:36 }} value={relTipo} onChange={e => setRelTipo(e.target.value)}>
                    <option value="mes">Mês específico</option>
                    <option value="intervalo">Intervalo</option>
                    <option value="todos">Todos</option>
                  </select>
                </div>
                {relTipo==='mes' && <div className="field"><label>Mês/Ano</label><input type="month" style={{ height:36 }} value={relMes} onChange={e => setRelMes(e.target.value)}/></div>}
                {relTipo==='intervalo' && <>
                  <div className="field"><label>De</label><input type="month" style={{ height:36 }} value={relDe} onChange={e => setRelDe(e.target.value)}/></div>
                  <div className="field"><label>Até</label><input type="month" style={{ height:36 }} value={relAte} onChange={e => setRelAte(e.target.value)}/></div>
                </>}
                <button className="btn btn-ghost btn-sm" onClick={exportarRelatorio}>⬇ Exportar Excel</button>
              </div>
            </div>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:14 }}>
            {[
              { bar:'var(--g5)', ic:'var(--g10)', icon:'📄', label:'Notas', value:totaisRel.count },
              { bar:'var(--g5)', ic:'var(--g10)', icon:'💰', label:'Total bruto', value:brl(totaisRel.bruto) },
              { bar:'var(--blue)', ic:'var(--blue-l)', icon:'📥', label:'Recebido', value:brl(totaisRel.recebido), sub:'Após impostos' },
              { bar:'var(--g5)', ic:'var(--g10)', icon:'📈', label:'Margem', value:brl(totaisRel.margem), sub:totaisRel.recebido>0?pct(totaisRel.margem/totaisRel.recebido):'—' },
            ].map((k,i) => (
              <div key={i} className="kpi">
                <div className="kpi-bar" style={{ background:k.bar }}/>
                <div className="kpi-icon" style={{ background:k.ic }}>{k.icon}</div>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value">{k.value}</div>
                {k.sub && <div className="kpi-sub">{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-header"><h3>📅 Emitido por mês</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Competência</th><th style={{textAlign:'right'}}>NFs</th><th style={{textAlign:'right'}}>Bruto</th><th style={{textAlign:'right'}}>Recebido</th><th style={{textAlign:'right'}}>Repasse</th><th style={{textAlign:'right'}}>Margem</th><th style={{textAlign:'right'}}>% Margem</th>
                </tr></thead>
                <tbody>
                  {byComp.length===0 ? <tr><td colSpan={7}><div className="empty-state" style={{padding:'1.5rem'}}><p>Nenhuma nota no período</p></div></td></tr>
                  : byComp.map((m,i) => (
                    <tr key={m.comp} style={{ background:i%2===0?'#fff':'var(--n10)' }}>
                      <td style={{ fontWeight:600 }}>{m.label}</td>
                      <td className="mono" style={{textAlign:'right'}}>{m.count}</td>
                      <td className="mono" style={{textAlign:'right',fontWeight:600}}>{brl(m.bruto)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--blue)'}}>{brl(m.recebido)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--n4)'}}>{brl(m.repasse)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--g3)',fontWeight:700}}>{brl(m.margem)}</td>
                      <td className="mono" style={{textAlign:'right'}}>{m.recebido>0?pct(m.margem/m.recebido):'—'}</td>
                    </tr>
                  ))}
                  {byComp.length>0 && <tr style={{background:'var(--g1)'}}>
                    <td style={{fontWeight:700,color:'#fff'}}>TOTAL</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{totaisRel.count}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.bruto)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.recebido)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.repasse)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'var(--g7)'}}>{brl(totaisRel.margem)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'var(--g7)'}}>{totaisRel.recebido>0?pct(totaisRel.margem/totaisRel.recebido):'—'}</td>
                  </tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>📋 Notas no período</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>NF</th><th>Tomador</th><th>Médicos</th><th>Competência</th><th style={{textAlign:'right'}}>Bruto</th><th style={{textAlign:'right'}}>Recebido</th><th style={{textAlign:'right'}}>Margem</th><th>Status</th></tr></thead>
                <tbody>
                  {notasRel.length===0 ? <tr><td colSpan={8}><div className="empty-state" style={{padding:'1.5rem'}}><p>Nenhuma nota no período</p></div></td></tr>
                  : notasRel.map(n => (
                    <tr key={n.id}>
                      <td className="mono" style={{fontWeight:600}}>{n.nf||'—'}</td>
                      <td>{n.tomador||'—'}</td>
                      <td style={{fontSize:11}}>{n.nomes_medicos||'—'}</td>
                      <td className="mono">{fmtMes(n.comp)}</td>
                      <td className="mono" style={{textAlign:'right',fontWeight:600}}>{brl(n.bruto)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--blue)'}}>{brl(n.recebido)}</td>
                      <td className="mono" style={{textAlign:'right',color: n.margem < 0 ? '#DC2626' : 'var(--g3)',fontWeight:600}}>
                        {brl(n.margem)}
                        {n.margem < 0 && <span style={{ fontSize:9, color:'#DC2626', fontWeight:700, marginLeft:4, whiteSpace:'nowrap' }}>⚠️</span>}
                      </td>
                      <td><span className={`badge ${n.status==='Paga ao médico'?'badge-ok':n.status==='Recebida'?'badge-rec':'badge-emit'}`}>{n.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ABA EXTRATO */}
      {aba === 'extrato' && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-body">
              <div style={{ background: 'var(--g10)', border: '1px solid var(--g8)', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--g2)', marginBottom: 6 }}>🏦 Importar extrato bancário e cruzar com as notas</div>
                <div style={{ fontSize: 12, color: 'var(--n4)', lineHeight: 1.6 }}>
                  Envie o extrato do banco em CSV. O sistema tenta casar cada débito (pagamento a médico) com o nome que aparece na descrição do banco, e sugere a nota fiscal correspondente pelo valor do repasse.
                  Quando <strong>todos os médicos de uma nota</strong> tiverem transação encontrada, a nota é marcada automaticamente com <strong>data de pagamento</strong> e status <strong>"Recebida"</strong>. Isso alimenta direto o <strong>Regime de Caixa</strong> e o <strong>Comprovante do médico</strong>.
                </div>
              </div>

              <div
                style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--n10)', marginBottom: 14 }}
                onClick={() => extratoFileRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) processarExtratoNota(e.dataTransfer.files[0]) }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n2)' }}>Arraste o CSV do extrato aqui, ou clique para selecionar</div>
                <div style={{ fontSize: 11, color: 'var(--n5)', marginTop: 4 }}>Débitos (pagamentos a médicos) são identificados automaticamente</div>
              </div>
              <input ref={extratoFileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) processarExtratoNota(e.target.files[0]) }} />

              {linhasExtrato.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      Transações importadas ({linhasExtrato.length})
                      {linhasExtrato.some(l => l.jaImportada) && (
                        <span style={{ fontSize: 11, color: 'var(--n4)', fontWeight: 400, marginLeft: 8 }}>
                          · {linhasExtrato.filter(l => l.jaImportada).length} já importada(s) antes
                        </span>
                      )}
                    </span>
                    <div style={{ flex: 1 }} />
                    <button className="btn btn-ghost btn-sm" onClick={() => setLinhasExtrato([])}>Descartar todas</button>
                    <button className="btn btn-primary btn-sm" onClick={salvarExtratoNota} disabled={loadingExtrato || !linhasExtrato.some(l => l.medico && !l.jaImportada)}>
                      {loadingExtrato ? 'Salvando…' : `✓ Salvar preenchidas (${linhasExtrato.filter(l => l.medico && !l.jaImportada).length})`}
                    </button>
                  </div>
                  <table>
                    <thead><tr>
                      <th>Data</th><th style={{ textAlign: 'right' }}>Valor</th><th>Descrição</th><th>NF sugerida</th><th>Médico</th><th style={{ textAlign: 'center' }}>Status</th><th></th>
                    </tr></thead>
                    <tbody>
                      {linhasExtrato.map((l, i) => (
                        <tr key={i} style={{ background: l.jaImportada ? '#F1F5F9' : l.medico ? '#F0FDF4' : l.ambiguo ? '#FFFBEB' : 'transparent', opacity: l.jaImportada ? 0.6 : 1 }}>
                          <td className="mono">{l.data ? fmtMes(l.data.slice(0,7)) + ' · ' + l.data.split('-')[2] : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{brl(l.valor)}</td>
                          <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.descricao}>{l.descricao || '—'}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{l.nf || '—'}</td>
                          <td>
                            <select value={l.medico} disabled={l.jaImportada}
                              onChange={e => atualizarLinhaExtrato(i, 'medico', e.target.value)}
                              style={{ height: 30, fontSize: 12, width: 220, border: '1px solid var(--border)', borderRadius: 6, padding: '0 8px', fontFamily: 'var(--sans)', background: l.jaImportada ? 'var(--n9)' : '#fff' }}>
                              <option value="">{l.ambiguo ? '⚠ vários possíveis, escolha' : 'Selecionar médico...'}</option>
                              {medicosOrdenados.map(m => <option key={m.id} value={m.nome}>{m.nome}{m.crm ? ` (${m.crm})` : ''}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {l.jaImportada
                              ? <span className="badge" style={{ background: 'var(--n8)', color: 'var(--n4)' }}>Já importada</span>
                              : l.medico
                                ? <span className="badge badge-ok">✓ Pronta</span>
                                : <span className="badge badge-emit">Pendente</span>}
                          </td>
                          <td>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n5)', fontSize: 14 }}
                              onClick={() => removerLinhaExtrato(i)}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Recebido confirmado por médico — pra inspecionar/corrigir o que já está salvo */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3>✅ Recebido confirmado por médico</h3>
              <div style={{ flex: 1 }} />
              <input type="text" placeholder="🔍 Buscar médico..." value={buscaExtratoConfirmado}
                onChange={e => setBuscaExtratoConfirmado(e.target.value)}
                style={{ height: 30, fontSize: 12, width: 200, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px' }} />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Médico</th><th style={{ textAlign: 'center' }}>Nº transações</th><th style={{ textAlign: 'right' }}>Total recebido</th><th></th>
                </tr></thead>
                <tbody>
                  {extratoPorMedico.length === 0 && (
                    <tr><td colSpan={4}><div className="empty-state" style={{ padding: '1.5rem' }}><p>Nenhum recebimento confirmado ainda.</p></div></td></tr>
                  )}
                  {extratoPorMedico.map((m, i) => (
                    <>
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{m.medico}</td>
                        <td className="mono" style={{ textAlign: 'center' }}>{m.qtd}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g3)' }}>{brl(m.total)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setExpandidoExtratoConfirmado(expandidoExtratoConfirmado === i ? null : i)}>
                            {expandidoExtratoConfirmado === i ? 'Ocultar' : 'Ver transações'}
                          </button>
                        </td>
                      </tr>
                      {expandidoExtratoConfirmado === i && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0, background: 'var(--n10)' }}>
                            <table style={{ width: '100%' }}>
                              <thead><tr>
                                <th style={{ fontSize: 10 }}>Data</th>
                                <th style={{ fontSize: 10, textAlign: 'right' }}>Valor</th>
                                <th style={{ fontSize: 10 }}>NF</th>
                                <th style={{ fontSize: 10 }}>Descrição</th>
                                <th style={{ fontSize: 10 }}></th>
                              </tr></thead>
                              <tbody>
                                {m.itens.map((it, j) => (
                                  editandoExtratoId === it.id ? (
                                    <tr key={j} style={{ background: '#FFFBEB' }}>
                                      <td>
                                        <input type="date" value={editFormExtrato.data}
                                          onChange={e => setEditFormExtrato(f => ({ ...f, data: e.target.value }))}
                                          style={{ height: 28, fontSize: 11, width: 130, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                                      </td>
                                      <td>
                                        <input type="number" step="0.01" value={editFormExtrato.valor}
                                          onChange={e => setEditFormExtrato(f => ({ ...f, valor: e.target.value }))}
                                          style={{ height: 28, fontSize: 11, width: 90, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                                      </td>
                                      <td>
                                        <input type="text" value={editFormExtrato.nf}
                                          onChange={e => setEditFormExtrato(f => ({ ...f, nf: e.target.value }))}
                                          style={{ height: 28, fontSize: 11, width: 80, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                                      </td>
                                      <td>
                                        <select value={editFormExtrato.medico_nome}
                                          onChange={e => setEditFormExtrato(f => ({ ...f, medico_nome: e.target.value }))}
                                          style={{ height: 28, fontSize: 11, width: 200, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px', fontFamily: 'var(--sans)' }}>
                                          {medicosOrdenados.map(md => <option key={md.id} value={md.nome}>{md.nome}</option>)}
                                        </select>
                                      </td>
                                      <td style={{ whiteSpace: 'nowrap' }}>
                                        <button onClick={() => salvarEdicaoExtrato(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g3)', fontSize: 12, fontWeight: 700, marginRight: 8 }}>✓ Salvar</button>
                                        <button onClick={cancelarEdicaoExtrato} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n5)', fontSize: 12 }}>Cancelar</button>
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr key={j}>
                                      <td className="mono" style={{ fontSize: 12 }}>{fmtDtExtrato(it.data)}</td>
                                      <td className="mono" style={{ fontSize: 12, textAlign: 'right' }}>{brl(it.valor)}</td>
                                      <td className="mono" style={{ fontSize: 11 }}>{it.nf || '—'}</td>
                                      <td style={{ fontSize: 11, whiteSpace: 'normal', maxWidth: 280 }}>{it.descricao || '—'}</td>
                                      <td style={{ whiteSpace: 'nowrap' }}>
                                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g3)', fontSize: 12, marginRight: 10 }}
                                          onClick={() => abrirEdicaoExtrato(it)}>✏️ Corrigir</button>
                                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red, #DC2626)', fontSize: 12 }}
                                          onClick={() => excluirExtratoConfirmado(it)}>✕ excluir</button>
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
        </>
      )}

      {/* ABA PLANILHA — visão simples, tipo planilha, organizada por médico */}
      {aba === 'planilha' && (
        <div className="card">
          <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
            <span className="table-title">Planilha por médico</span>
            <select className="filter-select" value={fPlanMedico} onChange={e => setFPlanMedico(e.target.value)}>
              <option value="">Todos médicos</option>
              {medicosCadastradosDasNotas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="month" className="filter-select" style={{ width: 140 }} value={fPlanCompDe} onChange={e => setFPlanCompDe(e.target.value)} title="Competência de" />
            <input type="month" className="filter-select" style={{ width: 140 }} value={fPlanCompAte} onChange={e => setFPlanCompAte(e.target.value)} title="Competência até" />
            <select className="filter-select" value={fPlanCaixa} onChange={e => setFPlanCaixa(e.target.value)}>
              <option value="">Caixa: todos</option>
              <option value="pago">✓ Já pago (caixa)</option>
              <option value="pendente">Pendente</option>
            </select>
            {(fPlanMedico || fPlanCompDe || fPlanCompAte || fPlanCaixa) && (
              <button className="btn btn-ghost btn-xs" onClick={() => { setFPlanMedico(''); setFPlanCompDe(''); setFPlanCompAte(''); setFPlanCaixa('') }}>Limpar filtros</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--n4)' }}>Bruto total: <strong style={{ color: 'var(--n1)' }}>{brl(totaisPlanilha.bruto)}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--n4)' }}>Repasse devido: <strong style={{ color: 'var(--blue)' }}>{brl(totaisPlanilha.repasse)}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--n4)' }}>Pago (caixa): <strong style={{ color: 'var(--g3)' }}>{brl(totaisPlanilha.pago)}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--n4)' }}>Pendente: <strong style={{ color: '#DC2626' }}>{brl(totaisPlanilha.repasse - totaisPlanilha.pago)}</strong></div>
          </div>

          {/* Planilha corrida, rolável, agrupada por médico */}
          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {planilhaPorMedico.length === 0 && (
              <div className="empty-state"><div className="empty-icon">📋</div><h4>Nada aqui</h4><p>Ajuste os filtros ou cadastre notas</p></div>
            )}
            {planilhaPorMedico.map((g, gi) => (
              <div key={gi}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1, background: 'var(--g1)', color: '#fff',
                  padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, fontWeight: 700,
                }}>
                  <span style={{ flex: 1 }}>👨‍⚕️ {g.medico}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, opacity: .85 }}>{g.qtd} nota(s)</span>
                  <span className="mono" style={{ fontSize: 11, opacity: .85 }}>Bruto {brl(g.bruto)}</span>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>Repasse {brl(g.repasse)}</span>
                  <span className="mono" style={{ fontSize: 11, color: g.pago >= g.repasse - 0.01 ? '#86EFAC' : '#FDE68A' }}>
                    Pago {brl(g.pago)}
                  </span>
                  <button onClick={() => copiarLinkFaturamentoMedico(g.medico)}
                    style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 10.5, cursor: 'pointer', fontWeight: 600 }}
                    title="Copiar mensagem com o link de faturamento desse médico">
                    📋 Copiar mensagem
                  </button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--n10)' }}>
                      {['Competência','NF','Tomador','Bruto','Ret.%','Repasse','Médico','Status','Data pgto',''].map((h,hi) => (
                        <th key={hi} style={{ padding: '5px 8px', fontSize: 9, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.3px', textAlign: hi>=3 && hi<=5 ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.linhas.map((l, li) => {
                      const idKey = `${l.notaId}-${l.medicoIndex}`
                      const editando = editandoPlanId === idKey
                      if (editando) {
                        return (
                          <tr key={li} style={{ background: '#FFFBEB', borderBottom: '1px solid var(--n9)' }}>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="month" value={editFormPlan.comp} onChange={e => setEditFormPlan(f => ({ ...f, comp: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 110, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="text" value={editFormPlan.nf} onChange={e => setEditFormPlan(f => ({ ...f, nf: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 80, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="text" value={editFormPlan.tomador} onChange={e => setEditFormPlan(f => ({ ...f, tomador: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 160, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="number" step="0.01" value={editFormPlan.bruto} onChange={e => setEditFormPlan(f => ({ ...f, bruto: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 90, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="number" step="0.01" value={editFormPlan.retencao} onChange={e => setEditFormPlan(f => ({ ...f, retencao: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 55, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '0 4px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="text" list="med-datalist" value={editFormPlan.medico} onChange={e => setEditFormPlan(f => ({ ...f, medico: e.target.value }))}
                                placeholder="Médico" style={{ height: 28, fontSize: 11, width: 170, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <select value={editFormPlan.status} onChange={e => setEditFormPlan(f => ({ ...f, status: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 120, border: '1px solid var(--border)', borderRadius: 6, padding: '0 4px', fontFamily: 'var(--sans)' }}>
                                <option value="Emitida">Emitida</option>
                                <option value="Recebida">Recebida</option>
                                <option value="Paga ao médico">Paga ao médico</option>
                              </select>
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <input type="date" value={editFormPlan.dataPagamento} onChange={e => setEditFormPlan(f => ({ ...f, dataPagamento: e.target.value }))}
                                style={{ height: 28, fontSize: 11, width: 130, border: '1px solid var(--border)', borderRadius: 6, padding: '0 6px' }} />
                            </td>
                            <td style={{ padding: '5px 12px', whiteSpace: 'nowrap' }}>
                              <button onClick={() => salvarEdicaoPlanilha(l)} disabled={salvandoPlan} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g3)', fontSize: 12, fontWeight: 700, marginRight: 8 }}>
                                {salvandoPlan ? '…' : '✓ Salvar'}
                              </button>
                              <button onClick={cancelarEdicaoPlanilha} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n5)', fontSize: 12 }}>Cancelar</button>
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={li} style={{ background: l.pago ? '#F0FDF4' : 'transparent', borderBottom: '1px solid var(--n9)' }}>
                          <td style={{ padding: '7px 16px', fontSize: 11.5, width: 90 }} className="mono">{fmtMes(l.comp)}</td>
                          <td style={{ padding: '7px 8px', fontSize: 11.5, width: 90 }} className="mono">{l.nf || '—'}</td>
                          <td style={{ padding: '7px 8px', fontSize: 11.5 }}>{l.tomador || '—'}</td>
                          <td style={{ padding: '7px 8px', fontSize: 11.5, textAlign: 'right', width: 100 }} className="mono">{brl(l.bruto)}</td>
                          <td style={{ padding: '7px 8px', fontSize: 11.5, textAlign: 'center', width: 60, color: 'var(--n4)' }} className="mono">{l.retencao}%</td>
                          <td style={{ padding: '7px 8px', fontSize: 11.5, textAlign: 'right', width: 100, fontWeight: 700, color: 'var(--blue)' }} className="mono">{brl(l.repasse)}</td>
                          <td style={{ padding: '7px 8px', fontSize: 11, textAlign: 'center', width: 130 }}>
                            <span className={`badge ${l.pago ? 'badge-ok' : l.status === 'Recebida' ? 'badge-rec' : 'badge-emit'}`}>{l.status}</span>
                          </td>
                          <td style={{ padding: '7px 16px', fontSize: 11, width: 90 }} className="mono">{l.dataPagamento ? l.dataPagamento.split('-').reverse().join('/') : '—'}</td>
                          <td style={{ padding: '7px 12px', width: 80 }}>
                            <button onClick={() => abrirEdicaoPlanilha(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g3)', fontSize: 11.5 }}>✏️ Editar</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ABA PRAZOS */}
      {aba === 'prazos' && (
        <div className="card">
          <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
            <span className="table-title">Prazos de pagamento</span>
            <select className="filter-select" value={fPrazoSituacao} onChange={e => setFPrazoSituacao(e.target.value)}>
              <option value="">Todas situações</option>
              <option value="vencida">🔴 Vencida</option>
              <option value="vence_breve">🟠 Vence em até 5 dias</option>
              <option value="em_dia">🟢 Em dia</option>
              <option value="sem_prazo">⚪ Sem prazo definido</option>
              <option value="paga">✅ Já paga</option>
            </select>
            <select className="filter-select" value={fPrazoTomador} onChange={e => setFPrazoTomador(e.target.value)}>
              <option value="">Todos tomadores</option>
              {tomadoresLista.map(t => <option key={t} value={t}>{rotuloTomador(t)}</option>)}
            </select>
            {(fPrazoSituacao || fPrazoTomador) && (
              <button className="btn btn-ghost btn-xs" onClick={() => { setFPrazoSituacao(''); setFPrazoTomador('') }}>Limpar filtros</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span className="badge badge-emit" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>🔴 {resumoPrazos.vencidas} vencida(s)</span>
            <span className="badge badge-emit">🟠 {resumoPrazos.venceBreve} vence(m) em breve</span>
            <span className="badge badge-ok">🟢 {resumoPrazos.emDia} em dia</span>
            <span className="badge" style={{ background: 'var(--n9)', color: 'var(--n4)', border: '1px solid var(--border)' }}>⚪ {resumoPrazos.semPrazo} sem prazo definido</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>NF</th><th>Tomador</th><th>Médicos</th><th>Bruto</th>
                <th>Vencimento</th><th>Situação</th><th>Status</th><th>Ações</th>
              </tr></thead>
              <tbody>
                {linhasPrazos.length === 0 && (
                  <tr><td colSpan={8}><div className="empty-state" style={{ padding: '1.5rem' }}><p>Nenhuma nota encontrada para os filtros selecionados.</p></div></td></tr>
                )}
                {linhasPrazos.map((l, i) => {
                  const n = l.nota
                  const corSit = l.situacao === 'vencida' ? '#DC2626' : l.situacao === 'vence_breve' ? '#D97706' : l.situacao === 'paga' ? 'var(--g3)' : l.situacao === 'em_dia' ? 'var(--g3)' : 'var(--n5)'
                  const txtSit = l.situacao === 'vencida' ? `🔴 Vencida há ${Math.abs(l.dias)} dia(s)` : l.situacao === 'vence_breve' ? `🟠 Vence em ${l.dias} dia(s)` : l.situacao === 'em_dia' ? `🟢 Em dia (${l.dias} dias)` : l.situacao === 'paga' ? '✅ Já paga' : '⚪ Sem prazo definido'
                  return (
                    <tr key={i}>
                      <td className="mono" style={{ fontWeight: 600 }}>{n.nf || '—'}</td>
                      <td style={{ maxWidth: 200 }}>{n.tomador || '—'}</td>
                      <td style={{ fontSize: 11 }}>{n.nomes_medicos || '—'}</td>
                      <td className="mono" style={{ fontWeight: 600 }}>{brl(n.bruto)}</td>
                      <td className="mono">{n.data_vencimento ? n.data_vencimento.split('-').reverse().join('/') : '—'}</td>
                      <td style={{ color: corSit, fontWeight: 600, fontSize: 12 }}>{txtSit}</td>
                      <td><span className={`badge ${n.status === 'Paga ao médico' ? 'badge-ok' : n.status === 'Recebida' ? 'badge-rec' : 'badge-emit'}`}>{n.status}</span></td>
                      <td><button className="btn btn-ghost btn-xs" onClick={() => abrirEditar(n)}>✏️ Editar</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA CONCILIAÇÃO */}
      {aba === 'conciliacao' && (
        <div className="card">
          <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
            <span className="table-title">Conciliação — extrato x sistema</span>
            <select className="filter-select" value={fConcSituacao} onChange={e => setFConcSituacao(e.target.value)}>
              <option value="">Todas situações</option>
              <option value="menor">📉 Paga a menor</option>
              <option value="maior">📈 Paga a maior</option>
              <option value="sem_pagamento">⚪ Sem pagamento registrado</option>
              <option value="bate">✅ Bate certinho</option>
            </select>
            <select className="filter-select" value={fConcTomador} onChange={e => setFConcTomador(e.target.value)}>
              <option value="">Todos tomadores</option>
              {tomadoresLista.map(t => <option key={t} value={t}>{rotuloTomador(t)}</option>)}
            </select>
            <select className="filter-select" value={fConcMedico} onChange={e => setFConcMedico(e.target.value)}>
              <option value="">Todos médicos</option>
              {medicosCadastradosDasNotas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="month" className="filter-select" style={{ width: 140 }} value={fConcCompDe} onChange={e => setFConcCompDe(e.target.value)} title="Competência de" />
            <input type="month" className="filter-select" style={{ width: 140 }} value={fConcCompAte} onChange={e => setFConcCompAte(e.target.value)} title="Competência até" />
            {(fConcSituacao || fConcTomador || fConcMedico || fConcCompDe || fConcCompAte) && (
              <button className="btn btn-ghost btn-xs" onClick={() => { setFConcSituacao(''); setFConcTomador(''); setFConcMedico(''); setFConcCompDe(''); setFConcCompAte('') }}>Limpar filtros</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span className="badge badge-ok">✅ {resumoConciliacao.bate} bate(m) certinho</span>
            <span className="badge" style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>📉 {resumoConciliacao.menor} paga(s) a menor</span>
            <span className="badge" style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>📈 {resumoConciliacao.maior} paga(s) a maior</span>
            <span className="badge" style={{ background: 'var(--n9)', color: 'var(--n4)', border: '1px solid var(--border)' }}>⚪ {resumoConciliacao.semPagamento} sem pagamento registrado</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>NF</th><th>Tomador</th><th>Médicos</th><th>Competência</th>
                <th style={{textAlign:'right'}}>Repasse esperado</th><th style={{textAlign:'right'}}>Pago real (extrato)</th>
                <th style={{textAlign:'right'}}>Diferença</th><th>Situação</th>
              </tr></thead>
              <tbody>
                {linhasConciliacao.length === 0 && (
                  <tr><td colSpan={8}><div className="empty-state" style={{ padding: '1.5rem' }}><p>Nenhuma nota encontrada para os filtros selecionados.</p></div></td></tr>
                )}
                {linhasConciliacao.map((l, i) => {
                  const dif = l.pago - l.esperado
                  const cfgSit = {
                    bate: { cor: 'var(--g3)', txt: '✅ Bate certinho' },
                    menor: { cor: '#D97706', txt: '📉 Paga a menor' },
                    maior: { cor: '#1D4ED8', txt: '📈 Paga a maior' },
                    sem_pagamento: { cor: 'var(--n5)', txt: '⚪ Sem pagamento' },
                  }[l.situacao]
                  return (
                    <tr key={i}>
                      <td className="mono" style={{ fontWeight: 600 }}>{l.nota.nf || '—'}</td>
                      <td style={{ maxWidth: 200 }}>{l.nota.tomador || '—'}</td>
                      <td style={{ fontSize: 11 }}>{l.nota.nomes_medicos || '—'}</td>
                      <td className="mono">{fmtMes(l.nota.comp)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{brl(l.esperado)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--g2)' }}>{l.pago ? brl(l.pago) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: Math.abs(dif) < 0.01 || !l.pago ? 'var(--n4)' : dif < 0 ? '#D97706' : '#1D4ED8' }}>
                        {l.pago ? `${dif >= 0 ? '+' : '-'}${brl(Math.abs(dif))}` : '—'}
                      </td>
                      <td style={{ color: cfgSit.cor, fontWeight: 600, fontSize: 12 }}>{cfgSit.txt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL NOTA */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editando ? 'Editar nota fiscal' : 'Nova nota fiscal'} size="wide"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={loading}>
            {loading ? <><span className="spinner spinner-sm"/> Salvando…</> : 'Salvar nota'}
          </button>
        </>}>

        {/* Sub-abas do modal */}
        <div style={{ display:'flex', gap:2, marginBottom:16, borderBottom:'1px solid var(--border)' }}>
          {[['dados','📋 Dados da nota'],['importar','📊 Importar médicos (Excel)'], ...(editando ? [['particularidades',`📌 Particularidades${particularidadesDaNota.length ? ` (${particularidadesDaNota.length})` : ''}`]] : [])].map(([id,label]) => (
            <button key={id} onClick={() => setAbaModal(id)} style={{ padding:'7px 16px', border:'none', borderBottom:abaModal===id?'2px solid var(--g5)':'2px solid transparent', background:'none', cursor:'pointer', fontSize:12, fontWeight:abaModal===id?600:400, color:abaModal===id?'var(--g3)':'var(--n5)', fontFamily:'var(--sans)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ABA DADOS */}
        {abaModal === 'dados' && (
          <>
            <div className="form-grid">
              <div className="field">
                <label>Nº da NF *</label>
                <input type="text" value={form.nf} onChange={e => setForm(f=>({...f,nf:e.target.value}))} placeholder="00001"/>
              </div>
              <div className="field">
                <label>Tomador *</label>
                <input type="text" list="tomador-datalist" value={form.tomador} placeholder="Digite ou selecione o tomador…"
                  onChange={e => {
                    const nome = e.target.value
                    const encontrado = buscarTomadorPorNomeExato(nome)
                    setForm(f => ({ ...f, tomador: nome, tomador_cnpj: encontrado?.cnpj || '' }))
                    setCadastroTomadorAberto(false)
                  }}/>
                <datalist id="tomador-datalist">
                  {tomadoresOrdenados.map(t => <option key={t.id} value={t.nome}>{t.cnpj ? `${t.nome} — CNPJ ${t.cnpj}` : t.nome}</option>)}
                </datalist>
                {form.tomador_cnpj && (
                  <div style={{ fontSize: 11, color: 'var(--n5)', marginTop: 3 }}>CNPJ: {form.tomador_cnpj}</div>
                )}
                {form.tomador && !form.tomador_cnpj && !cadastroTomadorAberto && (
                  <div style={{ fontSize: 11, color: '#D97706', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>⚠️ Esse tomador não está no cadastro — confira se não é uma filial de nome parecido.</span>
                    <button type="button" onClick={() => setCadastroTomadorAberto(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--g3)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 11 }}>
                      + Cadastrar esse tomador agora
                    </button>
                  </div>
                )}
                {cadastroTomadorAberto && (
                  <div style={{ marginTop: 6, padding: 10, background: 'var(--n9)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>CNPJ (opcional)</label>
                      <input type="text" value={novoTomadorCnpj} onChange={e => setNovoTomadorCnpj(e.target.value)}
                        placeholder="00.000.000/0001-00" style={{ height: 30, fontSize: 12, width: '100%' }}/>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={cadastrarTomadorRapido} disabled={salvandoTomador}>
                      {salvandoTomador ? 'Salvando…' : `✓ Cadastrar "${form.tomador}"`}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCadastroTomadorAberto(false); setNovoTomadorCnpj('') }}>Cancelar</button>
                  </div>
                )}
              </div>
              {[['comp','Competência (emissão)','month',''],['mes_recebimento','Mês de recebimento','month',''],['data_vencimento','Prazo de pagamento (vencimento)','date',''],['data_pagamento','Data de pagamento (exata)','date',''],['emissao','Data emissão','date',''],['obs','Observações','text','']].map(([k,l,t,p]) => (
                <div key={k} className="field">
                  <label>{l}</label>
                  <input type={t} value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} placeholder={p}/>
                </div>
              ))}
              <div className="field">
                <label>Valor recebido real (R$) — se diferente do esperado</label>
                <input type="number" min="0" step="0.01" value={form.valor_recebido_real} onChange={e => setForm(f=>({...f,valor_recebido_real:e.target.value}))} placeholder="deixe vazio se recebeu o valor esperado"/>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                  <option value="Emitida">Emitida</option>
                  <option value="Recebida">Recebida</option>
                  <option value="Paga ao médico">Paga ao médico</option>
                </select>
              </div>
              <div className="field form-full">
                <label>Valor bruto total (R$) *</label>
                <input type="number" className="inp-money" value={form.bruto} onChange={e => setForm(f=>({...f,bruto:e.target.value}))} placeholder="0,00" min="0" step="0.01"/>
              </div>
            </div>

            <div style={{ marginTop:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <label style={{ fontSize:10, fontWeight:700, color:'var(--n4)', textTransform:'uppercase', letterSpacing:.4 }}>Médicos vinculados</label>
                <button type="button" className="btn btn-outline btn-xs" onClick={() => setAbaModal('importar')}>📊 Importar via Excel</button>
              </div>
              <div className="med-picker">
                <div className="med-picker-header">
                  <span>Médico</span>
                  <div style={{ display:'flex', gap:36, fontSize:10, color:'var(--n5)' }}>
                    <span style={{ width:100, textAlign:'center' }}>Valor / Modo</span>
                    <span style={{ width:100, textAlign:'center' }}>% Retenção</span>
                    <span style={{ width:30 }}></span>
                  </div>
                </div>
                <div className="med-picker-list">
                  {medSel.length===0 && <div style={{ padding:12, textAlign:'center', color:'var(--n6)', fontSize:11 }}>Nenhum médico adicionado</div>}
                  {medSel.map((ms,i) => {
                    const brutoEq = v.meds?.[i]?.brutoEquivalente
                    return (
                    <div key={i} className="med-picker-row">
                      <div>
                        <div style={{ fontWeight:500, fontSize:12 }}>{ms.nome}</div>
                        <div style={{ fontSize:10, color:'var(--n5)' }}>{ms.crm}</div>
                      </div>
                      <div>
                        <input type="number" value={ms.valor} placeholder="0,00" min="0" step="0.01"
                          style={{ height:28, fontSize:12, fontFamily:'var(--mono)', textAlign:'right', padding:'0 6px', border:'1px solid var(--border)', borderRadius:6, width:'100%' }}
                          onChange={e => setMedSel(prev => prev.map((m,j) => j===i?{...m,valor:e.target.value}:m))}/>
                        <select value={ms.modoValor || 'bruto'}
                          style={{ height:20, fontSize:9, width:'100%', marginTop:2, border:'1px solid var(--border)', borderRadius:4, fontFamily:'var(--sans)', color:'var(--n5)' }}
                          onChange={e => setMedSel(prev => prev.map((m,j) => j===i?{...m,modoValor:e.target.value}:m))}>
                          <option value="bruto">Bruto (aplica %)</option>
                          <option value="liquido">Já é líquido</option>
                        </select>
                        {ms.modoValor === 'liquido' && brutoEq > 0 && (
                          <div style={{ fontSize:9, color:'var(--n5)', marginTop:2, textAlign:'right' }} title="Valor bruto que teria gerado esse líquido, com a % de retenção informada ao lado">
                            ≈ Bruto equiv.: R$ {brutoEq.toLocaleString('pt-BR',{minimumFractionDigits:2})}
                          </div>
                        )}
                      </div>
                      <input type="number" value={ms.ret} min="0" max="100" step="0.01"
                        title={ms.modoValor === 'liquido' ? '% usada só pra calcular o bruto equivalente de referência' : '% de retenção aplicada sobre o bruto'}
                        style={{ height:28, fontSize:12, fontFamily:'var(--mono)', textAlign:'right', padding:'0 6px', border:'1px solid var(--border)', borderRadius:6 }}
                        onChange={e => setMedSel(prev => prev.map((m,j) => j===i?{...m,ret:e.target.value}:m))}/>
                      <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--n5)', fontSize:14 }}
                        onClick={() => setMedSel(prev => prev.filter((_,j) => j!==i))}>✕</button>
                    </div>
                    )
                  })}
                </div>
                <div className="med-picker-add">
                  <input type="text" list="med-datalist" placeholder="🔍 Digite o nome do médico para adicionar..." id="med-search-input" autoComplete="off"
                    style={{ height:34, fontSize:12, width:'100%', border:'1px solid var(--border)', borderRadius:6, padding:'0 10px', background:'var(--n10)', fontFamily:'var(--sans)' }}
                    onChange={e => {
                      const nome = e.target.value.trim()
                      const med = medicosOrdenados.find(m => m.nome===nome)
                      if (med) { adicionarMed(nome); setTimeout(() => { const el=document.getElementById('med-search-input'); if(el) el.value='' }, 50) }
                    }}/>
                  <datalist id="med-datalist">
                    {medicosOrdenados.map(m => <option key={m.id} value={m.nome}>{m.crm?`${m.nome} (${m.crm})`:m.nome}</option>)}
                  </datalist>
                </div>
                {medSel.length>0 && form.bruto && Math.abs(v.totalBrutoEquivalente - parseFloat(form.bruto))>0.01 && (() => {
                  const soma = v.totalBrutoEquivalente
                  const dif = soma - parseFloat(form.bruto)
                  return (
                    <div className="pct-warn">
                      ℹ️ A soma dos valores dos médicos, em bruto equivalente, ({brl(soma)}) é {dif > 0 ? 'maior' : 'menor'} que o bruto da nota ({brl(parseFloat(form.bruto))}) em {brl(Math.abs(dif))} — isso é permitido, só um aviso.
                    </div>
                  )
                })()}
              </div>
            </div>

            <div className="computed-row">
              <div className="computed-box blue"><div className="computed-label">Recebido (−6,15%)</div><div className="computed-value">{brl(v.recebido)}</div></div>
              <div className="computed-box"><div className="computed-label">Total repasse</div><div className="computed-value">{brl(v.totalRepasse)}</div></div>
              <div className="computed-box" style={v.margem < 0 ? { background: '#FEF2F2', border: '1px solid #FCA5A5' } : undefined}>
                <div className="computed-label" style={v.margem < 0 ? { color: '#B91C1C' } : undefined}>{v.margem < 0 ? '⚠️ Nota em prejuízo' : 'Margem empresa'}</div>
                <div className="computed-value" style={v.margem < 0 ? { color: '#DC2626' } : undefined}>{brl(v.margem)}</div>
              </div>
              <div className="computed-box"><div className="computed-label">% Margem</div><div className="computed-value" style={v.margem < 0 ? { color: '#DC2626' } : undefined}>{pct(v.pct_margem)}</div></div>
            </div>

            {v.margem < 0 && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>
                🚨 Essa nota está em <strong>prejuízo de {brl(Math.abs(v.margem))}</strong> — o repasse aos médicos é maior que o valor líquido recebido pela empresa. Confira se os valores estão corretos antes de salvar.
              </div>
            )}

            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--n4)', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>
                Retenções federais (detalhamento dos 6,15%)
              </div>
              <div className="computed-row">
                <div className="computed-box"><div className="computed-label">IR (1,5%)</div><div className="computed-value">{brl(v.ir)}</div></div>
                <div className="computed-box"><div className="computed-label">CSLL (1%)</div><div className="computed-value">{brl(v.csll)}</div></div>
                <div className="computed-box"><div className="computed-label">PIS (0,65%)</div><div className="computed-value">{brl(v.pis)}</div></div>
                <div className="computed-box"><div className="computed-label">COFINS (3%)</div><div className="computed-value">{brl(v.cofins)}</div></div>
              </div>
            </div>
          </>
        )}

        {/* ABA IMPORTAR EXCEL */}
        {/* ABA PARTICULARIDADES */}
        {abaModal === 'particularidades' && editando && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 170 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Categoria</label>
                <select value={novaParticCategoria} onChange={e => setNovaParticCategoria(e.target.value)} style={{ height: 34, width: '100%' }}>
                  {Object.entries(CATEGORIAS_PARTICULARIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Descrição</label>
                <input type="text" value={novaParticDescricao} onChange={e => setNovaParticDescricao(e.target.value)}
                  placeholder="Ex: tomador pediu prazo extra por acordo verbal com o financeiro" style={{ height: 34, width: '100%' }}/>
              </div>
              <button className="btn btn-primary btn-sm" onClick={adicionarParticularidade} disabled={salvandoPartic}>
                {salvandoPartic ? 'Salvando…' : '+ Registrar'}
              </button>
            </div>

            {particularidadesDaNota.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}><div className="empty-icon">📌</div><p>Nenhuma particularidade registrada pra essa nota ainda.</p></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {particularidadesDaNota.map(p => (
                  <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--n9)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g3)', marginBottom: 3 }}>{CATEGORIAS_PARTICULARIDADE[p.categoria] || p.categoria}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--n2)' }}>{p.descricao}</div>
                      <div style={{ fontSize: 10, color: 'var(--n5)', marginTop: 4 }}>{new Date(p.criado_em).toLocaleString('pt-BR')}</div>
                    </div>
                    <button className="btn btn-ghost btn-xs" onClick={() => excluirParticularidade(p.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {abaModal === 'importar' && (
          <div>
            <div style={{ background:'var(--g10)', border:'1px solid var(--g8)', borderRadius:'var(--radius-lg)', padding:'12px 16px', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--g2)', marginBottom:6 }}>📊 Importar médicos de planilha Excel</div>
              <div style={{ fontSize:12, color:'var(--n4)', lineHeight:1.6 }}>
                O arquivo deve ter colunas: <strong>Médico</strong> (nome), <strong>Valor</strong> (subtotal) e opcionalmente <strong>Retenção %</strong>.
                O sistema verifica se o total importado é igual ao valor bruto da nota (<strong>{brl(brutoNum)}</strong>).
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginBottom:14 }}>
              <button className="btn btn-primary" onClick={() => importRef.current?.click()}>📂 Selecionar arquivo Excel</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const ws = XLSX.utils.aoa_to_sheet([['Médico','Valor','Retenção %'],['Dr. Nome Completo','1250.00','13'],['Dra. Outra Médica','2000.00','13']])
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Médicos'); XLSX.writeFile(wb, 'modelo_medicos.xlsx'); toast('Modelo baixado!')
              }}>⬇ Baixar modelo</button>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={e => { if(e.target.files[0]) processarExcelMedicos(e.target.files[0]) }}/>
            </div>

            {/* Resultado da importação */}
            {importErro && (
              <div style={{ background: importErro.includes('DIFERENÇA') ? 'var(--yellow-l)' : 'var(--red-l)', border: `1px solid ${importErro.includes('DIFERENÇA')?'#FDE68A':'#FCA5A5'}`, borderRadius:'var(--radius-lg)', padding:'12px 16px', marginBottom:12, fontSize:12, fontWeight:600, color: importErro.includes('DIFERENÇA')?'#92400E':'var(--red-d)' }}>
                {importErro.includes('DIFERENÇA') ? '⚠️' : '❌'} {importErro}
              </div>
            )}

            {importPreview.length > 0 && (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--n2)' }}>{importPreview.length} médico(s) encontrado(s) no arquivo</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:12 }}>
                    <span>Total importado: <strong style={{ color: importOk?'var(--g3)':'var(--red)' }}>{brl(importTotal)}</strong></span>
                    <span>Valor bruto da nota: <strong>{brl(brutoNum)}</strong></span>
                    {importOk && <span style={{ background:'var(--g10)', color:'var(--g3)', border:'1px solid var(--g8)', borderRadius:99, padding:'2px 10px', fontSize:11, fontWeight:700 }}>✓ Valores batem!</span>}
                  </div>
                </div>
                <div className="table-wrap" style={{ marginBottom:14 }}>
                  <table>
                    <thead><tr>
                      <th>Nome no arquivo</th><th>Médico no sistema</th><th>CRM</th><th style={{textAlign:'right'}}>Valor</th><th style={{textAlign:'center'}}>Ret %</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {importPreview.map((m,i) => (
                        <tr key={i} style={{ background: !m.encontrado?'#FFFBEB':i%2===0?'#fff':'var(--n10)' }}>
                          <td style={{ fontSize:12 }}>{m.nome}</td>
                          <td style={{ fontSize:12, fontWeight:500, color:m.encontrado?'var(--g3)':'var(--orange-d)' }}>
                            {m.encontrado ? (m.similar ? `${m.nomeCadastrado} ↩` : m.nomeCadastrado) : '⚠️ Não cadastrado'}
                          </td>
                          <td style={{ fontSize:11, color:'var(--n5)' }}>{m.crm||'—'}</td>
                          <td className="mono" style={{ textAlign:'right', fontWeight:600 }}>{brl(m.valor)}</td>
                          <td className="mono" style={{ textAlign:'center' }}>{m.ret}%</td>
                          <td>{m.encontrado ? <span className="badge badge-ok">✓ OK</span> : <span className="badge badge-emit">Não cadastrado</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button className="btn btn-primary" onClick={confirmarImport}>
                    ✓ Confirmar e aplicar médicos
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setImportPreview([]); setImportErro('') }}>Limpar</button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL: avisar emissão — copiar mensagem ou enviar por WhatsApp, por médico */}
      <Modal open={!!modalAvisoNota} onClose={() => setModalAvisoNota(null)} title="Avisar NF emitida"
        footer={<button className="btn btn-ghost" onClick={() => setModalAvisoNota(null)}>Fechar</button>}>
        <div style={{ fontSize: 12, color: 'var(--n4)', marginBottom: 12 }}>
          Escolha o médico e a forma de enviar o aviso de emissão:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {modalAvisoNota?.medicos_nota?.map((mn, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{mn.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--n5)' }}>Bruto: {brl(mn.valor_bruto_medico || 0)}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => copiarAvisoEmissao(modalAvisoNota, mn)}>📋 Copiar</button>
              <button className="btn btn-primary btn-sm" onClick={() => enviarAvisoEmissao(modalAvisoNota, mn)}>💬 WhatsApp</button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

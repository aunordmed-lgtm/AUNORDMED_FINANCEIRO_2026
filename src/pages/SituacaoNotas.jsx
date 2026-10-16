import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { brl, fmtMes } from '../lib/helpers'
import { ETAPAS, ORDEM_ETAPAS, etapaEfetiva } from '../lib/etapas'
import { MOTIVOS_DIVERGENCIA, esperadoEfetivo, diferencaRecebimento, excecaoPendente } from '../lib/excecoes'
import { CATEGORIAS_PARTICULARIDADE } from '../lib/particularidades'
import { registrarAuditoria, emailLogado } from '../lib/auditoria'

const COR_ETAPA = {
  emitida: '#64748B', aguardando_aprovacao: '#D97706', em_cobranca: '#EA580C', em_divergencia: '#DC2626',
  recebida: '#1A56DB', repassada: '#1A7A3E', encerrada: '#145C30',
}
const ETAPAS_EM_ABERTO = ['emitida', 'aguardando_aprovacao', 'em_cobranca', 'em_divergencia']
const LIMITE_INICIAL = 20

const CHIPS = [
  { id: 'vencidas', label: '🔴 Vencidas' },
  { id: 'breve', label: '🟠 Vencem em 5 dias' },
  { id: 'prejuizo', label: '🚨 Em prejuízo' },
  { id: 'excecao', label: '🚩 Exceção sem motivo' },
  { id: 'menor', label: '📉 Paga a menor' },
]

const dia = v => new Date(v.split('T')[0] + 'T00:00:00')
const fmtDia = v => (v ? v.split('T')[0].split('-').reverse().join('/') : '—')
const fmtQuando = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function diasParaVencer(n) {
  if (!n.data_vencimento) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return Math.round((dia(n.data_vencimento) - hoje) / 86400000)
}

// Etiqueta de prazo do cartão: só faz sentido enquanto o tomador ainda não pagou.
function etiquetaPrazo(n) {
  if (n.status === 'Emitida') {
    const d = diasParaVencer(n)
    if (d == null) return { txt: 'sem prazo', fundo: '#F1F5F9', cor: '#64748B' }
    if (d < 0) return { txt: `vencida há ${-d}d`, fundo: '#FEF2F2', cor: '#DC2626' }
    if (d === 0) return { txt: 'vence hoje', fundo: '#FFFBEB', cor: '#D97706' }
    if (d <= 5) return { txt: `vence em ${d}d`, fundo: '#FFFBEB', cor: '#D97706' }
    return { txt: `vence em ${d}d`, fundo: '#E8F5ED', cor: '#1A7A3E' }
  }
  if (n.data_recebimento) return { txt: `recebida ${fmtDia(n.data_recebimento)}`, fundo: '#EFF6FF', cor: '#1D4ED8' }
  return null
}

const medicosDaNota = n =>
  n.medicos_nota?.length ? n.medicos_nota : (n.nomes_medicos ? n.nomes_medicos.split(',').map(x => ({ nome: x.trim() })) : [])

export function SituacaoNotas({ notas = [], extratoBancario = [], onRefresh }) {
  const { toast } = useToast()
  const [busca, setBusca] = useState('')
  const [fTomador, setFTomador] = useState('')
  const [fCompDe, setFCompDe] = useState('')
  const [fCompAte, setFCompAte] = useState('')
  const [chip, setChip] = useState('')
  const [abertaId, setAbertaId] = useState(null)
  const [alvo, setAlvo] = useState(null)
  const [limites, setLimites] = useState({})

  const pagoRealPorNf = useMemo(() => {
    const m = {}
    extratoBancario.forEach(e => { if (e.nf) m[e.nf] = (m[e.nf] || 0) + (e.valor || 0) })
    return m
  }, [extratoBancario])

  const pagaAMenor = n => {
    const pago = pagoRealPorNf[n.nf]
    return !!pago && pago < (n.total_repasse || 0) - 0.01
  }

  const passaChip = (n, c) => {
    const d = diasParaVencer(n)
    if (c === 'vencidas') return n.status === 'Emitida' && d != null && d < 0
    if (c === 'breve') return n.status === 'Emitida' && d != null && d >= 0 && d <= 5
    if (c === 'prejuizo') return (n.margem || 0) < 0
    if (c === 'excecao') return excecaoPendente(n)
    if (c === 'menor') return pagaAMenor(n)
    return true
  }

  const tomadoresLista = useMemo(
    () => [...new Set(notas.map(n => n.tomador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [notas]
  )

  const filtradas = useMemo(() => notas.filter(n =>
    (!busca || n.nf?.toLowerCase().includes(busca.toLowerCase()) || n.tomador?.toLowerCase().includes(busca.toLowerCase()) ||
      medicosDaNota(n).some(m => m.nome?.toLowerCase().includes(busca.toLowerCase()))) &&
    (!fTomador || n.tomador === fTomador) &&
    (!fCompDe || (n.comp && n.comp >= fCompDe)) &&
    (!fCompAte || (n.comp && n.comp <= fCompAte)) &&
    (!chip || passaChip(n, chip))
  // eslint-disable-next-line
  ), [notas, busca, fTomador, fCompDe, fCompAte, chip, pagoRealPorNf])

  const colunas = useMemo(() => {
    const m = {}
    ORDEM_ETAPAS.forEach(k => { m[k] = { itens: [], total: 0 } })
    filtradas.forEach(n => { const k = etapaEfetiva(n); m[k].itens.push(n); m[k].total += n.bruto || 0 })
    ORDEM_ETAPAS.forEach(k => {
      m[k].itens.sort(ETAPAS_EM_ABERTO.includes(k)
        ? (a, b) => (a.data_vencimento || '9999').localeCompare(b.data_vencimento || '9999')
        : (a, b) => (b.comp || '').localeCompare(a.comp || ''))
    })
    return m
  }, [filtradas])

  const emAberto = useMemo(() => ETAPAS_EM_ABERTO.reduce(
    (a, k) => ({ qtd: a.qtd + colunas[k].itens.length, total: a.total + colunas[k].total }), { qtd: 0, total: 0 }), [colunas])

  // Mover uma nota de etapa (arrastando o cartão ou pelo painel lateral).
  // Regras: "Repassada" gera lançamento no extrato, então só é feita na lista de Notas.
  async function mover(n, destino) {
    const atual = etapaEfetiva(n)
    if (destino === atual) return
    const repassada = n.status === 'Paga ao médico'
    if (destino === 'repassada') { toast('Para marcar como repassada use a lista de Notas Fiscais: ela gera o lançamento no extrato.', 'error'); return }
    if (repassada && destino !== 'encerrada') { toast('Nota já repassada ao médico: ela não volta de etapa por aqui.', 'error'); return }
    if (destino === 'encerrada' && !repassada) { toast('Só dá para encerrar a competência de uma nota já repassada.', 'error'); return }

    let novoStatus = null
    if (destino === 'recebida') novoStatus = 'Recebida'
    else if (['emitida', 'aguardando_aprovacao', 'em_cobranca'].includes(destino) && n.status !== 'Emitida') novoStatus = 'Emitida'

    const email = await emailLogado()
    const { error } = await supabase.from('notas_fiscais').update({
      etapa: destino, etapa_responsavel: email, etapa_atualizada_em: new Date().toISOString(),
      ...(novoStatus ? { status: novoStatus } : {}),
    }).eq('id', n.id)
    if (error) { toast('Erro ao mover: ' + error.message, 'error'); return }
    registrarAuditoria('etapa_alterada', n.id, { nf: n.nf, etapa_anterior: atual, etapa_nova: destino })
    if (novoStatus) registrarAuditoria('status_alterado', n.id, { nf: n.nf, status_anterior: n.status, status_novo: novoStatus })
    toast(`NF ${n.nf || ''} movida para ${ETAPAS[destino].replace(/^\S+\s/, '')}.`)
    onRefresh?.()
  }

  const aberta = abertaId ? notas.find(n => n.id === abertaId) : null
  const limpar = busca || fTomador || fCompDe || fCompAte || chip

  return (
    <div className="page-content">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <span className="table-title">🧭 Situação das NFS</span>
          <span style={{ fontSize: 11.5, color: 'var(--n4)' }}>
            {emAberto.qtd} em andamento · R$ {brl(emAberto.total)} em aberto
          </span>
          <input className="search-input" placeholder="🔍 NF, tomador ou médico…" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className="filter-select" value={fTomador} onChange={e => setFTomador(e.target.value)}>
            <option value="">Todos tomadores</option>
            {tomadoresLista.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="month" className="filter-select" style={{ width: 140 }} value={fCompDe} onChange={e => setFCompDe(e.target.value)} title="Competência de" />
          <input type="month" className="filter-select" style={{ width: 140 }} value={fCompAte} onChange={e => setFCompAte(e.target.value)} title="Competência até" />
          {limpar && <button className="btn btn-ghost btn-xs" onClick={() => { setBusca(''); setFTomador(''); setFCompDe(''); setFCompAte(''); setChip('') }}>Limpar</button>}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px', flexWrap: 'wrap' }}>
          {CHIPS.map(c => (
            <button key={c.id} onClick={() => setChip(chip === c.id ? '' : c.id)}
              style={{
                border: '1px solid ' + (chip === c.id ? 'var(--g3)' : 'var(--border)'), background: chip === c.id ? 'var(--g3)' : '#fff',
                color: chip === c.id ? '#fff' : 'var(--n3)', borderRadius: 99, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              }}>{c.label}</button>
          ))}
          <span style={{ fontSize: 11, color: 'var(--n5)', alignSelf: 'center', marginLeft: 4 }}>Arraste um cartão para mudar a etapa</span>
        </div>
      </div>

      {/* QUADRO */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {ORDEM_ETAPAS.map(k => {
          const col = colunas[k]
          const limite = limites[k] || LIMITE_INICIAL
          return (
            <div key={k}
              onDragOver={e => { e.preventDefault(); if (alvo !== k) setAlvo(k) }}
              onDragLeave={() => setAlvo(a => (a === k ? null : a))}
              onDrop={e => {
                e.preventDefault(); setAlvo(null)
                const n = notas.find(x => x.id === e.dataTransfer.getData('text/plain'))
                if (n) mover(n, k)
              }}
              style={{
                width: 272, minWidth: 272, flexShrink: 0, borderRadius: 12, border: '1px solid var(--border)', borderTop: `3px solid ${COR_ETAPA[k]}`,
                background: alvo === k ? '#E8F5ED' : 'var(--n9)', transition: 'background .12s', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 300px)',
              }}>
              <div style={{ padding: '10px 12px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n1)', flex: 1 }}>{ETAPAS[k]}</span>
                  <span style={{ background: COR_ETAPA[k], color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>{col.itens.length}</span>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--n5)', marginTop: 2 }}>R$ {brl(col.total)}</div>
              </div>
              <div style={{ overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {col.itens.length === 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--n6)', textAlign: 'center', padding: '18px 8px' }}>Nenhuma nota</div>
                )}
                {col.itens.slice(0, limite).map(n => {
                  const et = etiquetaPrazo(n)
                  const meds = medicosDaNota(n)
                  const alertas = []
                  if ((n.margem || 0) < 0) alertas.push(['🚨', 'Em prejuízo'])
                  if (excecaoPendente(n)) alertas.push(['🚩', 'Exceção de recebimento sem motivo'])
                  if (pagaAMenor(n)) alertas.push(['📉', 'Paga a menor que o repasse previsto'])
                  return (
                    <div key={n.id} draggable
                      onDragStart={e => { e.dataTransfer.setData('text/plain', n.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => setAbertaId(n.id)}
                      style={{
                        background: '#fff', border: '1px solid var(--border)', borderLeft: `3px solid ${et?.cor || COR_ETAPA[k]}`, borderRadius: 10,
                        padding: '9px 10px', cursor: 'grab', boxShadow: '0 1px 2px rgba(0,0,0,.05)',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="mono" style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>NF {n.nf || '—'}</span>
                        {alertas.map(([ic, tt], i) => <span key={i} title={tt} style={{ fontSize: 12 }}>{ic}</span>)}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--n3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.tomador || '—'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--n5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {meds[0]?.nome || 'sem médico'}{meds.length > 1 ? ` +${meds.length - 1}` : ''}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                        <span className="mono" style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>R$ {brl(n.bruto)}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--n5)' }}>{fmtMes(n.comp)}</span>
                      </div>
                      {et && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ background: et.fundo, color: et.cor, borderRadius: 6, fontSize: 10.5, fontWeight: 700, padding: '2px 7px' }}>{et.txt}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {col.itens.length > limite && (
                  <button className="btn btn-ghost btn-xs" onClick={() => setLimites(l => ({ ...l, [k]: limite + 25 }))}>
                    Mostrar mais ({col.itens.length - limite})
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {aberta && (
        <PainelNota key={aberta.id} nota={aberta} pagoReal={pagoRealPorNf[aberta.nf] || 0}
          onFechar={() => setAbertaId(null)} onMover={mover} />
      )}
    </div>
  )
}

// ── Painel lateral: situação completa da nota + linha do tempo ──
function PainelNota({ nota, pagoReal, onFechar, onMover }) {
  const { toast } = useToast()
  const [eventos, setEventos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [pCategoria, setPCategoria] = useState('acordo_verbal')
  const [pTexto, setPTexto] = useState('')
  const [salvandoP, setSalvandoP] = useState(false)

  const etapa = etapaEfetiva(nota)
  const idx = ORDEM_ETAPAS.indexOf(etapa)
  const meds = medicosDaNota(nota)
  const esperado = esperadoEfetivo(nota)
  const dif = diferencaRecebimento(nota)
  const et = etiquetaPrazo(nota)

  async function carregar() {
    setCarregando(true)
    const evs = []
    try {
      const aud = await supabase.from('auditoria').select('*').eq('tabela', 'notas_fiscais').eq('registro_id', String(nota.id)).order('criado_em', { ascending: false })
      ;(aud.data || []).forEach(a => evs.push({ quando: a.criado_em, tipo: 'auditoria', acao: a.acao, dados: a.dados || {}, usuario: a.usuario_email }))
    } catch (e) { /* sem acesso à auditoria: segue só com o resto */ }
    try {
      const part = await supabase.from('particularidades').select('*').eq('nota_id', nota.id).order('criado_em', { ascending: false })
      ;(part.data || []).forEach(p => evs.push({ quando: p.criado_em, tipo: 'particularidade', categoria: p.categoria, texto: p.descricao }))
    } catch (e) { /* tabela de particularidades ainda não criada */ }
    if (!evs.some(x => x.acao === 'nota_criada') && nota.criado_em) evs.push({ quando: nota.criado_em, tipo: 'auditoria', acao: 'nota_criada', dados: {} })
    evs.sort((a, b) => (b.quando || '').localeCompare(a.quando || ''))
    setEventos(evs)
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [nota.id]) // eslint-disable-line

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onFechar])

  async function addParticularidade() {
    if (!pTexto.trim()) { toast('Descreva a particularidade.', 'error'); return }
    setSalvandoP(true)
    const { error } = await supabase.from('particularidades').insert({
      nota_id: nota.id, nf: nota.nf, tomador: nota.tomador, categoria: pCategoria, descricao: pTexto.trim(),
    })
    setSalvandoP(false)
    if (error) { toast('Erro ao registrar: ' + error.message, 'error'); return }
    setPTexto('')
    toast('Particularidade registrada.')
    carregar()
  }

  function descrever(ev) {
    if (ev.tipo === 'particularidade') return { ic: '📌', titulo: CATEGORIAS_PARTICULARIDADE[ev.categoria] || ev.categoria, detalhe: ev.texto }
    const d = ev.dados || {}
    switch (ev.acao) {
      case 'nota_criada': return { ic: '📄', titulo: 'Nota lançada no sistema', detalhe: d.bruto != null ? `Bruto R$ ${brl(d.bruto)}` : '' }
      case 'nota_editada': {
        const partes = []
        if (d.bruto_antes != null && d.bruto_depois != null && Number(d.bruto_antes) !== Number(d.bruto_depois)) partes.push(`Bruto: R$ ${brl(d.bruto_antes)} → R$ ${brl(d.bruto_depois)}`)
        if (d.status_antes && d.status_depois && d.status_antes !== d.status_depois) partes.push(`Status: ${d.status_antes} → ${d.status_depois}`)
        return { ic: '✏️', titulo: 'Nota editada', detalhe: partes.join(' · ') }
      }
      case 'status_alterado': return { ic: '🔁', titulo: 'Status alterado', detalhe: `${d.status_anterior || '—'} → ${d.status_novo || '—'}` }
      case 'etapa_alterada': return { ic: '🧭', titulo: 'Etapa alterada', detalhe: `${(ETAPAS[d.etapa_anterior] || d.etapa_anterior || '—')} → ${(ETAPAS[d.etapa_nova] || d.etapa_nova || '—')}` }
      case 'divergencia_justificada': return { ic: '🚩', titulo: 'Divergência justificada', detalhe: `${MOTIVOS_DIVERGENCIA[d.motivo] || d.motivo || ''}${d.diferenca != null ? ` · diferença R$ ${brl(d.diferenca)}` : ''}` }
      case 'data_recebimento_informada': return { ic: '📅', titulo: 'Data de recebimento informada', detalhe: fmtDia(d.data_recebimento) }
      default: return { ic: '•', titulo: ev.acao, detalhe: '' }
    }
  }

  const Num = ({ rotulo, valor, cor, sub }) => (
    <div style={{ background: 'var(--n9)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{rotulo}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: cor || 'var(--n1)' }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--n5)' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onFechar} style={{ flex: 1, background: 'rgba(15,23,42,.35)' }} />
      <div style={{ width: 470, maxWidth: '100%', background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,.18)' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10, background: 'linear-gradient(135deg,#0D3D20,#1A7A3E)' }}>
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>NF {nota.nf || '—'}</div>
            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 12, marginTop: 2 }}>{nota.tomador || '—'}{nota.tomador_cnpj ? ` · ${nota.tomador_cnpj}` : ''}</div>
          </div>
          <button onClick={onFechar} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Onde a nota está */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Onde está agora</div>
          <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
            {ORDEM_ETAPAS.map((k, i) => (
              <div key={k} title={ETAPAS[k]} style={{ flex: 1, height: 6, borderRadius: 4, background: i <= idx ? COR_ETAPA[etapa] : '#E2E8F0' }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: COR_ETAPA[etapa] }}>{ETAPAS[etapa]}</span>
            <span style={{ fontSize: 11, color: 'var(--n5)' }}>etapa {idx + 1} de {ORDEM_ETAPAS.length}</span>
            {et && <span style={{ background: et.fundo, color: et.cor, borderRadius: 6, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>{et.txt}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--n5)', marginBottom: 8 }}>
            {nota.etapa_atualizada_em ? `Última mudança por ${nota.etapa_responsavel || '—'} em ${fmtQuando(nota.etapa_atualizada_em)}` : 'Etapa deduzida do status da nota'}
          </div>
          <select value={etapa} onChange={e => onMover(nota, e.target.value)}
            style={{ width: '100%', height: 34, marginBottom: 18 }}>
            {ORDEM_ETAPAS.map(k => <option key={k} value={k}>{ETAPAS[k]}</option>)}
          </select>

          {/* Números */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Valores</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <Num rotulo="Bruto" valor={`R$ ${brl(nota.bruto)}`} />
            <Num rotulo="A receber (esperado)" valor={`R$ ${brl(esperado)}`} cor="#1D4ED8" sub={nota.valor_esperado_recebimento != null ? 'pelas regras do tomador' : 'bruto − 6,15%'} />
            <Num rotulo="Recebido de fato" valor={nota.valor_recebido_real != null ? `R$ ${brl(nota.valor_recebido_real)}` : '—'} />
            <Num rotulo="Diferença" valor={dif == null ? '—' : `${dif >= 0 ? '+' : '-'}R$ ${brl(Math.abs(dif))}`} cor={dif == null ? undefined : (Math.abs(dif) < 0.015 ? 'var(--g3)' : dif < 0 ? '#DC2626' : '#1D4ED8')}
              sub={nota.motivo_divergencia ? MOTIVOS_DIVERGENCIA[nota.motivo_divergencia] : (excecaoPendente(nota) ? 'sem motivo registrado' : '')} />
            <Num rotulo="Repasse aos médicos" valor={`R$ ${brl(nota.total_repasse)}`} sub={pagoReal ? `pago no extrato: R$ ${brl(pagoReal)}` : 'nada no extrato ainda'} />
            <Num rotulo="Margem" valor={`R$ ${brl(nota.margem)}`} cor={(nota.margem || 0) < 0 ? '#DC2626' : 'var(--g3)'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, color: 'var(--n3)', margin: '12px 0 18px' }}>
            <div><span style={{ color: 'var(--n5)' }}>Competência:</span> <strong>{fmtMes(nota.comp)}</strong></div>
            <div><span style={{ color: 'var(--n5)' }}>Emissão:</span> <strong>{fmtDia(nota.emissao)}</strong></div>
            <div><span style={{ color: 'var(--n5)' }}>Vencimento:</span> <strong>{fmtDia(nota.data_vencimento)}</strong></div>
            <div><span style={{ color: 'var(--n5)' }}>Tomador pagou:</span> <strong>{fmtDia(nota.data_recebimento)}</strong></div>
            <div><span style={{ color: 'var(--n5)' }}>Repasse ao médico:</span> <strong>{fmtDia(nota.data_pagamento)}</strong></div>
            <div><span style={{ color: 'var(--n5)' }}>Status:</span> <strong>{nota.status}</strong></div>
          </div>

          {meds.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Médicos ({meds.length})</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 18, maxHeight: 150, overflowY: 'auto' }}>
                {meds.map((m, i) => (
                  <div key={i} style={{ display: 'flex', padding: '6px 10px', fontSize: 12, borderBottom: i < meds.length - 1 ? '1px solid var(--n9)' : 'none' }}>
                    <span style={{ flex: 1 }}>{m.nome}</span>
                    {m.repasse != null && <span className="mono" style={{ color: 'var(--n4)' }}>R$ {brl(m.repasse)}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Linha do tempo */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n5)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Linha do tempo</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={pCategoria} onChange={e => setPCategoria(e.target.value)} style={{ height: 32, fontSize: 12 }}>
              {Object.entries(CATEGORIAS_PARTICULARIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="text" value={pTexto} onChange={e => setPTexto(e.target.value)} placeholder="Registrar uma particularidade…" style={{ flex: 1, minWidth: 140, height: 32, fontSize: 12 }}
              onKeyDown={e => { if (e.key === 'Enter') addParticularidade() }} />
            <button className="btn btn-primary btn-xs" onClick={addParticularidade} disabled={salvandoP}>{salvandoP ? '…' : '+ Registrar'}</button>
          </div>

          {carregando ? (
            <div style={{ fontSize: 12, color: 'var(--n5)', padding: 12 }}>Carregando histórico…</div>
          ) : (
            <div style={{ position: 'relative', paddingLeft: 18 }}>
              <div style={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 2, background: '#E2E8F0' }} />
              {eventos.map((ev, i) => {
                const d = descrever(ev)
                return (
                  <div key={i} style={{ position: 'relative', marginBottom: 12 }}>
                    <div style={{ position: 'absolute', left: -18, top: 1, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '2px solid var(--g5)', fontSize: 0 }} />
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n1)' }}>{d.ic} {d.titulo}</div>
                    {d.detalhe && <div style={{ fontSize: 12, color: 'var(--n3)', marginTop: 1 }}>{d.detalhe}</div>}
                    <div style={{ fontSize: 10.5, color: 'var(--n5)', marginTop: 2 }}>{fmtQuando(ev.quando)}{ev.usuario ? ` · ${ev.usuario}` : ''}</div>
                  </div>
                )
              })}
              {eventos.length === 0 && <div style={{ fontSize: 12, color: 'var(--n5)' }}>Nenhum evento registrado ainda.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

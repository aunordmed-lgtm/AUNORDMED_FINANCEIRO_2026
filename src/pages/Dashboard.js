import { useMemo, useState } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { brl, fmtMes } from '../lib/helpers'

const MESES_ORDER = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// ── Paleta clara, estilo terminal financeiro ──
const BG = '#F5F7FA'
const PANEL = '#FFFFFF'
const BORDER = '#E2E8F0'
const GREEN = '#16A34A'
const GREEN_DIM = '#F0FDF4'
const RED = '#DC2626'
const RED_DIM = '#FEF2F2'
const BLUE = '#2563EB'
const AMBER = '#D97706'
const TXT = '#0F172A'
const TXT_DIM = '#94A3B8'
const MONO = "'JetBrains Mono', 'SF Mono', 'Consolas', monospace"

function ordenarChave(a, b) {
  const [moA, yA] = a.split('/')
  const [moB, yB] = b.split('/')
  if (yA !== yB) return parseInt(yA) - parseInt(yB)
  return MESES_ORDER.indexOf(moA) - MESES_ORDER.indexOf(moB)
}

function variacao(atual, anterior) {
  if (!anterior) return null
  return ((atual - anterior) / anterior) * 100
}

function Seta({ v }) {
  if (v == null) return <span style={{ color: TXT_DIM, fontSize: 10 }}>—</span>
  const up = v >= 0
  return (
    <span style={{ color: up ? GREEN : RED, fontSize: 11, fontWeight: 700, fontFamily: MONO, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
    </span>
  )
}

function Ticker({ label, valor, variacaoVal, sub, cor }) {
  const up = (variacaoVal ?? 0) >= 0
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', minWidth: 150, flex: 1, position: 'relative', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: cor || (up ? GREEN : RED) }} />
      <div style={{ fontSize: 9, fontWeight: 700, color: TXT_DIM, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4, paddingLeft: 6 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: TXT, fontFamily: MONO, paddingLeft: 6, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 6 }}>
        <Seta v={variacaoVal} />
        {sub && <span style={{ fontSize: 9, color: TXT_DIM }}>{sub}</span>}
      </div>
    </div>
  )
}

function Sparkline({ dados, cor }) {
  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={dados}>
        <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={1.6} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function TooltipClaro({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 12px', fontFamily: MONO, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
      <div style={{ color: TXT_DIM, marginBottom: 4, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: p.color, fontWeight: 700 }}>
          <span>{p.name}</span><span>{brl(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function Dashboard({ notas = [], medicos = [] }) {
  const [janela, setJanela] = useState(6)
  const [mostrarTabela, setMostrarTabela] = useState(false)

  // Série mensal: bruto/repasse devido (todas as notas) + recebido real (só as
  // notas já marcadas "Paga ao médico" — regime de caixa puro, sem depender de extrato importado)
  const serieMensal = useMemo(() => {
    const m = {}
    notas.forEach(n => {
      const k = fmtMes(n.comp) || 'S/D'
      if (!m[k]) m[k] = { name: k, bruto: 0, recebido: 0, repasse: 0, recebidoReal: 0 }
      m[k].bruto += n.bruto || 0
      m[k].recebido += n.recebido || 0
      m[k].repasse += n.total_repasse || 0
      if (n.status === 'Paga ao médico') m[k].recebidoReal += n.total_repasse || 0
    })
    const arr = Object.values(m).filter(x => x.name !== 'S/D').sort((a, b) => ordenarChave(a.name, b.name))
    return arr.slice(-janela)
  }, [notas, janela])

  const mesAtual = serieMensal[serieMensal.length - 1]
  const mesAnterior = serieMensal[serieMensal.length - 2]

  const totaisGerais = useMemo(() => serieMensal.reduce((a, m) => ({
    bruto: a.bruto + m.bruto, recebido: a.recebido + m.recebido, repasse: a.repasse + m.repasse, recebidoReal: a.recebidoReal + m.recebidoReal,
  }), { bruto: 0, recebido: 0, repasse: 0, recebidoReal: 0 }), [serieMensal])

  const rankingMedicos = useMemo(() => {
    const porMedico = {}
    notas.forEach(n => {
      if (n.status !== 'Paga ao médico' || !n.comp) return
      ;(n.medicos_nota || []).forEach(mn => {
        if (!porMedico[mn.nome]) porMedico[mn.nome] = { nome: mn.nome, total: 0, porMes: {} }
        const valor = mn.repasse || 0
        porMedico[mn.nome].total += valor
        porMedico[mn.nome].porMes[n.comp] = (porMedico[mn.nome].porMes[n.comp] || 0) + valor
      })
    })
    const arr = Object.values(porMedico).sort((a, b) => b.total - a.total).slice(0, 6)
    return arr.map(m => {
      const chaves = Object.keys(m.porMes).sort().slice(-6)
      const spark = chaves.map(k => ({ v: m.porMes[k] }))
      const ultimo = spark[spark.length - 1]?.v || 0
      const penultimo = spark[spark.length - 2]?.v || 0
      return { ...m, spark, variacaoVal: variacao(ultimo, penultimo) }
    })
  }, [notas])

  const varBruto = variacao(mesAtual?.bruto, mesAnterior?.bruto)
  const varRecebidoReal = variacao(mesAtual?.recebidoReal, mesAnterior?.recebidoReal)
  const varRepasse = variacao(mesAtual?.repasse, mesAnterior?.repasse)
  const eficiencia = totaisGerais.repasse > 0 ? (totaisGerais.recebidoReal / totaisGerais.repasse) * 100 : 0

  return (
    <div style={{ minHeight: '100%', background: BG, padding: 16, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />
        <span style={{ color: TXT, fontSize: 12, fontWeight: 700, letterSpacing: '.3px' }}>AUNORDMED · TERMINAL FINANCEIRO</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[3, 6, 12, 24].map(n => (
            <button key={n} onClick={() => setJanela(n)} style={{
              background: janela === n ? GREEN_DIM : 'transparent', color: janela === n ? GREEN : TXT_DIM,
              border: `1px solid ${janela === n ? GREEN : BORDER}`, borderRadius: 6, padding: '3px 9px', fontSize: 10,
              fontFamily: MONO, cursor: 'pointer', fontWeight: 700,
            }}>{n}M</button>
          ))}
        </div>
      </div>

      {/* Ticker strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Ticker label="Faturado (bruto)" valor={brl(totaisGerais.bruto)} variacaoVal={varBruto} sub="vs mês ant." cor={BLUE} />
        <Ticker label="Repasse devido" valor={brl(totaisGerais.repasse)} variacaoVal={varRepasse} sub="notas" cor={AMBER} />
        <Ticker label="Recebido real" valor={brl(totaisGerais.recebidoReal)} variacaoVal={varRecebidoReal} sub="extrato" cor={GREEN} />
        <Ticker label="Eficiência" valor={eficiencia.toFixed(1) + '%'} variacaoVal={eficiencia - 100} sub="receb/devido" cor={eficiencia >= 99 ? GREEN : eficiencia >= 90 ? AMBER : RED} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
        {/* Gráfico principal */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: TXT, fontSize: 11, fontWeight: 700, letterSpacing: '.3px' }}>FLUXO FINANCEIRO</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 10, fontSize: 9, color: TXT_DIM }}>
              <span><span style={{ color: BLUE }}>■</span> Bruto</span>
              <span><span style={{ color: AMBER }}>■</span> Devido</span>
              <span><span style={{ color: GREEN }}>■</span> Recebido</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={serieMensal} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gradBruto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradRecebido" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke={BORDER} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: TXT_DIM, fontFamily: MONO }} axisLine={{ stroke: BORDER }} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: TXT_DIM, fontFamily: MONO }} axisLine={false} tickLine={false} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} width={38} />
              <Tooltip content={<TooltipClaro />} />
              <Area type="monotone" dataKey="bruto" name="Bruto" stroke={BLUE} strokeWidth={1.8} fill="url(#gradBruto)" />
              <Area type="monotone" dataKey="repasse" name="Repasse devido" stroke={AMBER} strokeWidth={1.3} fill="none" strokeDasharray="4 3" />
              <Area type="monotone" dataKey="recebidoReal" name="Recebido real" stroke={GREEN} strokeWidth={2} fill="url(#gradRecebido)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Ranking médicos */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 14px' }}>
          <div style={{ color: TXT, fontSize: 11, fontWeight: 700, letterSpacing: '.3px', marginBottom: 8 }}>TOP MÉDICOS</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rankingMedicos.length === 0 && <div style={{ color: TXT_DIM, fontSize: 11, padding: '16px 0', textAlign: 'center' }}>Sem dados de extrato ainda.</div>}
            {rankingMedicos.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: i < rankingMedicos.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <span style={{ fontSize: 9, color: TXT_DIM, fontFamily: MONO, width: 12 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: TXT, fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.nome.replace(/^Dr\.?a?\.?\s*/i, '')}
                  </div>
                  <div style={{ color: TXT_DIM, fontSize: 9, fontFamily: MONO }}>{brl(m.total)}</div>
                </div>
                <Sparkline dados={m.spark} cor={(m.variacaoVal ?? 0) >= 0 ? GREEN : RED} />
                <div style={{ width: 46, textAlign: 'right' }}><Seta v={m.variacaoVal} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela mensal (recolhida por padrão) */}
      <div style={{ marginTop: 12, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 16px' }}>
        <button onClick={() => setMostrarTabela(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '4px 0' }}>
          <span style={{ color: TXT, fontSize: 11, fontWeight: 700, letterSpacing: '.3px' }}>RESUMO POR MÊS</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: TXT_DIM, fontSize: 11 }}>{mostrarTabela ? '▲ ocultar' : '▼ ver detalhes'}</span>
        </button>
        {mostrarTabela && (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Mês', 'Bruto', 'Devido', 'Recebido', 'Diferença'].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', fontSize: 9, color: TXT_DIM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', padding: '5px 8px', borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...serieMensal].reverse().map((m, i) => {
                  const diff = m.recebidoReal - m.repasse
                  return (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: TXT, fontFamily: MONO, fontWeight: 600 }}>{m.name}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: TXT, fontFamily: MONO, textAlign: 'right' }}>{brl(m.bruto)}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: AMBER, fontFamily: MONO, textAlign: 'right' }}>{brl(m.repasse)}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: GREEN, fontFamily: MONO, textAlign: 'right', fontWeight: 700 }}>{brl(m.recebidoReal)}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', fontWeight: 700, color: Math.abs(diff) < 0.01 ? TXT_DIM : diff < 0 ? RED : GREEN }}>
                        {diff >= 0 ? '+' : ''}{brl(diff)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

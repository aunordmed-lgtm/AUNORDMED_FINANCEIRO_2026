import { useMemo, useState } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { brl, fmtMes } from '../lib/helpers'

const MESES_ORDER = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// ── Paleta "terminal financeiro" ──
const BG = '#0A0E17'
const PANEL = '#0F1420'
const PANEL2 = '#141A2A'
const BORDER = '#1F2937'
const GREEN = '#22D3A5'
const GREEN_DIM = 'rgba(34,211,165,.12)'
const RED = '#F85149'
const RED_DIM = 'rgba(248,81,73,.12)'
const BLUE = '#3B82F6'
const AMBER = '#F5A623'
const TXT = '#E5E7EB'
const TXT_DIM = '#6B7280'
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
  if (v == null) return <span style={{ color: TXT_DIM, fontSize: 11 }}>—</span>
  const up = v >= 0
  return (
    <span style={{ color: up ? GREEN : RED, fontSize: 12, fontWeight: 700, fontFamily: MONO, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
    </span>
  )
}

function Ticker({ label, valor, variacaoVal, sub, cor }) {
  const up = (variacaoVal ?? 0) >= 0
  return (
    <div style={{
      background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 18px', minWidth: 200, flex: 1,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: cor || (up ? GREEN : RED) }} />
      <div style={{ fontSize: 9, fontWeight: 700, color: TXT_DIM, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6, paddingLeft: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: TXT, fontFamily: MONO, paddingLeft: 6, lineHeight: 1 }}>{valor}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 6 }}>
        <Seta v={variacaoVal} />
        {sub && <span style={{ fontSize: 10, color: TXT_DIM }}>{sub}</span>}
      </div>
    </div>
  )
}

function Sparkline({ dados, cor }) {
  return (
    <ResponsiveContainer width={90} height={32}>
      <LineChart data={dados}>
        <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={1.8} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function TooltipEscuro({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#000814', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: TXT_DIM, marginBottom: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color, fontWeight: 700 }}>
          <span>{p.name}</span><span>{brl(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function Dashboard({ notas = [], medicos = [], extratoBancario = [] }) {
  const [janela, setJanela] = useState(12) // meses de histórico exibidos

  // ── Série mensal: bruto/recebido esperado (notas) + recebido real (extrato) ──
  const serieMensal = useMemo(() => {
    const m = {}
    notas.forEach(n => {
      const k = fmtMes(n.comp) || 'S/D'
      if (!m[k]) m[k] = { name: k, bruto: 0, recebido: 0, repasse: 0, recebidoReal: 0 }
      m[k].bruto += n.bruto || 0
      m[k].recebido += n.recebido || 0
      m[k].repasse += n.total_repasse || 0
    })
    extratoBancario.forEach(e => {
      if (!e.data) return
      const [ano, mes] = String(e.data).split('-')
      const k = `${MESES_ORDER[+mes - 1]}/${ano}`
      if (!m[k]) m[k] = { name: k, bruto: 0, recebido: 0, repasse: 0, recebidoReal: 0 }
      m[k].recebidoReal += e.valor || 0
    })
    const arr = Object.values(m).filter(x => x.name !== 'S/D').sort((a, b) => ordenarChave(a.name, b.name))
    return arr.slice(-janela)
  }, [notas, extratoBancario, janela])

  const mesAtual = serieMensal[serieMensal.length - 1]
  const mesAnterior = serieMensal[serieMensal.length - 2]

  const totaisGerais = useMemo(() => serieMensal.reduce((a, m) => ({
    bruto: a.bruto + m.bruto, recebido: a.recebido + m.recebido, repasse: a.repasse + m.repasse, recebidoReal: a.recebidoReal + m.recebidoReal,
  }), { bruto: 0, recebido: 0, repasse: 0, recebidoReal: 0 }), [serieMensal])

  // ── Ranking de médicos com sparkline dos últimos 6 meses ──
  const rankingMedicos = useMemo(() => {
    const porMedico = {}
    extratoBancario.forEach(e => {
      if (!e.medico_nome || !e.data) return
      if (!porMedico[e.medico_nome]) porMedico[e.medico_nome] = { nome: e.medico_nome, total: 0, porMes: {} }
      porMedico[e.medico_nome].total += e.valor || 0
      const [ano, mes] = String(e.data).split('-')
      const k = `${ano}-${mes}`
      porMedico[e.medico_nome].porMes[k] = (porMedico[e.medico_nome].porMes[k] || 0) + (e.valor || 0)
    })
    const arr = Object.values(porMedico).sort((a, b) => b.total - a.total).slice(0, 8)
    return arr.map(m => {
      const chaves = Object.keys(m.porMes).sort().slice(-6)
      const spark = chaves.map(k => ({ v: m.porMes[k] }))
      const ultimo = spark[spark.length - 1]?.v || 0
      const penultimo = spark[spark.length - 2]?.v || 0
      return { ...m, spark, variacaoVal: variacao(ultimo, penultimo) }
    })
  }, [extratoBancario])

  const varBruto = variacao(mesAtual?.bruto, mesAnterior?.bruto)
  const varRecebidoReal = variacao(mesAtual?.recebidoReal, mesAnterior?.recebidoReal)
  const varRepasse = variacao(mesAtual?.repasse, mesAnterior?.repasse)
  const eficiencia = totaisGerais.repasse > 0 ? (totaisGerais.recebidoReal / totaisGerais.repasse) * 100 : 0

  return (
    <div style={{ minHeight: '100%', background: BG, padding: 20, fontFamily: "'Inter', sans-serif" }}>
      {/* Header estilo terminal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, boxShadow: `0 0 8px ${GREEN}`, display: 'inline-block' }} />
        <span style={{ color: TXT, fontSize: 13, fontWeight: 700, letterSpacing: '.5px' }}>AUNORDMED · TERMINAL FINANCEIRO</span>
        <span style={{ color: TXT_DIM, fontSize: 11, fontFamily: MONO }}>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[3, 6, 12, 24].map(n => (
            <button key={n} onClick={() => setJanela(n)} style={{
              background: janela === n ? GREEN_DIM : 'transparent', color: janela === n ? GREEN : TXT_DIM,
              border: `1px solid ${janela === n ? GREEN : BORDER}`, borderRadius: 6, padding: '4px 10px', fontSize: 11,
              fontFamily: MONO, cursor: 'pointer', fontWeight: 700,
            }}>{n}M</button>
          ))}
        </div>
      </div>

      {/* Ticker strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Ticker label="Faturado (bruto)" valor={brl(totaisGerais.bruto)} variacaoVal={varBruto} sub={`${mesAtual?.name || ''} vs mês ant.`} cor={BLUE} />
        <Ticker label="Repasse devido" valor={brl(totaisGerais.repasse)} variacaoVal={varRepasse} sub="segundo as notas" cor={AMBER} />
        <Ticker label="Recebido real" valor={brl(totaisGerais.recebidoReal)} variacaoVal={varRecebidoReal} sub="extrato confirmado" cor={GREEN} />
        <Ticker label="Eficiência de repasse" valor={eficiencia.toFixed(1) + '%'} variacaoVal={eficiencia - 100} sub="recebido / devido" cor={eficiencia >= 99 ? GREEN : eficiencia >= 90 ? AMBER : RED} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        {/* Gráfico principal */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ color: TXT, fontSize: 12, fontWeight: 700, letterSpacing: '.5px' }}>FLUXO FINANCEIRO — {janela} MESES</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 14, fontSize: 10, color: TXT_DIM }}>
              <span><span style={{ color: BLUE }}>■</span> Bruto</span>
              <span><span style={{ color: AMBER }}>■</span> Repasse devido</span>
              <span><span style={{ color: GREEN }}>■</span> Recebido real</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={serieMensal} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="gradBruto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradRecebido" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke={BORDER} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: TXT_DIM, fontFamily: MONO }} axisLine={{ stroke: BORDER }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: TXT_DIM, fontFamily: MONO }} axisLine={false} tickLine={false} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip content={<TooltipEscuro />} />
              <Area type="monotone" dataKey="bruto" name="Bruto" stroke={BLUE} strokeWidth={2} fill="url(#gradBruto)" />
              <Area type="monotone" dataKey="repasse" name="Repasse devido" stroke={AMBER} strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
              <Area type="monotone" dataKey="recebidoReal" name="Recebido real" stroke={GREEN} strokeWidth={2.5} fill="url(#gradRecebido)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Ranking médicos */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 16px' }}>
          <div style={{ color: TXT, fontSize: 12, fontWeight: 700, letterSpacing: '.5px', marginBottom: 14 }}>TOP MÉDICOS · RECEBIDO REAL</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rankingMedicos.length === 0 && <div style={{ color: TXT_DIM, fontSize: 11, padding: '20px 0', textAlign: 'center' }}>Sem dados de extrato ainda.</div>}
            {rankingMedicos.map((m, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px',
                borderBottom: i < rankingMedicos.length - 1 ? `1px solid ${BORDER}` : 'none',
              }}>
                <span style={{ fontSize: 10, color: TXT_DIM, fontFamily: MONO, width: 14 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: TXT, fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.nome.replace(/^Dr\.?a?\.?\s*/i, '')}
                  </div>
                  <div style={{ color: TXT_DIM, fontSize: 10, fontFamily: MONO }}>{brl(m.total)}</div>
                </div>
                <Sparkline dados={m.spark} cor={(m.variacaoVal ?? 0) >= 0 ? GREEN : RED} />
                <div style={{ width: 54, textAlign: 'right' }}><Seta v={m.variacaoVal} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Barra inferior: distribuição por status */}
      <div style={{ marginTop: 14, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ color: TXT, fontSize: 12, fontWeight: 700, letterSpacing: '.5px', marginBottom: 12 }}>RESUMO POR MÊS</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr>
                {['Mês', 'Bruto', 'Repasse devido', 'Recebido real', 'Diferença'].map((h, i) => (
                  <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', fontSize: 9, color: TXT_DIM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', padding: '6px 10px', borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...serieMensal].reverse().map((m, i) => {
                const diff = m.recebidoReal - m.repasse
                return (
                  <tr key={i}>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: TXT, fontFamily: MONO, fontWeight: 600 }}>{m.name}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: TXT, fontFamily: MONO, textAlign: 'right' }}>{brl(m.bruto)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: AMBER, fontFamily: MONO, textAlign: 'right' }}>{brl(m.repasse)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: GREEN, fontFamily: MONO, textAlign: 'right', fontWeight: 700 }}>{brl(m.recebidoReal)}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, fontFamily: MONO, textAlign: 'right', fontWeight: 700, color: Math.abs(diff) < 0.01 ? TXT_DIM : diff < 0 ? RED : GREEN }}>
                      {diff >= 0 ? '+' : ''}{brl(diff)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

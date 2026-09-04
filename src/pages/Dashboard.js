import { useMemo, useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { brl, pct, fmtMes } from '../lib/helpers'

const MESES_ORDER = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function ordenarMeses(dados) {
  return dados.sort((a, b) => {
    const [moA, yA] = a.name.split('/')
    const [moB, yB] = b.name.split('/')
    if (yA !== yB) return parseInt(yA) - parseInt(yB)
    return MESES_ORDER.indexOf(moA) - MESES_ORDER.indexOf(moB)
  })
}

// Contador animado: sobe de 0 até o valor final com easing, tipo cotação atualizando
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    let raf, start = null
    const from = first.current ? 0 : val
    first.current = false
    function step(ts) {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setVal(from + (target - from) * eased)
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function KpiCard({ bar, ic, icon, label, value, sub, isCurrency = true, delay = 0 }) {
  const animado = useCountUp(value)
  return (
    <div className="kpi kpi-anim" style={{ animationDelay: `${delay}ms` }}>
      <div className="kpi-bar" style={{ background: bar }} />
      <div className="kpi-icon" style={{ background: ic }}>{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{isCurrency ? brl(animado) : animado.toFixed(1) + '%'}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

export function Dashboard({ notas = [], medicos = [], adiantamentos = [], cashbacks = [], contas = [] }) {
  const totais = useMemo(() => notas.reduce((a, n) => ({
    bruto: a.bruto + (n.bruto || 0),
    recebido: a.recebido + (n.recebido || 0),
    repasse: a.repasse + (n.total_repasse || 0),
    margem: a.margem + (n.margem || 0),
  }), { bruto: 0, recebido: 0, repasse: 0, margem: 0 }), [notas])

  // Recebido real = regime de caixa: soma do repasse só das notas já "Paga ao médico"
  const recebidoReal = useMemo(() => notas
    .filter(n => n.status === 'Paga ao médico')
    .reduce((a, n) => a + (n.total_repasse || 0), 0), [notas])

  const pm = totais.recebido > 0 ? totais.margem / totais.recebido : 0

  const byComp = useMemo(() => {
    const m = {}
    notas.forEach(n => {
      const k = fmtMes(n.comp) || 'S/D'
      if (!m[k]) m[k] = { name: k, bruto: 0, recebido: 0, repasse: 0, margem: 0, recebidoReal: 0 }
      m[k].bruto += n.bruto || 0
      m[k].recebido += n.recebido || 0
      m[k].repasse += n.total_repasse || 0
      m[k].margem += n.margem || 0
      if (n.status === 'Paga ao médico') m[k].recebidoReal += n.total_repasse || 0
    })
    return ordenarMeses(Object.values(m))
  }, [notas])

  const emitidas = notas.filter(n => n.status === 'Emitida')
  const recebidas = notas.filter(n => n.status === 'Recebida')
  const pagas = notas.filter(n => n.status === 'Paga ao médico')
  const adtPend = adiantamentos.filter(a => a.status === 'pendente').reduce((s, a) => s + a.valor, 0)
  const cbPend = cashbacks.filter(c => c.status === 'pendente').reduce((s, c) => s + c.valor, 0)
  const contasVenc = contas?.filter(c => c.status === 'pendente' && c.vencimento <= new Date().toISOString().split('T')[0]).length || 0
  const notasVencidas = notas.filter(n => n.status !== 'Paga ao médico' && n.data_vencimento && n.data_vencimento.split('T')[0] < new Date().toISOString().split('T')[0])
  const notasVencidasValor = notasVencidas.reduce((a, n) => a + (n.bruto || 0), 0)

  return (
    <div className="page-content">
      <style>{`
        @keyframes kpiIn {
          from { opacity: 0; transform: translateY(10px) scale(.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: .35; }
        }
        @keyframes shimmerBar {
          0% { background-position: -120px 0; }
          100% { background-position: 120px 0; }
        }
        .kpi-anim {
          opacity: 0;
          animation: kpiIn .5s cubic-bezier(.16,1,.3,1) forwards;
          transition: transform .22s ease, box-shadow .22s ease;
          cursor: default;
        }
        .kpi-anim:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 24px rgba(15, 23, 42, .10);
        }
        .kpi-anim .kpi-bar {
          transition: height .25s ease;
        }
        .kpi-anim:hover .kpi-bar {
          height: 100%;
          opacity: .06;
        }
        .card-anim {
          opacity: 0;
          animation: cardIn .5s cubic-bezier(.16,1,.3,1) forwards;
          transition: box-shadow .25s ease, transform .25s ease;
        }
        .card-anim:hover {
          box-shadow: 0 12px 28px rgba(15, 23, 42, .08);
          transform: translateY(-2px);
        }
        .live-dot {
          display: inline-block; width: 7px; height: 7px; border-radius: 50%;
          background: #22C55E; margin-right: 6px; animation: pulseDot 1.8s ease-in-out infinite;
        }
        .ss-anim {
          opacity: 0; animation: cardIn .45s cubic-bezier(.16,1,.3,1) forwards;
          transition: transform .2s ease;
        }
        .ss-anim:hover { transform: translateY(-2px); }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, fontSize: 11, color: 'var(--n5)', fontFamily: 'var(--mono, monospace)' }}>
        <span className="live-dot" /> ATUALIZADO EM TEMPO REAL
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        {[
          { bar: '#22C55E', ic: '#F0FDF4', icon: '💰', label: 'Total emitido', value: totais.bruto, sub: `${notas.length} nota(s)` },
          { bar: '#2563EB', ic: '#EFF6FF', icon: '📥', label: 'Total recebido', value: totais.recebido, sub: 'Após impostos' },
          { bar: '#16A34A', ic: '#F0FDF4', icon: '✅', label: 'Recebido real', value: recebidoReal, sub: 'Regime de caixa' },
          { bar: '#EA580C', ic: '#FFF7ED', icon: '👨‍⚕️', label: 'Total repassado', value: totais.repasse, sub: 'Repasse médicos' },
          { bar: '#22C55E', ic: '#F0FFF4', icon: '📈', label: 'Margem empresa', value: totais.margem, sub: pct(pm) + ' sobre recebido' },
          { bar: '#EA580C', ic: '#FFF7ED', icon: '💵', label: 'Adiantamentos', value: adtPend, sub: 'Pendentes' },
          { bar: '#7C3AED', ic: '#F5F3FF', icon: '🎁', label: 'Cashback', value: cbPend, sub: 'Pendentes' },
        ].map((k, i) => (
          <KpiCard key={i} {...k} delay={i * 60} />
        ))}
      </div>

      {/* Status */}
      <div className="ss-grid">
        {[
          { cls: 'ss-emit', n: emitidas.length, label: 'Emitidas', sub: brl(emitidas.reduce((a,n)=>a+n.bruto,0)) },
          { cls: 'ss-rec', n: recebidas.length, label: 'Recebidas', sub: brl(recebidas.reduce((a,n)=>a+n.bruto,0)) },
          { cls: 'ss-pag', n: pagas.length, label: 'Pagas ao médico', sub: brl(pagas.reduce((a,n)=>a+n.bruto,0)) },
        ].map((s, i) => (
          <div key={i} className={`ss ${s.cls} ss-anim`} style={{ animationDelay: `${400 + i * 80}ms` }}>
            <div className="ss-num">{s.n}</div>
            <div><div className="ss-label">{s.label}</div><div className="ss-sub">{s.sub}</div></div>
          </div>
        ))}
      </div>

      {notasVencidas.length > 0 && (
        <Link to="/notas" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#B91C1C', cursor: 'pointer' }}>
            🚨 <strong>{notasVencidas.length}</strong> nota(s) com prazo de pagamento <strong>vencido</strong> e sem baixa ({brl(notasVencidasValor)} em aberto) — clique pra ver na aba "📅 Prazos"
          </div>
        </Link>
      )}

      {contasVenc > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#B91C1C' }}>
          ⚠️ <strong>{contasVenc}</strong> conta(s) vencida(s) ou a vencer hoje!
        </div>
      )}

      {/* Gráficos */}
      <div className="charts-grid">
        <div className="card card-anim" style={{ animationDelay: '520ms' }}>
          <div className="card-header"><h3>📊 Bruto × Recebido × Repasse por mês</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byComp} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} tickFormatter={v => 'R$' + (v/1000).toFixed(0) + 'k'} />
                <Tooltip formatter={v => brl(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="bruto" name="Bruto" fill="#14532D" radius={[3,3,0,0]} animationDuration={700} />
                <Bar dataKey="recebido" name="Recebido" fill="#16A34A" radius={[3,3,0,0]} animationDuration={700} animationBegin={100} />
                <Bar dataKey="repasse" name="Repasse" fill="#94A3B8" radius={[3,3,0,0]} animationDuration={700} animationBegin={200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-anim" style={{ animationDelay: '590ms' }}>
          <div className="card-header"><h3>📈 Evolução: margem × recebido real</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={byComp} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} tickFormatter={v => 'R$' + (v/1000).toFixed(1) + 'k'} />
                <Tooltip formatter={v => brl(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="margem" name="Margem" stroke="#16A34A" strokeWidth={2.5} dot={{ fill: '#16A34A', r: 4 }} animationDuration={900} />
                <Line type="monotone" dataKey="recebidoReal" name="Recebido real" stroke="#2563EB" strokeWidth={1.8} dot={{ fill: '#2563EB', r: 3 }} animationDuration={900} animationBegin={150} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabela resumo por mês */}
      {byComp.length > 0 && (
        <div className="card card-anim" style={{ animationDelay: '660ms' }}>
          <div className="card-header"><h3>📅 Resumo mensal em ordem cronológica</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Competência</th>
                <th style={{textAlign:'right'}}>Bruto</th>
                <th style={{textAlign:'right'}}>Recebido</th>
                <th style={{textAlign:'right'}}>Repasse</th>
                <th style={{textAlign:'right'}}>Recebido real</th>
                <th style={{textAlign:'right'}}>Margem</th>
                <th style={{textAlign:'right'}}>% Margem</th>
              </tr></thead>
              <tbody>
                {byComp.map((m, i) => (
                  <tr key={i} style={{ background: i%2===0?'#fff':'var(--n10)' }}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td className="mono" style={{ textAlign:'right', fontWeight:600 }}>{brl(m.bruto)}</td>
                    <td className="mono" style={{ textAlign:'right', color:'var(--blue)' }}>{brl(m.recebido)}</td>
                    <td className="mono" style={{ textAlign:'right', color:'var(--n4)' }}>{brl(m.repasse)}</td>
                    <td className="mono" style={{ textAlign:'right', color:'#16A34A', fontWeight:700 }}>{brl(m.recebidoReal)}</td>
                    <td className="mono" style={{ textAlign:'right', color:'var(--g3)', fontWeight:700 }}>{brl(m.margem)}</td>
                    <td className="mono" style={{ textAlign:'right' }}>{m.recebido>0?pct(m.margem/m.recebido):'—'}</td>
                  </tr>
                ))}
                <tr style={{ background:'var(--g1)' }}>
                  <td style={{ fontWeight:700, color:'#fff', fontSize:12 }}>TOTAL</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{brl(totais.bruto)}</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{brl(totais.recebido)}</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{brl(totais.repasse)}</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'#4ADE80' }}>{brl(recebidoReal)}</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'var(--g7)' }}>{brl(totais.margem)}</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'var(--g7)' }}>{pct(pm)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

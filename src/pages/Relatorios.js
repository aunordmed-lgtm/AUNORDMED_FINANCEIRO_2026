import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { brl, pct, fmtMes } from '../lib/helpers'

const G = { g1: '#0D3D20', g2: '#145C30', g3: '#1A7A3E', g6: '#A8DCBA', g7: '#E8F5ED' }
const GRAY = { 0: '#0F172A', 1: '#1E293B', 2: '#475569', 3: '#94A3B8', 5: '#E2E8F0', 6: '#F1F5F9' }
const RED = '#DC2626'
const BLUE = '#1A56DB'

const cardStyle = { background: '#fff', border: '1px solid #D4E6DA', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }
const inputStyle = { border: '1.5px solid ' + GRAY[5], borderRadius: 10, padding: '0 12px', fontSize: 13, color: GRAY[0], background: GRAY[6], height: 38 }
const labelStyle = { fontSize: 10, fontWeight: 700, color: GRAY[2], textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5, display: 'block' }
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: G.g6, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }
const tdStyle = { padding: '10px 14px', borderBottom: '1px solid ' + GRAY[6], fontSize: 12.5 }
const btnGhost = { height: 38, padding: '0 16px', borderRadius: 10, border: '1px solid #D4E6DA', background: GRAY[6], color: GRAY[1], fontSize: 13, fontWeight: 600, cursor: 'pointer' }

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ ...cardStyle, padding: '16px 18px' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'monospace', color: color || GRAY[0] }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY[3], marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function Relatorios({ notas, medicos, extratoBancario = [] }) {
  const [tipo, setTipo] = useState('mes')
  const [mes, setMes] = useState(new Date().toISOString().substring(0, 7))
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [busca, setBusca] = useState('')
  const [ordenarPor, setOrdenarPor] = useState('recebido') // 'recebido' | 'bruto' | 'nome'

  const notasFiltradas = useMemo(() => {
    if (tipo === 'todos') return notas
    if (tipo === 'mes') return mes ? notas.filter(n => n.comp === mes) : notas
    return notas.filter(n => {
      if (!n.comp) return false
      if (de && n.comp < de) return false
      if (ate && n.comp > ate) return false
      return true
    })
  }, [notas, tipo, mes, de, ate])

  const periodo = tipo === 'todos' ? '(todos os períodos)' : tipo === 'mes' ? `em ${fmtMes(mes)}` : de && ate ? `de ${fmtMes(de)} até ${fmtMes(ate)}` : ''

  const faturaram = useMemo(() => {
    const s = new Set()
    notasFiltradas.forEach(n => n.medicos_nota?.forEach(mn => s.add(mn.nome)))
    return s
  }, [notasFiltradas])

  const naoFaturaram = useMemo(() => medicos.filter(m => !faturaram.has(m.nome)), [medicos, faturaram])

  // "Recebido real" = regime de caixa: soma do repasse só das notas já marcadas "Paga ao médico".
  // Não depende de extrato importado — atualiza na hora que o status muda na tela de Notas.
  const totais = useMemo(() => {
    const base = notasFiltradas.reduce((a, n) => ({
      bruto: a.bruto + (n.bruto || 0),
      recebido: a.recebido + (n.recebido || 0),
      margem: a.margem + (n.margem || 0),
    }), { bruto: 0, recebido: 0, margem: 0 })
    const recebidoReal = notasFiltradas.filter(n => n.status === 'Paga ao médico').reduce((a, n) => a + (n.total_repasse || 0), 0)
    return { ...base, recebidoReal }
  }, [notasFiltradas])

  // Dados por médico: bruto/repasse esperado (das notas) + recebido real (regime de caixa)
  const porMedico = useMemo(() => {
    const m = {}
    notasFiltradas.forEach(n => {
      n.medicos_nota?.forEach(mn => {
        if (!m[mn.nome]) m[mn.nome] = { nome: mn.nome, count: 0, bruto: 0, repasse: 0, recebidoReal: 0 }
        m[mn.nome].count++
        m[mn.nome].bruto += mn.valor_bruto_medico || 0
        m[mn.nome].repasse += mn.repasse || 0
        if (n.status === 'Paga ao médico') {
          m[mn.nome].recebidoReal += mn.repasse || 0
        }
      })
    })
    let arr = Object.values(m).filter(x => !busca || x.nome.toLowerCase().includes(busca.toLowerCase()))
    arr.sort((a, b) => {
      if (ordenarPor === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR')
      if (ordenarPor === 'bruto') return b.bruto - a.bruto
      return b.recebidoReal - a.recebidoReal
    })
    return arr
  }, [notasFiltradas, busca, ordenarPor])

  const top10Chart = useMemo(() =>
    [...porMedico].sort((a, b) => b.recebidoReal - a.recebidoReal).slice(0, 10)
      .map(m => ({ nome: m.nome.split(' ').slice(0, 2).join(' '), recebido: m.recebidoReal }))
  , [porMedico])

  const exportar = () => {
    const rows = [['Médico', 'CRM', 'Qtd NFs', 'Total bruto', 'Total repasse (devido)', 'Recebido real', 'Diferença', 'Período']]
    porMedico.forEach(m => {
      const cad = medicos.find(x => x.nome === m.nome)
      rows.push([m.nome, cad?.crm || '', m.count, +m.bruto.toFixed(2), +m.repasse.toFixed(2), +m.recebidoReal.toFixed(2), +(m.recebidoReal - m.repasse).toFixed(2), periodo])
    })
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Por médico')
    XLSX.writeFile(wb, 'faturamento_por_medico.xlsx')
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>📈 Faturamento por médico</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
            Quanto cada médico faturou nas notas (bruto/repasse esperado) e quanto <strong>realmente recebeu</strong>, segundo o extrato bancário confirmado.
          </div>
        </div>

        <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Período</label>
            <select style={inputStyle} value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="mes">Mês específico</option>
              <option value="intervalo">Intervalo</option>
              <option value="todos">Todos os períodos</option>
            </select>
          </div>
          {tipo === 'mes' && (
            <div><label style={labelStyle}>Mês/Ano</label><input type="month" style={inputStyle} value={mes} onChange={e => setMes(e.target.value)} /></div>
          )}
          {tipo === 'intervalo' && (<>
            <div><label style={labelStyle}>De</label><input type="month" style={inputStyle} value={de} onChange={e => setDe(e.target.value)} /></div>
            <div><label style={labelStyle}>Até</label><input type="month" style={inputStyle} value={ate} onChange={e => setAte(e.target.value)} /></div>
          </>)}
          <div>
            <label style={labelStyle}>Buscar médico</label>
            <input type="text" style={{ ...inputStyle, width: 200 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome..." />
          </div>
          <div>
            <label style={labelStyle}>Ordenar por</label>
            <select style={inputStyle} value={ordenarPor} onChange={e => setOrdenarPor(e.target.value)}>
              <option value="recebido">Recebido real</option>
              <option value="bruto">Valor bruto</option>
              <option value="nome">Nome (A-Z)</option>
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={exportar} style={btnGhost}>⬇ Exportar Excel</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <Kpi label="Total emitido" value={brl(totais.bruto)} sub={`${notasFiltradas.length} nota(s)`} />
          <Kpi label="Total devido (repasse)" value={brl(porMedico.reduce((a, m) => a + m.repasse, 0))} sub="segundo as notas" color={BLUE} />
          <Kpi label="Recebido real" value={brl(totais.recebidoReal)} sub="notas marcadas 'Paga ao médico'" color={G.g2} />
          <Kpi label="Médicos ativos" value={faturaram.size} sub={`de ${medicos.length} cadastrados`} />
        </div>

        {top10Chart.length > 0 && (
          <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: GRAY[0], marginBottom: 12 }}>🏆 Top 10 — recebido real {periodo}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={top10Chart} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => 'R$' + (v / 1000).toFixed(0) + 'k'} />
                <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={140} />
                <Tooltip formatter={v => brl(v)} />
                <Bar dataKey="recebido" radius={[0, 4, 4, 0]}>
                  {top10Chart.map((_, i) => <Cell key={i} fill={i === 0 ? G.g2 : G.g3} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
            Detalhamento por médico ({porMedico.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr style={{ background: G.g1 }}>
                <th style={thStyle}>Médico</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>NFs</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Bruto</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Repasse (devido)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Recebido real</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Diferença</th>
              </tr></thead>
              <tbody>
                {porMedico.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhum médico faturou {periodo}.</td></tr>
                )}
                {porMedico.map((m, i) => {
                  const dif = m.recebidoReal - m.repasse
                  const cad = medicos.find(x => x.nome === m.nome)
                  return (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {m.nome}
                        {cad?.crm && <div style={{ fontSize: 10, color: GRAY[3], fontWeight: 400 }}>{cad.crm}</div>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{m.count}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{brl(m.bruto)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: BLUE }}>{brl(m.repasse)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: G.g2 }}>{brl(m.recebidoReal)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: Math.abs(dif) < 0.01 ? GRAY[3] : dif < 0 ? RED : G.g2 }}>
                        {dif >= 0 ? '+' : '-'}{brl(Math.abs(dif))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {naoFaturaram.length > 0 && (
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
              ❌ Não faturaram {periodo} ({naoFaturaram.length})
            </div>
            <div style={{ padding: '8px 20px' }}>
              {naoFaturaram.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + GRAY[6], fontSize: 12.5 }}>
                  <span style={{ fontWeight: 500, color: RED }}>{m.nome}</span>
                  <span style={{ fontSize: 11, color: GRAY[3] }}>{m.crm || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

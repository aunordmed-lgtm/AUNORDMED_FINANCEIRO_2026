import { useMemo, useState } from 'react'

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

const G = { g1: '#0D3D20', g2: '#145C30', g3: '#1A7A3E', g6: '#A8DCBA', g7: '#E8F5ED' }
const GRAY = { 0: '#0F172A', 1: '#1E293B', 2: '#475569', 3: '#94A3B8', 5: '#E2E8F0', 6: '#F1F5F9' }
const RED = '#DC2626'
const ORANGE = '#D97706'

const cardStyle = { background: '#fff', border: '1px solid #D4E6DA', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }
const inputStyle = { border: '1.5px solid ' + GRAY[5], borderRadius: 10, padding: '0 12px', fontSize: 13, color: GRAY[0], background: GRAY[6], height: 38, minWidth: 160 }
const labelStyle = { fontSize: 10, fontWeight: 700, color: GRAY[2], textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5, display: 'block' }
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: G.g6, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }
const tdStyle = { padding: '10px 14px', borderBottom: '1px solid ' + GRAY[6], fontSize: 12.5, whiteSpace: 'nowrap' }
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

function diasEntre(dataStr) {
  if (!dataStr) return null
  const d = new Date(dataStr.split('T')[0] + 'T00:00:00')
  if (isNaN(d)) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return Math.floor((hoje - d) / 86400000)
}

export function Gargalos({ notas = [], tomadores = [] }) {
  const [fTomador, setFTomador] = useState('')
  const [fCompDe, setFCompDe] = useState('')
  const [fCompAte, setFCompAte] = useState('')

  const tomadoresOpts = useMemo(() => {
    const s = new Set(tomadores.map(t => t.nome).filter(Boolean))
    notas.forEach(n => n.tomador && s.add(n.tomador))
    return [...s].sort()
  }, [tomadores, notas])

  const notasFiltradas = useMemo(() => notas.filter(n => {
    if (fTomador && n.tomador !== fTomador) return false
    if (fCompDe && n.comp && n.comp < fCompDe) return false
    if (fCompAte && n.comp && n.comp > fCompAte) return false
    return true
  }), [notas, fTomador, fCompDe, fCompAte])

  // ── GARGALO: notas emitidas, aguardando recebimento ──
  const travadas = useMemo(() => {
    return notasFiltradas
      .filter(n => n.status === 'Emitida')
      .map(n => ({ ...n, dias: diasEntre(n.emissao) ?? diasEntre(n.criado_em) ?? 0 }))
      .sort((a, b) => b.dias - a.dias)
  }, [notasFiltradas])

  const kpiTravadas = {
    qtd: travadas.length,
    valorBruto: travadas.reduce((a, n) => a + (n.bruto || 0), 0),
    mediaDias: travadas.length ? Math.round(travadas.reduce((a, n) => a + n.dias, 0) / travadas.length) : 0,
    maiorAtraso: travadas.length ? travadas[0].dias : 0,
  }

  // ── PREJUÍZO: notas recebidas com valor a menor ──
  const comDiferenca = useMemo(() => {
    return notasFiltradas
      .filter(n => n.valor_recebido_real != null && n.valor_recebido_real < (n.recebido || 0) - 0.01)
      .map(n => {
        const esperado = n.recebido || 0
        const real = n.valor_recebido_real || 0
        const diferenca = esperado - real
        return { ...n, esperado, real, diferenca, pctPerda: esperado > 0 ? (diferenca / esperado) * 100 : 0 }
      })
      .sort((a, b) => b.diferenca - a.diferenca)
  }, [notasFiltradas])

  const kpiPrejuizo = {
    qtd: comDiferenca.length,
    total: comDiferenca.reduce((a, n) => a + n.diferenca, 0),
  }

  function limparFiltros() { setFTomador(''); setFCompDe(''); setFCompAte('') }

  function corDias(dias) {
    if (dias > 45) return RED
    if (dias > 20) return ORANGE
    return G.g2
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>⚠️ Gargalos & Prejuízo</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
            Notas emitidas que ainda não foram recebidas do tomador (gargalo operacional), e notas recebidas com valor menor que o esperado (prejuízo financeiro real).
          </div>
        </div>

        <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Tomador</label>
            <select style={inputStyle} value={fTomador} onChange={e => setFTomador(e.target.value)}>
              <option value="">Todos</option>
              {tomadoresOpts.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Competência de</label>
            <input type="month" style={inputStyle} value={fCompDe} onChange={e => setFCompDe(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Competência até</label>
            <input type="month" style={inputStyle} value={fCompAte} onChange={e => setFCompAte(e.target.value)} />
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={limparFiltros} style={btnGhost}>Limpar filtros</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <Kpi label="Notas travadas (emitidas)" value={kpiTravadas.qtd} sub="aguardando recebimento" color={kpiTravadas.qtd > 0 ? ORANGE : G.g2} />
          <Kpi label="Valor bruto travado" value={`R$ ${brl(kpiTravadas.valorBruto)}`} sub="ainda não recebido" color={ORANGE} />
          <Kpi label="Maior atraso" value={`${kpiTravadas.maiorAtraso} dias`} sub={`média de ${kpiTravadas.mediaDias} dias`} color={corDias(kpiTravadas.maiorAtraso)} />
          <Kpi label="Prejuízo total" value={`R$ ${brl(kpiPrejuizo.total)}`} sub={`${kpiPrejuizo.qtd} nota(s) com valor a menor`} color={kpiPrejuizo.total > 0 ? RED : G.g2} />
        </div>

        {/* GARGALO */}
        <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
            🔒 Notas emitidas, aguardando recebimento ({travadas.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr style={{ background: G.g1 }}>
                <th style={thStyle}>NF</th>
                <th style={thStyle}>Tomador</th>
                <th style={thStyle}>Competência</th>
                <th style={thStyle}>Emissão</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Dias parado</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valor bruto</th>
              </tr></thead>
              <tbody>
                {travadas.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma nota travada — tudo recebido em dia. 🎉</td></tr>
                )}
                {travadas.map((n, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{n.nf || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 240 }}>{n.tomador || '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtMes(n.comp)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{n.emissao ? fmtDt(n.emissao) : '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={badge(corDias(n.dias) === RED ? '#FEF2F2' : corDias(n.dias) === ORANGE ? '#FFFBEB' : G.g7, corDias(n.dias), corDias(n.dias) === RED ? '#FECACA' : corDias(n.dias) === ORANGE ? '#FDE68A' : G.g6)}>
                        {n.dias} dia(s)
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>R$ {brl(n.bruto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PREJUÍZO */}
        <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #D4E6DA', fontSize: 13, fontWeight: 600, color: GRAY[0] }}>
            📉 Notas recebidas com valor a menor ({comDiferenca.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead><tr style={{ background: G.g1 }}>
                <th style={thStyle}>NF</th>
                <th style={thStyle}>Tomador</th>
                <th style={thStyle}>Competência</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Esperado</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Recebido real</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Prejuízo</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>% perda</th>
              </tr></thead>
              <tbody>
                {comDiferenca.length === 0 && (
                  <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: GRAY[3], padding: 30 }}>Nenhuma nota com valor recebido a menor registrada. 🎉</td></tr>
                )}
                {comDiferenca.map((n, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{n.nf || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: 240 }}>{n.tomador || '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{fmtMes(n.comp)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(n.esperado)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>R$ {brl(n.real)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: RED }}>-R$ {brl(n.diferenca)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={badge('#FEF2F2', RED, '#FECACA')}>{n.pctPerda.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {comDiferenca.length > 0 && (
                <tfoot>
                  <tr style={{ background: G.g7 }}>
                    <td colSpan={5} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: GRAY[0] }}>TOTAL DE PREJUÍZO</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: RED }}>-R$ {brl(kpiPrejuizo.total)}</td>
                    <td style={tdStyle}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

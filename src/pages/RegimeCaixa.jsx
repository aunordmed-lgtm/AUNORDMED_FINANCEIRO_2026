import { useMemo, useState } from 'react'

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMes = m => {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  const ms = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${ms[+mo - 1]}/${y}`
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

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ ...cardStyle, padding: '16px 18px' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'monospace', color: color || GRAY[0] }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY[3], marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function RegimeCaixa({ notas = [], medicos = [], tomadores = [] }) {
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

  // "Pago" = regime de caixa: soma do repasse das linhas cujo status da nota já é
  // "Paga ao médico". Não depende de extrato importado — atualiza na hora que o
  // status muda em Notas Fiscais.
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
                    <th style={{ ...thStyle, textAlign: 'center' }} title="Nº de transações do extrato bancário confirmadas para esse médico">Nº confirmadas</th>
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
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { supabase, empresaAtual } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { brl, fmtMes, fmtData } from '../lib/helpers'
import * as XLSX from 'xlsx'

export function Repasses({ notas, medicos, onRefresh }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [fltComp, setFltComp] = useState('')
  const [fltStatus, setFltStatus] = useState('pendente') // pendente | pago | todos
  const [expandido, setExpandido] = useState(null)
  const [pagandoId, setPagandoId] = useState(null)
  const [dataPag, setDataPag] = useState(new Date().toISOString().split('T')[0])

  const comps = useMemo(() => [...new Set(notas.map(n => n.comp).filter(Boolean))].sort().reverse(), [notas])

  // Montar relação de repasses por médico
  const repasses = useMemo(() => {
    const mapa = {}

    notas.forEach(nota => {
      if (!nota.medicos_nota?.length) return
      // Filtro por competência
      if (fltComp && nota.comp !== fltComp) return

      nota.medicos_nota.forEach(mn => {
        const key = mn.nome
        if (!mapa[key]) {
          const medCad = medicos.find(m => m.nome === mn.nome)
          mapa[key] = {
            nome: mn.nome,
            crm: mn.crm || medCad?.crm || '',
            chave_pix: medCad?.chave_pix || '',
            tipo_pix: medCad?.tipo_pix || '',
            retencao: mn.retencao_individual || medCad?.retencao || 13,
            notas: [],
            total_bruto: 0,
            total_repasse: 0,
            status: 'pendente'
          }
        }
        const repasse = mn.repasse || (mn.valor_bruto_medico * (1 - (mn.retencao_individual || 13) / 100))
        mapa[key].notas.push({
          id: nota.id,
          nf: nota.nf,
          tomador: nota.tomador,
          comp: nota.comp,
          status_nota: nota.status,
          valor_bruto_medico: mn.valor_bruto_medico || 0,
          retencao: mn.retencao_individual || 13,
          repasse,
          status_repasse: nota.status === 'Paga ao médico' ? 'pago' : 'pendente'
        })
        mapa[key].total_bruto += mn.valor_bruto_medico || 0
        mapa[key].total_repasse += repasse
      })
    })

    // Calcular status geral do médico
    Object.values(mapa).forEach(m => {
      const todosPagos = m.notas.every(n => n.status_repasse === 'pago')
      const algumPago = m.notas.some(n => n.status_repasse === 'pago')
      m.status = todosPagos ? 'pago' : algumPago ? 'parcial' : 'pendente'
    })

    return Object.values(mapa).sort((a, b) => b.total_repasse - a.total_repasse)
  }, [notas, medicos, fltComp])

  const repassesFiltrados = useMemo(() => {
    if (fltStatus === 'todos') return repasses
    if (fltStatus === 'pendente') return repasses.filter(r => r.status !== 'pago')
    return repasses.filter(r => r.status === fltStatus)
  }, [repasses, fltStatus])

  const totais = useMemo(() => repassesFiltrados.reduce((a, r) => ({
    bruto: a.bruto + r.total_bruto,
    repasse: a.repasse + r.total_repasse,
    count: a.count + 1
  }), { bruto: 0, repasse: 0, count: 0 }), [repassesFiltrados])

  const marcarPago = async (nomeMedico) => {
    if (!window.confirm(`Marcar todas as notas de ${nomeMedico} como "Paga ao médico"?`)) return
    setLoading(true)
    setPagandoId(nomeMedico)
    try {
      const medRepasse = repasses.find(r => r.nome === nomeMedico)
      const idsNotas = medRepasse.notas.filter(n => n.status_repasse === 'pendente').map(n => n.id)
      for (const id of idsNotas) {
        await supabase.from('notas_fiscais').update({ status: 'Paga ao médico' }).eq('id', id)
      }
      toast(`Repasse de ${nomeMedico} marcado como pago!`)
      onRefresh()
    } catch(e) { toast('Erro: ' + e.message, 'error') }
    setLoading(false)
    setPagandoId(null)
  }

  // Gerar CNAB 240 (.REM) padrão Banco Inter
  const gerarCNAB240 = (lista, nomeArq) => {
    if (!empresaAtual.banco) {
      toast(`Conta bancária da ${empresaAtual.nome} não cadastrada para CNAB (src/lib/empresas.js).`, 'error')
      return
    }
    const CNPJ = empresaAtual.cnpj
    const NOME = empresaAtual.banco.nomeCnab
    const AGE  = empresaAtual.banco.agencia
    const CONT = empresaAtual.banco.conta
    const DVC  = empresaAtual.banco.dv
    const now  = new Date()
    const Z = (v, n) => String(v).padStart(n, '0')
    const L = (v, n) => String(v||'').toUpperCase().padEnd(n,' ').substring(0,n)
    const fmt = d => [Z(d.getDate(),2),Z(d.getMonth()+1,2),d.getFullYear()].join('')
    const dataPagFmt = (() => { const p=dataPag.split('-'); return p[2]+p[1]+p[0] })()
    const dataGer = fmt(now)
    const horaGer = [Z(now.getHours(),2),Z(now.getMinutes(),2),Z(now.getSeconds(),2)].join('')
    const linhas = []
    const fix240 = s => s.length < 240 ? s + ' '.repeat(240-s.length) : s.substring(0,240)

    // ── HEADER ARQUIVO ──────────────────────────────────────────────────────
    let h = '077'+'0000'+'0'+'         '+'2'+CNPJ
    h += '                    '   // convênio 20
    h += AGE+' '+CONT+DVC+' '    // agência+DV+conta+DV+DVag
    h += L(NOME,30)+L('BANCO INTER S.A.',30)+'          '
    h += '1'+dataGer+horaGer+'000001'+'103'+'01600'
    h += '                    '+'                    '+'                             '
    linhas.push(fix240(h))

    // ── HEADER LOTE ─────────────────────────────────────────────────────────
    let hl = '077'+'0001'+'1'+'C'+'45'+'45'+'046'+' '+'2'+CNPJ
    hl += '                    '+AGE+' '+CONT+DVC+' '
    hl += L(NOME,30)
    hl += '                                        ' // finalidade 40
    hl += '                              '           // histórico 30
    hl += '                              '           // endereço 30
    linhas.push(fix240(hl))

    let seqReg = 1
    const tipoMap = {cpf:'1',cnpj:'2',email:'3',telefone:'4',aleatoria:'5',aleatorio:'5',chave:'5'}

    lista.forEach(med => {
      const vlr = Z(Math.round((med.valor||0)*100), 15)
      const nomFav = L(med.nome, 30)
      const tChave = tipoMap[(med.tipo_pix||'cpf').toLowerCase()] || '1'
      const chave = L(med.chave_pix||'', 77)
      const cpfN = (med.cpf||'00000000000').replace(/\D/g,'').padStart(14,'0')
      const tipInsc = cpfN.replace(/^0+/,'').length <= 11 ? '1' : '2'

      // Segmento A
      let sa = '077'+'0001'+'3'+Z(seqReg,5)+'A'+' '+'00'
      sa += '077'+'00001'+' '+'            '+' '+' '  // banco+ag+DV+conta+DV+DVag
      sa += nomFav
      sa += '                    '   // nº doc empresa 20
      sa += dataPagFmt+'BRL'+'000000000000000'+vlr
      sa += '                    '   // nº doc banco 20
      sa += '00000000'               // data real efetivação 8
      sa += '000000000000000'        // valor real 15
      sa += '                    '   // outras info 20
      sa += '09'+'0'+'  '+'   '+'0' // finalidade+TED+compl+banco+aviso
      linhas.push(fix240(sa))
      seqReg++

      // Segmento B
      let sb = '077'+'0001'+'3'+Z(seqReg,5)+'B'+'   '
      sb += tipInsc+cpfN
      sb += '                              '  // endereço 30
      sb += '        '                         // data venc 8
      sb += '000000000000000'                  // valor doc 15
      sb += '000000000000000'                  // abatimento 15
      sb += '000000000000000'                  // desconto 15
      sb += '000000000000000'                  // mora 15
      sb += '000000000000000'                  // multa 15
      sb += '               '                  // nº doc fav 15
      sb += tChave+chave
      linhas.push(fix240(sb))
      seqReg++
    })

    // ── TRAILER LOTE ────────────────────────────────────────────────────────
    const qtdLote = lista.length * 2 + 2
    const totVal = Z(Math.round(lista.reduce((a,m)=>a+(m.valor||0),0)*100), 18)
    let tl = '077'+'0001'+'5'+'         '
    tl += Z(qtdLote,6)+Z(lista.length,6)+'0'.repeat(17)+Z(lista.length,6)+totVal
    linhas.push(fix240(tl))

    // ── TRAILER ARQUIVO ──────────────────────────────────────────────────────
    const qtdTot = linhas.length + 1
    let ta = '077'+'9999'+'9'+'         '+'000001'+Z(qtdTot,6)+'000000'
    linhas.push(fix240(ta))

    // Download
    const blob = new Blob([linhas.join('\r\n')], { type: 'text/plain;charset=ascii' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = nomeArq; a.click()
    URL.revokeObjectURL(url)
  }

  const gerarCSVInter = (medico) => {
    if (!medico.chave_pix) { toast('Médico sem chave PIX cadastrada!', 'error'); return }
    gerarCNAB240([{ nome: medico.nome, chave_pix: medico.chave_pix, tipo_pix: medico.tipo_pix, valor: medico.total_repasse, cpf: medico.cpf || '' }], `CI240_001_000001.REM`)
    toast('Arquivo .REM gerado para importar no Inter!')
  }

  const gerarCSVLote = () => {
    const pendentes = repassesFiltrados.filter(r => r.status !== 'pago' && r.chave_pix)
    if (!pendentes.length) { toast('Nenhum médico com PIX cadastrado para repasse.', 'error'); return }
    const lista = pendentes.map(r => ({ nome: r.nome, chave_pix: r.chave_pix, tipo_pix: r.tipo_pix, valor: r.total_repasse, cpf: r.cpf || '' }))
    gerarCNAB240(lista, `CI240_001_000001.REM`)
    toast(`Arquivo .REM com ${pendentes.length} repasse(s) gerado!`)
  }

  const semPix = repassesFiltrados.filter(r => r.status !== 'pago' && !r.chave_pix).length

  return (
    <div className="page-content">
      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
        {[
          { bar:'var(--g5)', ic:'var(--g10)', icon:'👨‍⚕️', label:'Médicos no período', value: repassesFiltrados.length, sub:'' },
          { bar:'var(--g5)', ic:'var(--g10)', icon:'💰', label:'Total bruto médicos', value: brl(totais.bruto), sub:'' },
          { bar:'var(--orange)', ic:'var(--orange-l)', icon:'💸', label:'Total a repassar', value: brl(totais.repasse), sub:'Após retenção' },
          { bar: semPix > 0 ? 'var(--red)' : 'var(--g5)', ic: semPix > 0 ? 'var(--red-l)' : 'var(--g10)', icon: semPix > 0 ? '⚠️' : '✅', label:'Sem PIX cadastrado', value: semPix, sub: semPix > 0 ? 'Verificar cadastro' : 'Todos com PIX' },
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

      {/* Toolbar */}
      <div className="card">
        <div className="table-toolbar">
          <span className="table-title">Repasses por médico</span>
          <select className="filter-select" value={fltComp} onChange={e => setFltComp(e.target.value)}>
            <option value="">Todas competências</option>
            {comps.map(c => <option key={c} value={c}>{fmtMes(c)}</option>)}
          </select>
          <select className="filter-select" value={fltStatus} onChange={e => setFltStatus(e.target.value)}>
            <option value="pendente">Pendentes</option>
            <option value="pago">Pagos</option>
            <option value="parcial">Parciais</option>
            <option value="todos">Todos</option>
          </select>
          <div className="field" style={{ marginBottom:0 }}>
            <input type="date" value={dataPag} onChange={e => setDataPag(e.target.value)}
              style={{ height:32, fontSize:12, border:'1px solid var(--border)', borderRadius:6, padding:'0 8px' }}
              title="Data do pagamento" />
          </div>
          <button className="btn btn-outline btn-sm" onClick={gerarCSVLote} title="Gerar CSV para PIX em lote no Inter">
            📤 .REM Inter (lote)
          </button>
        </div>

        {semPix > 0 && (
          <div style={{ margin:'0 0 12px', padding:'10px 16px', background:'var(--yellow-l)', border:'1px solid #FDE68A', borderRadius:'var(--radius-lg)', fontSize:12, color:'var(--yellow)' }}>
            ⚠️ {semPix} médico(s) sem chave PIX cadastrada — atualize em <strong>Cadastros → Médicos</strong>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Médico</th><th>CRM</th><th>Chave PIX</th><th style={{textAlign:'right'}}>Bruto</th><th style={{textAlign:'right'}}>Retenção</th><th style={{textAlign:'right'}}>Repasse</th><th>Notas</th><th>Status</th><th>Ações</th>
            </tr></thead>
            <tbody>
              {repassesFiltrados.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">💸</div><h4>Nenhum repasse</h4><p>Selecione outro período ou status</p></div></td></tr>
              ) : repassesFiltrados.map((r, i) => (
                <>
                  <tr key={r.nome} style={{ background: r.status==='pago'?'#F0FDF4':i%2===0?'#fff':'var(--n10)', cursor:'pointer' }}
                    onClick={() => setExpandido(expandido===r.nome ? null : r.nome)}>
                    <td style={{ fontWeight:600 }}>
                      <span style={{ marginRight:6, fontSize:11, color:'var(--n5)' }}>{expandido===r.nome?'▼':'▶'}</span>
                      {r.nome}
                    </td>
                    <td style={{ fontSize:11, color:'var(--n5)' }}>{r.crm||'—'}</td>
                    <td style={{ fontSize:11 }}>
                      {r.chave_pix
                        ? <span style={{ background:'var(--g10)', color:'var(--g3)', border:'1px solid var(--g8)', borderRadius:99, fontSize:10, fontWeight:700, padding:'2px 8px' }}>{r.tipo_pix?.toUpperCase()||'PIX'}: {r.chave_pix}</span>
                        : <span style={{ background:'var(--yellow-l)', color:'var(--yellow)', border:'1px solid #FDE68A', borderRadius:99, fontSize:10, fontWeight:700, padding:'2px 8px' }}>⚠️ Sem PIX</span>
                      }
                    </td>
                    <td className="mono" style={{ textAlign:'right', fontWeight:600 }}>{brl(r.total_bruto)}</td>
                    <td className="mono" style={{ textAlign:'right', color:'var(--n4)' }}>{r.retencao}%</td>
                    <td className="mono" style={{ textAlign:'right', fontWeight:700, color: r.status==='pago'?'var(--g3)':'var(--orange-d)', fontSize:14 }}>{brl(r.total_repasse)}</td>
                    <td className="mono" style={{ textAlign:'center', color:'var(--n5)' }}>{r.notas.length}</td>
                    <td>
                      <span style={{ borderRadius:99, fontSize:10, fontWeight:700, padding:'3px 10px',
                        background: r.status==='pago'?'var(--g10)':r.status==='parcial'?'var(--blue-l)':'var(--yellow-l)',
                        color: r.status==='pago'?'var(--g3)':r.status==='parcial'?'var(--blue)':'var(--yellow)',
                        border: `1px solid ${r.status==='pago'?'var(--g8)':r.status==='parcial'?'#BFDBFE':'#FDE68A'}`
                      }}>
                        {r.status==='pago'?'✓ Pago':r.status==='parcial'?'⟳ Parcial':'⏳ Pendente'}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        {r.chave_pix && r.status !== 'pago' && (
                          <button className="btn btn-outline btn-xs" onClick={() => gerarCSVInter(r)} title="Gerar arquivo .REM para importar no Inter">📤 .REM</button>
                        )}
                        {r.status !== 'pago' && (
                          <button className="btn btn-primary btn-xs" disabled={loading && pagandoId===r.nome} onClick={() => marcarPago(r.nome)}>
                            {loading && pagandoId===r.nome ? <span className="spinner spinner-sm"/> : '✓ Pago'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Linha expandida com notas vinculadas */}
                  {expandido === r.nome && (
                    <tr key={r.nome+'_exp'}>
                      <td colSpan={9} style={{ padding:0, background:'#F8FAFC' }}>
                        <div style={{ padding:'10px 24px 14px', borderLeft:'3px solid var(--g5)' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--n4)', textTransform:'uppercase', letterSpacing:.4, marginBottom:8 }}>
                            Notas vinculadas ao repasse de {r.nome}
                          </div>
                          <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse' }}>
                            <thead><tr style={{ background:'var(--n9)' }}>
                              <th style={{ padding:'6px 10px', textAlign:'left', color:'var(--n5)', fontWeight:600 }}>NF</th>
                              <th style={{ padding:'6px 10px', textAlign:'left', color:'var(--n5)', fontWeight:600 }}>Tomador</th>
                              <th style={{ padding:'6px 10px', textAlign:'left', color:'var(--n5)', fontWeight:600 }}>Competência</th>
                              <th style={{ padding:'6px 10px', textAlign:'right', color:'var(--n5)', fontWeight:600 }}>Bruto médico</th>
                              <th style={{ padding:'6px 10px', textAlign:'center', color:'var(--n5)', fontWeight:600 }}>Retenção</th>
                              <th style={{ padding:'6px 10px', textAlign:'right', color:'var(--n5)', fontWeight:600 }}>Repasse</th>
                              <th style={{ padding:'6px 10px', textAlign:'left', color:'var(--n5)', fontWeight:600 }}>Status nota</th>
                            </tr></thead>
                            <tbody>
                              {r.notas.map((n, j) => (
                                <tr key={j} style={{ background: j%2===0?'#fff':'var(--n10)', borderBottom:'1px solid var(--border)' }}>
                                  <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', fontWeight:600, color:'var(--g3)' }}>{n.nf}</td>
                                  <td style={{ padding:'6px 10px' }}>{n.tomador}</td>
                                  <td style={{ padding:'6px 10px', fontFamily:'var(--mono)' }}>{fmtMes(n.comp)}</td>
                                  <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', textAlign:'right', fontWeight:600 }}>{brl(n.valor_bruto_medico)}</td>
                                  <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', textAlign:'center', color:'var(--n4)' }}>{n.retencao}%</td>
                                  <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', textAlign:'right', fontWeight:700, color:'var(--orange-d)' }}>{brl(n.repasse)}</td>
                                  <td style={{ padding:'6px 10px' }}>
                                    <span className={`badge ${n.status_nota==='Paga ao médico'?'badge-ok':n.status_nota==='Recebida'?'badge-rec':'badge-emit'}`}>{n.status_nota}</span>
                                  </td>
                                </tr>
                              ))}
                              <tr style={{ background:'var(--g1)' }}>
                                <td colSpan={3} style={{ padding:'6px 10px', fontWeight:700, color:'#fff', fontSize:11 }}>TOTAL</td>
                                <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{brl(r.total_bruto)}</td>
                                <td></td>
                                <td style={{ padding:'6px 10px', fontFamily:'var(--mono)', textAlign:'right', fontWeight:700, color:'var(--g7)' }}>{brl(r.total_repasse)}</td>
                                <td></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rodapé totais */}
        {repassesFiltrados.length > 0 && (
          <div style={{ display:'flex', justifyContent:'flex-end', gap:24, padding:'12px 16px', borderTop:'1px solid var(--border)', fontSize:13 }}>
            <span>Total bruto: <strong>{brl(totais.bruto)}</strong></span>
            <span>Total repasses: <strong style={{ color:'var(--orange-d)', fontSize:15 }}>{brl(totais.repasse)}</strong></span>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { Modal } from '../components/Modal'
import { brl, fmtData, fmtMes, pad } from '../lib/helpers'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const MESES_LABEL = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export function Comprovantes({ comprovantes=[], medicos, notas=[], extratoBancario=[], onRefresh }) {
  const { toast } = useToast()
  const [aba, setAba] = useState('comprovantes') // comprovantes | faturamento
  const [busca, setBusca] = useState('')
  const [medicoSel, setMedicoSel] = useState('')
  const [modalWpp, setModalWpp] = useState(false)
  const [wppData, setWppData] = useState({ link:'', msg:'', tel:'' })
  const cfg = JSON.parse(localStorage.getItem('am_cfg4')||'{}')
  const baseUrl = cfg.baseUrl || 'https://aunordmed-lgtm.github.io/aunordmed-financeiro/comprovante.html'

  const filtrados = useMemo(() => comprovantes.filter(c =>
    (!busca || c.medico_nome?.toLowerCase().includes(busca.toLowerCase())) &&
    (!medicoSel || c.medico_nome === medicoSel)
  ), [comprovantes, busca, medicoSel])

  // ── DADOS DE FATURAMENTO POR MÉDICO ───────────────────────────────────
  const medicosOrdenados = useMemo(() =>
    [...medicos].sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR')), [medicos])

  const medicoFat = medicoSel || medicosOrdenados[0]?.nome || ''

  const dadosFaturamento = useMemo(() => {
    if (!medicoFat) return { porMes: [], totais: {}, porTomador: [] }

    const porMes = {}
    const porTomador = {}
    let totalBruto = 0, totalRepasse = 0, countNotas = 0

    let totalRecebidoReal = 0
    notas.forEach(nota => {
      const mn = nota.medicos_nota?.find(m => m.nome === medicoFat)
      if (!mn) return
      countNotas++
      const bruto = mn.valor_bruto_medico || 0
      const repasse = mn.repasse || bruto * (1 - (mn.retencao_individual || 13) / 100)
      totalBruto += bruto
      totalRepasse += repasse
      const paga = nota.status === 'Paga ao médico'
      if (paga) totalRecebidoReal += repasse

      // Por mês
      const comp = nota.comp || ''
      if (comp) {
        if (!porMes[comp]) porMes[comp] = { comp, label: fmtMes(comp), bruto: 0, repasse: 0, recebidoReal: 0, count: 0 }
        porMes[comp].bruto += bruto
        porMes[comp].repasse += repasse
        if (paga) porMes[comp].recebidoReal += repasse
        porMes[comp].count++
      }

      // Por tomador
      const tom = nota.tomador || 'Outros'
      if (!porTomador[tom]) porTomador[tom] = { tomador: tom, bruto: 0, repasse: 0 }
      porTomador[tom].bruto += bruto
      porTomador[tom].repasse += repasse
    })

    // Ordenar meses cronologicamente
    const mesesOrdenados = Object.values(porMes).sort((a,b) => a.comp.localeCompare(b.comp))
    // Top tomadores
    const topTomadores = Object.values(porTomador).sort((a,b) => b.bruto - a.bruto).slice(0, 6)

    // "Recebido real" = regime de caixa: soma do repasse das notas já marcadas
    // "Paga ao médico". Atualiza na hora que o status muda em Notas Fiscais.
    const qtdNotasPagas = notas.filter(n => n.medicos_nota?.some(m => m.nome === medicoFat) && n.status === 'Paga ao médico').length

    return {
      porMes: mesesOrdenados,
      totais: { bruto: totalBruto, repasse: totalRepasse, count: countNotas, recebidoReal: totalRecebidoReal, qtdTransacoesReal: qtdNotasPagas },
      porTomador: topTomadores
    }
  }, [notas, medicoFat])

  const medCadastrado = medicos.find(m => m.nome === medicoFat)

  // ── FUNÇÕES COMPROVANTES ──────────────────────────────────────────────
  const getNumSeq = (c) => {
    const doMedico = comprovantes.filter(x=>x.medico_nome===c.medico_nome).sort((a,b)=>new Date(a.criado_em)-new Date(b.criado_em))
    const idx = doMedico.findIndex(x=>x.id===c.id)
    return idx>=0?idx+1:1
  }

  const montarMensagem = (c) => {
    const link = `${baseUrl}?token=${c.token}`
    const num = pad(getNumSeq(c))
    const dataPag = c.data_pagamento ? fmtData(c.data_pagamento) : fmtData(new Date().toISOString())
    return `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${c.medico_nome}*!\nSeu comprovante de repasse *#${num}* está disponível.\n💰 *Valor:* ${brl(c.valor_repasse)}\n📅 *Data:* ${dataPag}\n🏢 *Tomador:* ${c.tomador||'—'}\n📅 *Competência:* ${fmtMes(c.competencia)}\n📄 Acesse:\n${link}\n_AunordMED — Gestão financeira médica_`
  }

  const abrirWpp = (c) => {
    const link = `${baseUrl}?token=${c.token}`
    const med = medicos.find(m=>m.nome===c.medico_nome)
    const tel = med?.telefone_whatsapp||''
    const msg = montarMensagem(c)
    setWppData({ link, msg, tel })
    setModalWpp(true)
  }

  const copiarMensagem = (c) => {
    const msg = montarMensagem(c)
    navigator.clipboard.writeText(msg).then(()=>toast('Mensagem copiada!')).catch(()=>toast('Erro ao copiar.','error'))
  }

  const copiarLink = (token) => {
    const link = `${baseUrl}?token=${token}`
    navigator.clipboard.writeText(link).then(()=>toast('Link copiado!')).catch(()=>toast('Erro ao copiar.','error'))
  }

  const enviarWpp = async () => {
    const { tel, msg } = wppData
    if(!tel) { toast('Médico sem WhatsApp cadastrado.','error'); return }
    if(cfg.wppUrl&&cfg.wppKey) {
      const r = await fetch(`${cfg.wppUrl}/message/sendText/${cfg.wppInst||'aunordmed'}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.wppKey},body:JSON.stringify({number:tel,text:msg,delay:1000})}).catch(()=>null)
      if(r?.ok) { toast('WhatsApp enviado!'); setModalWpp(false); return }
    }
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`,'_blank')
    toast('Abrindo WhatsApp…')
    setModalWpp(false)
  }

  const excluir = async (id) => {
    if(!window.confirm('Excluir este comprovante?')) return
    await supabase.from('comprovantes').delete().eq('id',id)
    toast('Comprovante excluído.'); onRefresh()
  }

  return (
    <div className="page-content">
      {/* Abas */}
      <div style={{ display:'flex', gap:4, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['comprovantes','🧾 Comprovantes'],['faturamento','📊 Faturamento por médico']].map(([id,label]) => (
          <button key={id} onClick={() => setAba(id)} style={{ padding:'8px 18px', border:'none', borderBottom: aba===id?'2px solid var(--g5)':'2px solid transparent', background:'none', cursor:'pointer', fontSize:13, fontWeight: aba===id?600:400, color: aba===id?'var(--g3)':'var(--n5)', fontFamily:'var(--sans)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA COMPROVANTES ── */}
      {aba === 'comprovantes' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-title">Comprovantes gerados</span>
            <input className="search-input" placeholder="🔍 Buscar médico…" value={busca} onChange={e=>setBusca(e.target.value)}/>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Seq.</th><th>Médico</th><th>NF</th><th>Tomador</th><th>Competência</th><th>Valor repasse</th><th>Data pag.</th><th>Link</th><th>WhatsApp</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtrados.length===0
                ? <tr><td colSpan={12}><div className="empty-state"><div className="empty-icon">🧾</div><h4>Nenhum comprovante</h4><p>São gerados automaticamente ao cadastrar notas</p></div></td></tr>
                : filtrados.map((c,i) => (
                  <tr key={c.id}>
                    <td className="mono" style={{ color:'var(--n5)' }}>{i+1}</td>
                    <td className="mono" style={{ fontWeight:700, color:'var(--g2)' }}>#{pad(getNumSeq(c))}</td>
                    <td style={{ fontWeight:500 }}>{c.medico_nome||'—'}</td>
                    <td className="mono">{c.dados_extras?.nf||'—'}</td>
                    <td>{c.tomador||'—'}</td>
                    <td className="mono">{fmtMes(c.competencia)}</td>
                    <td className="mono" style={{ fontWeight:700, color:'var(--g3)' }}>{brl(c.valor_repasse)}</td>
                    <td className="mono">{c.data_pagamento ? fmtData(c.data_pagamento) : fmtData(new Date().toISOString())}</td>
                    <td style={{ display:'flex', gap:4, paddingTop:6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>copiarMensagem(c)} title="Copia a mensagem completa (pronta para colar no WhatsApp)">💬 Copiar</button>
                      <button className="btn btn-ghost btn-xs" onClick={()=>copiarLink(c.token)} title="Copia só o link">🔗</button>
                      <button className="btn btn-ghost btn-xs" onClick={()=>window.open(`${baseUrl}?token=${c.token}`,'_blank')}>↗</button>
                    </td>
                    <td><button className="btn btn-wpp btn-xs" onClick={()=>abrirWpp(c)}>💬 Enviar</button></td>
                    <td><span className={`badge ${c.whatsapp_enviado?'badge-ok':'badge-emit'}`}>{c.whatsapp_enviado?'✓ Enviado':'Pendente'}</span></td>
                    <td><button className="btn btn-danger btn-xs" onClick={()=>excluir(c.id)}>✕</button></td>
                  </tr>
                ))
              }
            </tbody>
          </table></div>
        </div>
      )}

      {/* ── ABA FATURAMENTO ── */}
      {aba === 'faturamento' && (
        <>
          {/* Seletor de médico */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-body" style={{ display:'flex', alignItems:'center', gap:14 }}>
              <div className="field" style={{ marginBottom:0, flex:1, maxWidth:360 }}>
                <label>Médico</label>
                <select value={medicoSel} onChange={e => setMedicoSel(e.target.value)} style={{ height:36 }}>
                  <option value="">— Selecione um médico —</option>
                  {medicosOrdenados.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                </select>
              </div>
              {medCadastrado && (
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', background:'var(--g10)', border:'1px solid var(--g8)', borderRadius:'var(--radius-lg)' }}>
                  <div style={{ fontSize:13 }}>
                    <div style={{ fontWeight:600, color:'var(--g2)' }}>{medCadastrado.nome}</div>
                    <div style={{ fontSize:11, color:'var(--n5)' }}>
                      {medCadastrado.crm && `CRM ${medCadastrado.crm}`}
                      {medCadastrado.especialidade && ` · ${medCadastrado.especialidade}`}
                      {` · Retenção ${medCadastrado.retencao||13}%`}
                    </div>
                  </div>
                  {medCadastrado.telefone_whatsapp && (
                    <a href={`https://wa.me/55${medCadastrado.telefone_whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">💬</a>
                  )}
                </div>
              )}
            </div>
          </div>

          {!medicoFat ? (
            <div className="empty-state"><div className="empty-icon">👨‍⚕️</div><h4>Selecione um médico</h4><p>Escolha um médico para ver o dashboard de faturamento</p></div>
          ) : (
            <>
              {/* KPIs */}
              <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(5,1fr)', marginBottom:14 }}>
                {[
                  { bar:'var(--g5)', ic:'var(--g10)', icon:'💰', label:'Total bruto', value: brl(dadosFaturamento.totais.bruto), sub:'Acumulado' },
                  { bar:'var(--blue)', ic:'var(--blue-l)', icon:'📥', label:'Total repasse (devido)', value: brl(dadosFaturamento.totais.repasse), sub:`Após ${medCadastrado?.retencao||13}% retenção` },
                  { bar:'#16A34A', ic:'#F0FDF4', icon:'✅', label:'Recebido real', value: brl(dadosFaturamento.totais.recebidoReal), sub:`${dadosFaturamento.totais.qtdTransacoesReal} nota(s) paga(s)` },
                  { bar:'var(--orange)', ic:'var(--orange-l)', icon:'📄', label:'NFs vinculadas', value: dadosFaturamento.totais.count, sub:'Total de notas' },
                  { bar:'var(--g5)', ic:'var(--g10)', icon:'📊', label:'Meses ativos', value: dadosFaturamento.porMes.length, sub:'Com faturamento' },
                ].map((k,i) => (
                  <div key={i} className="kpi">
                    <div className="kpi-bar" style={{ background:k.bar }}/>
                    <div className="kpi-icon" style={{ background:k.ic }}>{k.icon}</div>
                    <div className="kpi-label">{k.label}</div>
                    <div className="kpi-value">{k.value}</div>
                    <div className="kpi-sub">{k.sub}</div>
                  </div>
                ))}
              </div>

              {dadosFaturamento.porMes.length === 0 ? (
                <div className="empty-state"><p>Nenhuma nota encontrada para este médico.</p></div>
              ) : (
                <>
                  {/* Gráfico bruto x repasse por mês */}
                  <div className="card" style={{ marginBottom:14 }}>
                    <div className="card-header"><h3>📊 Bruto × Repasse por mês</h3></div>
                    <div className="card-body">
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={dadosFaturamento.porMes} margin={{ top:4, right:4, bottom:4, left:4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                          <XAxis dataKey="label" tick={{ fontSize:10 }}/>
                          <YAxis tick={{ fontSize:10 }} tickFormatter={v => 'R$'+(v/1000).toFixed(0)+'k'}/>
                          <Tooltip formatter={v => brl(v)}/>
                          <Bar dataKey="bruto" name="Bruto" fill="#14532D" radius={[3,3,0,0]}/>
                          <Bar dataKey="repasse" name="Repasse" fill="#16A34A" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                    {/* Evolução do repasse */}
                    <div className="card">
                      <div className="card-header"><h3>📈 Evolução do repasse</h3></div>
                      <div className="card-body">
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={dadosFaturamento.porMes}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                            <XAxis dataKey="label" tick={{ fontSize:10 }}/>
                            <YAxis tick={{ fontSize:10 }} tickFormatter={v => 'R$'+(v/1000).toFixed(0)+'k'}/>
                            <Tooltip formatter={v => brl(v)}/>
                            <Line type="monotone" dataKey="repasse" name="Repasse" stroke="#16A34A" strokeWidth={2.5} dot={{ fill:'#16A34A', r:4 }}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Top tomadores */}
                    <div className="card">
                      <div className="card-header"><h3>🏥 Principais tomadores</h3></div>
                      <div className="card-body" style={{ padding:0 }}>
                        {dadosFaturamento.porTomador.map((t, i) => {
                          const maxBruto = dadosFaturamento.porTomador[0]?.bruto || 1
                          const pct = (t.bruto / maxBruto) * 100
                          return (
                            <div key={i} style={{ padding:'10px 16px', borderBottom: i < dadosFaturamento.porTomador.length-1 ? '1px solid var(--border)' : 'none' }}>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                                <span style={{ fontSize:12, fontWeight:500, color:'var(--n2)' }}>{t.tomador}</span>
                                <span style={{ fontSize:12, fontFamily:'var(--mono)', fontWeight:600, color:'var(--g3)' }}>{brl(t.bruto)}</span>
                              </div>
                              <div style={{ height:4, background:'var(--n8)', borderRadius:2, overflow:'hidden' }}>
                                <div style={{ height:'100%', width:`${pct}%`, background:'var(--g5)', borderRadius:2, transition:'width .3s' }}/>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Tabela mensal */}
                  <div className="card">
                    <div className="card-header"><h3>📅 Histórico mensal</h3></div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr>
                          <th>Competência</th>
                          <th style={{textAlign:'right'}}>NFs</th>
                          <th style={{textAlign:'right'}}>Bruto</th>
                          <th style={{textAlign:'right'}}>Repasse (devido)</th>
                          <th style={{textAlign:'right'}}>Recebido real</th>
                          <th style={{textAlign:'right'}}>Diferença</th>
                        </tr></thead>
                        <tbody>
                          {dadosFaturamento.porMes.map((m,i) => {
                            const diff = m.recebidoReal - m.repasse
                            return (
                              <tr key={m.comp} style={{ background: i%2===0?'#fff':'var(--n10)' }}>
                                <td style={{ fontWeight:600 }}>{m.label}</td>
                                <td className="mono" style={{ textAlign:'right' }}>{m.count}</td>
                                <td className="mono" style={{ textAlign:'right', fontWeight:600 }}>{brl(m.bruto)}</td>
                                <td className="mono" style={{ textAlign:'right', color:'var(--g3)', fontWeight:700 }}>{brl(m.repasse)}</td>
                                <td className="mono" style={{ textAlign:'right', color:'#16A34A', fontWeight:700 }}>{brl(m.recebidoReal)}</td>
                                <td className="mono" style={{ textAlign:'right', fontWeight:600, color: Math.abs(diff) < 0.01 ? 'var(--n4)' : diff < 0 ? 'var(--red, #DC2626)' : 'var(--g3)' }}>
                                  {diff >= 0 ? '+' : '-'}{brl(Math.abs(diff))}
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ background:'var(--g1)' }}>
                            <td style={{ fontWeight:700, color:'#fff' }}>TOTAL</td>
                            <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{dadosFaturamento.totais.count}</td>
                            <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.85)' }}>{brl(dadosFaturamento.totais.bruto)}</td>
                            <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'var(--g7)' }}>{brl(dadosFaturamento.totais.repasse)}</td>
                            <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'#4ADE80' }}>{brl(dadosFaturamento.totais.recebidoReal)}</td>
                            <td className="mono" style={{ textAlign:'right', fontWeight:700, color:'rgba(255,255,255,.7)' }}>
                              {(dadosFaturamento.totais.recebidoReal - dadosFaturamento.totais.repasse) >= 0 ? '+' : '-'}{brl(Math.abs(dadosFaturamento.totais.recebidoReal - dadosFaturamento.totais.repasse))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* MODAL WHATSAPP */}
      <Modal open={modalWpp} onClose={()=>setModalWpp(false)} title="💬 Enviar por WhatsApp"
        footer={<>
          <button className="btn btn-ghost" onClick={()=>setModalWpp(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={()=>{navigator.clipboard.writeText(wppData.link);toast('Link copiado!')}}>🔗 Só copiar link</button>
          <button className="btn btn-wpp" onClick={enviarWpp}>💬 Enviar WhatsApp</button>
        </>}>
        <div className="field" style={{ marginBottom:10 }}>
          <label>Link do comprovante</label>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
            <input type="text" value={wppData.link} readOnly style={{ background:'var(--n9)', fontFamily:'var(--mono)', fontSize:11 }}/>
            <button className="btn btn-ghost btn-sm" onClick={()=>{navigator.clipboard.writeText(wppData.link);toast('Copiado!')}}>Copiar</button>
          </div>
        </div>
        <div className="field">
          <label>Mensagem (editável)</label>
          <textarea style={{ marginTop:4, fontSize:12, lineHeight:1.7, height:220 }} value={wppData.msg} onChange={e=>setWppData(d=>({...d,msg:e.target.value}))}/>
        </div>
      </Modal>
    </div>
  )
}

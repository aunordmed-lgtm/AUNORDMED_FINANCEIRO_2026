import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl, fmtData, hoje } from '../lib/helpers'

const VALOR_PADRAO_INDICACAO = 150

export function Cashback({ cashbacks=[], medicos, notas=[], onRefresh }) {
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ medico_indicador:'', medico_nome:'', valor:String(VALOR_PADRAO_INDICACAO), data_cashback:hoje(), descricao:'' })

  const medicosOrdenados = useMemo(() => [...medicos].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')), [medicos])

  // Só entra como "médico indicado" quem já tem pelo menos 1 nota lançada —
  // é a trava pedida: não libera cadastrar cashback de indicação pra quem
  // ainda não faturou nada.
  const medicosComNota = useMemo(() => {
    const s = new Set()
    notas.forEach(n => {
      const meds = n.medicos_nota?.length ? n.medicos_nota : (n.nomes_medicos ? n.nomes_medicos.split(',').map(nm => ({ nome: nm.trim() })) : [])
      meds.forEach(mn => mn.nome && s.add(mn.nome))
    })
    return s
  }, [notas])

  const medicosIndicaveis = useMemo(() =>
    medicosOrdenados.filter(m => medicosComNota.has(m.nome))
  , [medicosOrdenados, medicosComNota])

  // Valor bruto da primeira nota do médico indicado — só como referência/conferência.
  function medsDaNota(n) {
    return n.medicos_nota?.length ? n.medicos_nota : (n.nomes_medicos ? n.nomes_medicos.split(',').map(nm => ({ nome: nm.trim() })) : [])
  }

  function primeiraNotaBruto(nomeMedico) {
    if (!nomeMedico) return null
    const doMedico = notas.filter(n => medsDaNota(n).some(mn => mn.nome === nomeMedico))
    if (!doMedico.length) return null
    // Ordena pela competência real da nota (e data de emissão como desempate) —
    // NÃO pela data em que foi cadastrada no sistema, que pode ser bem diferente
    // quando notas são importadas em lote, fora de ordem cronológica.
    const ordenadas = [...doMedico].sort((a, b) =>
      (a.comp || '').localeCompare(b.comp || '') || (a.emissao || '').localeCompare(b.emissao || '')
    )
    const primeira = ordenadas[0]
    const mn = medsDaNota(primeira).find(m => m.nome === nomeMedico)
    if (mn?.valor_bruto_medico > 0) {
      return { bruto: mn.valor_bruto_medico, nf: primeira.nf, comp: primeira.comp, aproximado: false }
    }
    // Nota antiga sem valor individual por médico salvo — mostra o bruto total
    // da nota como aproximação, deixando claro que não é o valor exato dele.
    return { bruto: primeira.bruto || 0, nf: primeira.nf, comp: primeira.comp, aproximado: true }
  }

  const totalPend = cashbacks.filter(c=>c.status==='pendente').reduce((s,c)=>s+c.valor,0)

  const abrir = (c=null) => {
    setEditando(c)
    setForm(c
      ? { medico_indicador:c.medico_indicador||'', medico_nome:c.medico_nome||'', valor:String(c.valor||''), data_cashback:c.data_cashback||hoje(), descricao:c.descricao||'' }
      : { medico_indicador:'', medico_nome:'', valor:String(VALOR_PADRAO_INDICACAO), data_cashback:hoje(), descricao:'' })
    setModalOpen(true)
  }

  const salvar = async () => {
    if(!form.medico_indicador||!form.medico_nome||!form.valor) { toast('Preencha quem indicou, o médico indicado e o valor.','error'); return }
    const payload = {
      medico_indicador: form.medico_indicador,
      medico_nome: form.medico_nome,
      tipo: 'indicacao',
      valor: parseFloat(form.valor),
      data_cashback: form.data_cashback,
      descricao: form.descricao,
    }
    setLoading(true)
    try {
      if(editando) { await supabase.from('cashback').update(payload).eq('id',editando.id); toast('Atualizado!') }
      else { await supabase.from('cashback').insert({ ...payload, status:'pendente' }); toast('Cashback registrado!') }
      setModalOpen(false); onRefresh()
    } catch(e) { toast('Erro: '+e.message,'error') }
    setLoading(false)
  }

  const marcar = async (id) => {
    await supabase.from('cashback').update({ status:'pago', data_pagamento: hoje() }).eq('id',id)
    toast('Marcado como pago!'); onRefresh()
  }
  const excluir = async (id) => { if(!window.confirm('Excluir?'))return; await supabase.from('cashback').delete().eq('id',id); toast('Removido.'); onRefresh() }

  const refBruto = primeiraNotaBruto(form.medico_nome)

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar">
          <span className="table-title">Cashback — indicação entre médicos</span>
          {totalPend > 0 && <span className="badge badge-danger">{brl(totalPend)} pendente(s)</span>}
          <button className="btn btn-purple btn-sm" style={{ marginLeft: 'auto' }} onClick={()=>abrir()}>+ Novo cashback</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Data</th><th>Indicou</th><th>Indicado</th><th>Valor</th><th>Descrição</th><th>Status</th><th>Pago em</th><th>Ações</th></tr></thead>
          <tbody>
            {cashbacks.length===0?(<tr><td colSpan={8}><div className="empty-state"><div className="empty-icon">🎁</div><h4>Nenhum cashback</h4></div></td></tr>)
            :cashbacks.map(c=>(
              <tr key={c.id}>
                <td className="mono">{fmtData(c.data_cashback)}</td>
                <td style={{ fontWeight:500 }}>{c.medico_indicador || '—'}</td>
                <td style={{ fontWeight:500, color:'var(--g2)' }}>{c.medico_nome}</td>
                <td className="mono" style={{ fontWeight:700, color:'var(--purple-d)' }}>{brl(c.valor)}</td>
                <td style={{ color:'var(--gray2)' }}>{c.descricao||'—'}</td>
                <td><span className={`badge ${c.status==='pendente'?'badge-danger':'badge-ok'}`}>{c.status==='pendente'?'Pendente':'✓ Pago'}</span></td>
                <td className="mono" style={{ color:'var(--n5)' }}>{c.data_pagamento ? fmtData(c.data_pagamento) : '—'}</td>
                <td style={{ display:'flex', gap:4, paddingTop:6 }}>
                  {c.status==='pendente'&&<button className="btn btn-purple btn-xs" onClick={()=>marcar(c.id)}>✓ Pago</button>}
                  <button className="btn btn-ghost btn-xs" onClick={()=>abrir(c)}>✏️</button>
                  <button className="btn btn-danger btn-xs" onClick={()=>excluir(c.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title={editando?'Editar cashback':'Novo cashback'} size="sm"
        footer={<><button className="btn btn-ghost" onClick={()=>setModalOpen(false)}>Cancelar</button><button className="btn btn-purple" onClick={salvar} disabled={loading}>{loading?<><span className="spinner spinner-sm"/> Salvando…</>:'Salvar'}</button></>}>
        <div className="form-grid">
          <div className="field form-full"><label>Médico que indicou *</label>
            <select value={form.medico_indicador} onChange={e=>setForm(f=>({...f,medico_indicador:e.target.value}))}>
              <option value="">— selecione —</option>
              {medicosOrdenados.map(m=><option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div className="field form-full"><label>Médico indicado *</label>
            <select value={form.medico_nome} onChange={e=>setForm(f=>({...f,medico_nome:e.target.value}))}>
              <option value="">— selecione —</option>
              {medicosIndicaveis.map(m=><option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--n5)', marginTop: 3 }}>
              Só aparecem aqui médicos que já têm pelo menos uma nota lançada.
            </div>
            {refBruto && (
              <div style={{ fontSize: 11, color: 'var(--g3)', marginTop: 4, fontWeight: 600 }}>
                📄 Primeira nota: NF {refBruto.nf || '—'} · {brl(refBruto.bruto)} bruto{refBruto.aproximado ? ' (total da nota, não individual)' : ''}
              </div>
            )}
          </div>
          <div className="field"><label>Valor (R$) *</label>
            <input type="number" className="inp-money" value={form.valor} onChange={e=>setForm(f=>({...f,valor:e.target.value}))} step="0.01" placeholder="150,00"/>
            <div style={{ fontSize: 10.5, color: 'var(--n5)', marginTop: 3 }}>Padrão: R$ {VALOR_PADRAO_INDICACAO},00 por indicação — editável.</div>
          </div>
          <div className="field"><label>Data</label><input type="date" value={form.data_cashback} onChange={e=>setForm(f=>({...f,data_cashback:e.target.value}))}/></div>
          <div className="field form-full"><label>Descrição</label><input type="text" value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} placeholder="Detalhes"/></div>
        </div>
      </Modal>
    </div>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl, fmtData, hoje } from '../lib/helpers'

const TIPOS = { indicacao:'🤝 Indicação', reducao_aliquota:'📉 Redução alíquota', primeiro_pagamento:'1️⃣ Primeiro pagamento', outro:'🎁 Outro' }

export function Cashback({ cashbacks=[], medicos, onRefresh }) {
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ medico_nome:'', tipo:'indicacao', valor:'', data_cashback:hoje(), descricao:'' })

  const totalPend = cashbacks.filter(c=>c.status==='pendente').reduce((s,c)=>s+c.valor,0)

  const abrir = (c=null) => {
    setEditando(c)
    setForm(c ? { medico_nome:c.medico_nome||'', tipo:c.tipo||'indicacao', valor:c.valor||'', data_cashback:c.data_cashback||hoje(), descricao:c.descricao||'' }
      : { medico_nome:'', tipo:'indicacao', valor:'', data_cashback:hoje(), descricao:'' })
    setModalOpen(true)
  }

  const salvar = async () => {
    if(!form.medico_nome||!form.valor) { toast('Preencha médico e valor.','error'); return }
    const payload = { ...form, valor:parseFloat(form.valor), status:'pendente' }
    setLoading(true)
    try {
      if(editando) { await supabase.from('cashback').update(payload).eq('id',editando.id); toast('Atualizado!') }
      else { await supabase.from('cashback').insert(payload); toast('Cashback registrado!') }
      setModalOpen(false); onRefresh()
    } catch(e) { toast('Erro: '+e.message,'error') }
    setLoading(false)
  }

  const marcar = async (id) => { await supabase.from('cashback').update({status:'pago'}).eq('id',id); toast('Marcado como pago!'); onRefresh() }
  const excluir = async (id) => { if(!window.confirm('Excluir?'))return; await supabase.from('cashback').delete().eq('id',id); toast('Removido.'); onRefresh() }

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar"><span className="table-title">Cashback e bonificações</span><button className="btn btn-purple btn-sm" onClick={()=>abrir()}>+ Novo cashback</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Data</th><th>Médico</th><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {cashbacks.length===0?(<tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">🎁</div><h4>Nenhum cashback</h4></div></td></tr>)
            :cashbacks.map(c=>(
              <tr key={c.id}>
                <td className="mono">{fmtData(c.data_cashback)}</td>
                <td style={{ fontWeight:500, color:'var(--g2)' }}>{c.medico_nome}</td>
                <td>{TIPOS[c.tipo]||c.tipo}</td>
                <td className="mono" style={{ fontWeight:700, color:'var(--purple-d)' }}>{brl(c.valor)}</td>
                <td style={{ color:'var(--gray2)' }}>{c.descricao||'—'}</td>
                <td><span className={`badge ${c.status==='pendente'?'badge-danger':'badge-ok'}`}>{c.status==='pendente'?'Pendente':'Pago'}</span></td>
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
          <div className="field form-full"><label>Médico *</label>
            <select value={form.medico_nome} onChange={e=>setForm(f=>({...f,medico_nome:e.target.value}))}>
              <option value="">— selecione —</option>
              {[...medicos].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')).map(m=><option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div className="field form-full"><label>Tipo *</label>
            <select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}>
              {Object.entries(TIPOS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field"><label>Valor (R$) *</label><input type="number" className="inp-money" value={form.valor} onChange={e=>setForm(f=>({...f,valor:e.target.value}))} step="0.01" placeholder="0,00"/></div>
          <div className="field"><label>Data</label><input type="date" value={form.data_cashback} onChange={e=>setForm(f=>({...f,data_cashback:e.target.value}))}/></div>
          <div className="field form-full"><label>Descrição</label><input type="text" value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} placeholder="Detalhes"/></div>
        </div>
      </Modal>
    </div>
  )
}

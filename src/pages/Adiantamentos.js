import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl, fmtData, hoje } from '../lib/helpers'

export function Adiantamentos({ adiantamentos=[], medicos, onRefresh }) {
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ medico_nome:'', valor:'', data_adiantamento:hoje(), descricao:'' })

  const totalPend = adiantamentos.filter(a=>a.status==='pendente').reduce((s,a)=>s+a.valor,0)

  const abrir = (a=null) => {
    setEditando(a)
    setForm(a ? { medico_nome:a.medico_nome||'', valor:a.valor||'', data_adiantamento:a.data_adiantamento||hoje(), descricao:a.descricao||'' }
      : { medico_nome:'', valor:'', data_adiantamento:hoje(), descricao:'' })
    setModalOpen(true)
  }

  const salvar = async () => {
    if(!form.medico_nome||!form.valor) { toast('Preencha médico e valor.','error'); return }
    const payload = { ...form, valor:parseFloat(form.valor), status:'pendente' }
    setLoading(true)
    try {
      if(editando) { await supabase.from('adiantamentos').update(payload).eq('id',editando.id); toast('Atualizado!') }
      else { await supabase.from('adiantamentos').insert(payload); toast('Adiantamento registrado!') }
      setModalOpen(false); onRefresh()
    } catch(e) { toast('Erro: '+e.message,'error') }
    setLoading(false)
  }

  const marcar = async (id) => { await supabase.from('adiantamentos').update({status:'descontado'}).eq('id',id); toast('Marcado como descontado!'); onRefresh() }
  const excluir = async (id) => { if(!window.confirm('Excluir?'))return; await supabase.from('adiantamentos').delete().eq('id',id); toast('Removido.'); onRefresh() }

  return (
    <div className="page-content">
      <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(2,1fr)', marginBottom:14 }}>
        <div className="kpi"><div className="kpi-bar" style={{ background:'var(--orange)' }}/><div className="kpi-icon" style={{ background:'var(--orange-l)' }}>💵</div><div className="kpi-label">Adiantamentos pendentes</div><div className="kpi-value">{brl(totalPend)}</div><div className="kpi-sub">{adiantamentos.filter(a=>a.status==='pendente').length} item(s)</div></div>
        <div className="kpi"><div className="kpi-bar" style={{ background:'var(--g3)' }}/><div className="kpi-icon" style={{ background:'var(--g7)' }}>✅</div><div className="kpi-label">Descontados</div><div className="kpi-value">{brl(adiantamentos.filter(a=>a.status==='descontado').reduce((s,a)=>s+a.valor,0))}</div><div className="kpi-sub">{adiantamentos.filter(a=>a.status==='descontado').length} item(s)</div></div>
      </div>
      <div className="card">
        <div className="table-toolbar"><span className="table-title">Adiantamentos</span><button className="btn btn-orange btn-sm" onClick={()=>abrir()}>+ Novo adiantamento</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Data</th><th>Médico</th><th>Valor</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {adiantamentos.length===0?(<tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">💵</div><h4>Nenhum adiantamento</h4></div></td></tr>)
            :adiantamentos.map(a=>(
              <tr key={a.id}>
                <td className="mono">{fmtData(a.data_adiantamento)}</td>
                <td style={{ fontWeight:500, color:'var(--g2)' }}>{a.medico_nome}</td>
                <td className="mono" style={{ fontWeight:700, color:'var(--orange-d)' }}>{brl(a.valor)}</td>
                <td style={{ color:'var(--gray2)' }}>{a.descricao||'—'}</td>
                <td><span className={`badge ${a.status==='pendente'?'badge-emit':'badge-ok'}`}>{a.status==='pendente'?'Pendente':'Descontado'}</span></td>
                <td style={{ display:'flex', gap:4, paddingTop:6 }}>
                  {a.status==='pendente'&&<button className="btn btn-outline btn-xs" onClick={()=>marcar(a.id)}>✓ Descontar</button>}
                  <button className="btn btn-ghost btn-xs" onClick={()=>abrir(a)}>✏️</button>
                  <button className="btn btn-danger btn-xs" onClick={()=>excluir(a.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title={editando?'Editar adiantamento':'Novo adiantamento'} size="sm"
        footer={<><button className="btn btn-ghost" onClick={()=>setModalOpen(false)}>Cancelar</button><button className="btn btn-orange" onClick={salvar} disabled={loading}>{loading?<><span className="spinner spinner-sm"/> Salvando…</>:'Salvar'}</button></>}>
        <div className="form-grid">
          <div className="field form-full"><label>Médico *</label>
            <select value={form.medico_nome} onChange={e=>setForm(f=>({...f,medico_nome:e.target.value}))}>
              <option value="">— selecione —</option>
              {[...medicos].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')).map(m=><option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div className="field"><label>Valor (R$) *</label><input type="number" className="inp-money" value={form.valor} onChange={e=>setForm(f=>({...f,valor:e.target.value}))} step="0.01" placeholder="0,00"/></div>
          <div className="field"><label>Data</label><input type="date" value={form.data_adiantamento} onChange={e=>setForm(f=>({...f,data_adiantamento:e.target.value}))}/></div>
          <div className="field form-full"><label>Descrição</label><input type="text" value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} placeholder="Motivo do adiantamento"/></div>
        </div>
      </Modal>
    </div>
  )
}

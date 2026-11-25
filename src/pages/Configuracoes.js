
import { useState, useEffect } from 'react'
import { useToast } from '../components/Toast'
import { cfgKey } from '../lib/empresas'

export function Configuracoes({ onRefresh }) {
  const { toast } = useToast()
  const [cfg, setCfg] = useState({ imposto:'6.15', retencao:'13', nome:'AunordMED', cnpj:'', wppUrl:'', wppKey:'', wppInst:'aunordmed', baseUrl:'https://aunordmed-lgtm.github.io/aunordmed-financeiro/comprovante.html' })

  useEffect(() => {
    const s = localStorage.getItem(cfgKey())
    if(s) setCfg(c=>({...c,...JSON.parse(s)}))
  }, [])

  const salvar = () => {
    localStorage.setItem(cfgKey(), JSON.stringify(cfg))
    toast('Configurações salvas!')
  }

  const testarWpp = async () => {
    if(!cfg.wppUrl||!cfg.wppKey) { toast('Configure URL e API Key primeiro.','error'); return }
    try {
      const r = await fetch(`${cfg.wppUrl}/instance/connectionState/${cfg.wppInst}`,{headers:{'apikey':cfg.wppKey}})
      const d = await r.json()
      if(d.instance?.state==='open') toast('✅ WhatsApp conectado!','wpp')
      else toast('⚠️ WhatsApp desconectado. Verifique o QR Code.','error')
    } catch(e) { toast('Erro ao testar: '+e.message,'error') }
  }

  const Row = ({label, sub, children}) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid var(--gray6)' }}>
      <div><div style={{ fontSize:13, fontWeight:500 }}>{label}</div>{sub&&<div style={{ fontSize:11, color:'var(--gray3)', marginTop:2 }}>{sub}</div>}</div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>{children}</div>
    </div>
  )

  return (
    <div className="page-content">
      <div className="card" style={{ maxWidth:580 }}>
        <div className="card-header"><h3>⚙️ Configurações gerais</h3></div>
        <div className="card-body">
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--gray3)', textTransform:'uppercase', letterSpacing:.4, marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>Impostos e retenções</div>
            <Row label="Imposto federal retido" sub="ISS/PIS/COFINS descontados pelo tomador">
              <input type="number" style={{ width:80, textAlign:'center', fontFamily:'var(--mono)', fontWeight:600, height:34 }} value={cfg.imposto} onChange={e=>setCfg(c=>({...c,imposto:e.target.value}))} step="0.01"/>
              <span style={{ fontWeight:600, color:'var(--gray3)' }}>%</span>
            </Row>
            <Row label="Retenção padrão PJ" sub="Usado quando o médico não tem % individual">
              <input type="number" style={{ width:80, textAlign:'center', fontFamily:'var(--mono)', fontWeight:600, height:34 }} value={cfg.retencao} onChange={e=>setCfg(c=>({...c,retencao:e.target.value}))} step="0.01"/>
              <span style={{ fontWeight:600, color:'var(--gray3)' }}>%</span>
            </Row>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--gray3)', textTransform:'uppercase', letterSpacing:.4, marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>WhatsApp (Evolution API)</div>
            {[['wppUrl','URL da Evolution API','https://sua-evolution.com'],['wppKey','API Key','sua-api-key'],['wppInst','Nome da instância','aunordmed']].map(([k,l,p])=>(
              <div key={k} className="field" style={{ marginBottom:8 }}><label>{l}</label><input type={k==='wppKey'?'password':'text'} value={cfg[k]} onChange={e=>setCfg(c=>({...c,[k]:e.target.value}))} placeholder={p}/></div>
            ))}
            <button className="btn btn-wpp btn-sm" onClick={testarWpp}>🟢 Testar WhatsApp</button>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--gray3)', textTransform:'uppercase', letterSpacing:.4, marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>URL base dos comprovantes</div>
            <div className="field"><input type="text" value={cfg.baseUrl} onChange={e=>setCfg(c=>({...c,baseUrl:e.target.value}))} placeholder="https://seusite.com/comprovante.html"/></div>
            <div style={{ fontSize:11, color:'var(--gray3)', marginTop:4 }}>Usado para gerar os links enviados por WhatsApp</div>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--gray3)', textTransform:'uppercase', letterSpacing:.4, marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>Empresa</div>
            <div className="form-grid">
              <div className="field"><label>Nome</label><input type="text" value={cfg.nome} onChange={e=>setCfg(c=>({...c,nome:e.target.value}))} placeholder="AunordMED"/></div>
              <div className="field"><label>CNPJ</label><input type="text" value={cfg.cnpj} onChange={e=>setCfg(c=>({...c,cnpj:e.target.value}))} placeholder="00.000.000/0001-00"/></div>
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-primary" onClick={salvar}>Salvar configurações</button>
            <button className="btn btn-ghost" onClick={onRefresh}>🔄 Sincronizar dados</button>
          </div>
        </div>
      </div>
    </div>
  )
}

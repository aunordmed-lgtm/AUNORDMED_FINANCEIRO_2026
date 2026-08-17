import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { brl, fmtData, fmtMes } from '../lib/helpers'

export function Comprovante() {
  const [comp, setComp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) {
      setErro('Token não informado na URL.')
      setLoading(false)
      return
    }
    // Buscar sem autenticação — requer RLS público na tabela comprovantes
    supabase
      .from('comprovantes')
      .select('*')
      .eq('token', token)
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          setErro(`Erro ao buscar comprovante: ${error.message}`)
          setLoading(false)
          return
        }
        if (!data || data.length === 0) {
          setErro('Comprovante não encontrado ou link inválido.')
          setLoading(false)
          return
        }
        setComp(data[0])
        setLoading(false)
      })
  }, [])

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#F1F5F9', gap:12 }}>
      <div style={{ width:36, height:36, border:'3px solid #16A34A', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
      <span style={{ color:'#64748B', fontSize:13 }}>Carregando comprovante…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (erro) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#F1F5F9', padding:16 }}>
      <div style={{ textAlign:'center', color:'#64748B', maxWidth:400 }}>
        <div style={{ fontSize:56, marginBottom:16 }}>🔍</div>
        <h2 style={{ color:'#1E293B', marginBottom:8, fontSize:18 }}>Comprovante não encontrado</h2>
        <p style={{ fontSize:13, lineHeight:1.6 }}>{erro}</p>
        <p style={{ fontSize:11, color:'#94A3B8', marginTop:16 }}>
          Se você recebeu este link, verifique se ele está completo e tente novamente.
        </p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#F1F5F9', padding:'32px 16px', fontFamily:'Inter,system-ui,sans-serif' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ maxWidth:540, margin:'0 auto' }}>

        {/* Header verde */}
        <div style={{ background:'linear-gradient(135deg,#0D3D20 0%,#166534 100%)', borderRadius:'16px 16px 0 0', padding:'28px 32px', color:'#fff', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:-40, right:-40, width:150, height:150, borderRadius:'50%', background:'rgba(255,255,255,.05)' }}/>
          <div style={{ position:'absolute', bottom:-50, left:-20, width:120, height:120, borderRadius:'50%', background:'rgba(255,255,255,.04)' }}/>
          <div style={{ fontSize:10, letterSpacing:2, textTransform:'uppercase', color:'rgba(255,255,255,.5)', marginBottom:6, position:'relative' }}>
            AunordMED Financeiro
          </div>
          <div style={{ fontSize:22, fontWeight:700, marginBottom:4, position:'relative' }}>
            Comprovante de Repasse
          </div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,.4)', position:'relative' }}>
            {fmtMes(comp.competencia)} · Emitido em {fmtData(comp.criado_em)}
          </div>
        </div>

        {/* Corpo */}
        <div style={{ background:'#fff', padding:'28px 32px', borderLeft:'1px solid #E2E8F0', borderRight:'1px solid #E2E8F0' }}>

          {/* Médico */}
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:9, letterSpacing:1.2, textTransform:'uppercase', color:'#94A3B8', marginBottom:4, fontWeight:600 }}>Beneficiário</div>
            <div style={{ fontSize:19, fontWeight:700, color:'#0F172A' }}>{comp.medico_nome}</div>
            {comp.medico_crm && <div style={{ fontSize:12, color:'#64748B', marginTop:2 }}>CRM {comp.medico_crm}</div>}
          </div>

          {/* Grid de dados */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:22 }}>
            {[
              { label:'Tomador', value: comp.tomador || '—' },
              { label:'Competência', value: fmtMes(comp.competencia) },
              { label:'Nota Fiscal', value: comp.dados_extras?.nf || '—' },
              { label:'Data pagamento', value: comp.data_pagamento ? fmtData(comp.data_pagamento) : 'A definir' },
            ].map((item, i) => (
              <div key={i} style={{ background:'#F8FAFC', borderRadius:10, padding:'12px 14px', border:'1px solid #F1F5F9' }}>
                <div style={{ fontSize:9, letterSpacing:1, textTransform:'uppercase', color:'#94A3B8', marginBottom:4, fontWeight:600 }}>{item.label}</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1E293B', lineHeight:1.3 }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Valor em destaque */}
          <div style={{ background:'#F0FDF4', border:'2px solid #BBF7D0', borderRadius:14, padding:'22px 24px', textAlign:'center', marginBottom:22 }}>
            <div style={{ fontSize:10, letterSpacing:1.5, textTransform:'uppercase', color:'#16A34A', marginBottom:8, fontWeight:700 }}>
              Valor do repasse
            </div>
            <div style={{ fontSize:36, fontWeight:800, color:'#0D3D20', fontFamily:'monospace', letterSpacing:-1 }}>
              {brl(comp.valor_repasse)}
            </div>
            <div style={{ fontSize:11, color:'#86EFAC', marginTop:6 }}>
              Após retenção de {comp.dados_extras?.retencao || 13}%
            </div>
          </div>

          {/* PIX */}
          {comp.dados_extras?.pix && (
            <div style={{ background:'#F8FAFC', borderRadius:10, padding:'12px 16px', border:'1px solid #E2E8F0', display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ fontSize:20 }}>💸</div>
              <div>
                <div style={{ fontSize:9, letterSpacing:1, textTransform:'uppercase', color:'#94A3B8', marginBottom:2, fontWeight:600 }}>Chave PIX</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1E293B', fontFamily:'monospace' }}>
                  {comp.dados_extras.tipo_pix?.toUpperCase()}: {comp.dados_extras.pix}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', borderTop:'none', borderRadius:'0 0 16px 16px', padding:'14px 32px', textAlign:'center' }}>
          <div style={{ fontSize:11, color:'#94A3B8', fontWeight:500 }}>
            AunordMED Financeiro · Gestão financeira médica
          </div>
        </div>

      </div>
    </div>
  )
}

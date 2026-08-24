import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

const TIPOS = [
  { key: 'contrato_social', label: '📜 Último Contrato Social' },
  { key: 'certidao_federal', label: '📄 Certidão Negativa Federal' },
  { key: 'certidao_estadual', label: '📄 Certidão Negativa Estadual' },
  { key: 'certidao_municipal', label: '📄 Certidão Negativa Municipal' },
  { key: 'certidao_fgts', label: '📄 Certidão Negativa do FGTS' },
  { key: 'certidao_trabalhista', label: '📄 Certidão Negativa Trabalhista' },
]

export function Documentos({ documentosEmpresa = [], onRefresh }) {
  const { toast } = useToast()
  const [enviando, setEnviando] = useState(null)

  const getDoc = (tipo) => documentosEmpresa.find(d => d.tipo === tipo)

  async function handleUpload(tipo, file) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast('Arquivo muito grande (máx. 10MB).', 'error'); return }
    setEnviando(tipo)
    try {
      const ext = file.name.split('.').pop()
      const path = `${tipo}_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('documentos-empresa').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('documentos-empresa').getPublicUrl(path)
      const existente = getDoc(tipo)
      const payload = { tipo, nome_arquivo: file.name, url: pub.publicUrl, atualizado_em: new Date().toISOString() }
      if (existente) {
        const { error } = await supabase.from('documentos_empresa').update(payload).eq('id', existente.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('documentos_empresa').insert(payload)
        if (error) throw error
      }
      toast('Documento atualizado com sucesso!')
      onRefresh()
    } catch (e) {
      toast('Erro ao enviar: ' + e.message, 'error')
    }
    setEnviando(null)
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="card-header"><h3>📎 Documentos da empresa</h3></div>
        <div className="card-body">
          <p style={{ fontSize: 12, color: 'var(--n4)', marginBottom: 16, lineHeight: 1.5 }}>
            Esses documentos ficam disponíveis automaticamente pra download na página de faturamento de cada médico (o link que você já manda pra eles). Ao enviar um arquivo novo do mesmo tipo, ele substitui o anterior.
          </p>
          {TIPOS.map(t => {
            const doc = getDoc(t.key)
            const carregando = enviando === t.key
            return (
              <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
                  {doc ? (
                    <div style={{ fontSize: 11, color: 'var(--n5)', marginTop: 2 }}>
                      {doc.nome_arquivo} · atualizado em {new Date(doc.atualizado_em).toLocaleDateString('pt-BR')}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>⚠️ Nenhum arquivo enviado ainda</div>
                  )}
                </div>
                {doc && (
                  <a href={doc.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">👁️ Ver</a>
                )}
                <label className="btn btn-primary btn-sm" style={{ cursor: carregando ? 'default' : 'pointer', opacity: carregando ? 0.7 : 1 }}>
                  {carregando ? 'Enviando…' : (doc ? '⬆ Substituir' : '⬆ Enviar')}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                    onChange={e => handleUpload(t.key, e.target.files[0])} disabled={carregando} />
                </label>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

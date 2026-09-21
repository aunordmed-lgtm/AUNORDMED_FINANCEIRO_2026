import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { Modal } from '../components/Modal'

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
const fmtMes = m => {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  const ms = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${ms[+mo - 1]}/${y}`
}

const BASE_URL = 'https://aunordmed-app1.vercel.app'

export function Comunicacao({ notas = [], medicos = [], comprovantes = [], onRefresh }) {
  const { toast } = useToast()
  const [busca, setBusca] = useState('')
  const [modalMsg, setModalMsg] = useState(null) // { titulo, corpo, tel }
  const [carregando, setCarregando] = useState(null) // `${medicoId}-${acao}` enquanto processa

  const medicosOrdenados = useMemo(() =>
    [...medicos]
      .filter(m => !busca || m.nome?.toLowerCase().includes(busca.toLowerCase()) || m.crm?.toLowerCase().includes(busca.toLowerCase()))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  , [medicos, busca])

  // Última nota (por qualquer status) e último comprovante de pagamento, por médico —
  // usados pra habilitar/desabilitar os botões corretamente.
  const notasPorMedico = useMemo(() => {
    const m = {}
    notas.forEach(n => {
      ;(n.medicos_nota || []).forEach(mn => {
        if (!m[mn.nome]) m[mn.nome] = []
        m[mn.nome].push({ nota: n, mn })
      })
    })
    Object.values(m).forEach(arr => arr.sort((a, b) => (b.nota.criado_em || '').localeCompare(a.nota.criado_em || '')))
    return m
  }, [notas])

  const comprovantesPorMedico = useMemo(() => {
    const m = {}
    comprovantes.forEach(c => {
      if (c.tipo && c.tipo !== 'pagamento') return
      if (!m[c.medico_nome]) m[c.medico_nome] = []
      m[c.medico_nome].push(c)
    })
    Object.values(m).forEach(arr => arr.sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || '')))
    return m
  }, [comprovantes])

  function abrirModalMsg(titulo, corpo, tel) {
    setModalMsg({ titulo, corpo, tel })
  }

  function copiarModalMsg() {
    navigator.clipboard.writeText(modalMsg.corpo).then(() => toast('Mensagem copiada!')).catch(() => toast('Erro ao copiar.', 'error'))
  }

  function enviarModalMsgWhatsApp() {
    if (!modalMsg.tel) { toast('Médico sem WhatsApp cadastrado — use "Copiar".', 'error'); return }
    window.open(`https://wa.me/${modalMsg.tel.replace(/\D/g, '')}?text=${encodeURIComponent(modalMsg.corpo)}`, '_blank')
  }

  // ── 1) Link de faturamento (painel sempre atualizado) ──
  async function acaoFaturamento(med) {
    setCarregando(`${med.id}-fat`)
    try {
      let token = med.token_portal
      if (!token) {
        token = uid()
        const { error } = await supabase.from('medicos').update({ token_portal: token }).eq('id', med.id)
        if (error) throw error
        onRefresh?.()
      }
      const link = `${BASE_URL}/faturamento_medico.html?token=${token}`
      const corpo = `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${med.nome}*!\nSeu painel de faturamento está disponível, sempre atualizado.\n📄 Acesse:\n${link}\n\n_AunordMED — Gestão financeira médica_`
      abrirModalMsg('Link de faturamento', corpo, med.telefone_whatsapp || med.telefone)
    } catch (e) {
      toast('Erro ao gerar link: ' + e.message, 'error')
    }
    setCarregando(null)
  }

  // ── 2) Aviso de emissão (da nota mais recente do médico) ──
  async function acaoAvisoEmissao(med) {
    const ultima = notasPorMedico[med.nome]?.[0]
    if (!ultima) { toast('Esse médico ainda não tem nenhuma nota lançada.', 'error'); return }
    setCarregando(`${med.id}-emissao`)
    try {
      const { nota, mn } = ultima
      let token = null
      const existentes = await supabase.from('comprovantes').select('token').eq('nf_id', nota.id).eq('medico_nome', mn.nome).eq('tipo', 'emissao').limit(1)
      if (existentes?.data?.length) token = existentes.data[0].token
      else {
        token = uid()
        const { error } = await supabase.from('comprovantes').insert({
          token, nf_id: nota.id, medico_nome: mn.nome, tomador: nota.tomador,
          valor_repasse: mn.repasse || 0, competencia: nota.comp || null, tipo: 'emissao',
          dados_extras: { nf: nota.nf, bruto: mn.valor_bruto_medico || 0 },
        })
        if (error) throw error
      }
      const link = `${BASE_URL}/comprovante_emissao.html?token=${token}`
      const corpo = `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${mn.nome}*!\nSua nota fiscal *#${nota.nf || '—'}* foi *emitida*.\n🏢 *Tomador:* ${nota.tomador || '—'}\n📅 *Competência:* ${fmtMes(nota.comp)}\n💰 *Valor bruto:* R$ ${brl(mn.valor_bruto_medico || 0)}\n📄 Acesse:\n${link}\n\n_Este é só um aviso de emissão — o repasse ainda será processado e comunicado separadamente._\n_AunordMED — Gestão financeira médica_`
      abrirModalMsg(`Aviso de emissão — NF ${nota.nf}`, corpo, med.telefone_whatsapp || med.telefone)
    } catch (e) {
      toast('Erro ao gerar aviso: ' + e.message, 'error')
    }
    setCarregando(null)
  }

  // ── 3) Comprovante de pagamento mais recente já gerado ──
  function acaoComprovante(med) {
    const ultimo = comprovantesPorMedico[med.nome]?.[0]
    if (!ultimo) { toast('Esse médico ainda não tem nenhum comprovante de pagamento gerado (gere primeiro na aba Comprovantes).', 'error'); return }
    const link = `${BASE_URL}/comprovante.html?token=${ultimo.token}`
    const corpo = `🏥 *AunordMED Financeiro*\nOlá, Dr(a). *${med.nome}*!\nSegue o comprovante do seu repasse mais recente:\n📄 Acesse:\n${link}\n\n_AunordMED — Gestão financeira médica_`
    abrirModalMsg(`Comprovante — ${fmtMes(ultimo.competencia)}`, corpo, med.telefone_whatsapp || med.telefone)
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar">
          <span className="table-title">📣 Central de Comunicação</span>
          <input className="search-input" placeholder="🔍 Buscar médico ou CRM…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--n4)', padding: '0 20px 14px' }}>
          Todos os links e avisos que podem ser enviados a um médico, reunidos num só lugar. Cada botão copia a mensagem pronta ou já abre o WhatsApp.
        </p>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Médico</th><th>CRM</th><th style={{ textAlign: 'center' }}>Ações</th>
            </tr></thead>
            <tbody>
              {medicosOrdenados.length === 0 && (
                <tr><td colSpan={3}><div className="empty-state" style={{ padding: '1.5rem' }}><p>Nenhum médico encontrado.</p></div></td></tr>
              )}
              {medicosOrdenados.map(med => {
                const temNota = !!notasPorMedico[med.nome]?.length
                const temComprovante = !!comprovantesPorMedico[med.nome]?.length
                return (
                  <tr key={med.id}>
                    <td style={{ fontWeight: 600 }}>{med.nome}</td>
                    <td className="mono" style={{ color: 'var(--n5)' }}>{med.crm || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-xs" style={{ color: 'var(--g3)', borderColor: 'var(--g8)' }}
                          onClick={() => acaoFaturamento(med)} disabled={carregando === `${med.id}-fat`}>
                          📋 Faturamento
                        </button>
                        <button className="btn btn-outline btn-xs" style={{ color: '#25D366', borderColor: '#BBF7D0', opacity: temNota ? 1 : 0.4 }}
                          onClick={() => acaoAvisoEmissao(med)} disabled={!temNota || carregando === `${med.id}-emissao`}
                          title={temNota ? 'Aviso de emissão da nota mais recente' : 'Sem notas lançadas ainda'}>
                          📨 Aviso NF
                        </button>
                        <button className="btn btn-outline btn-xs" style={{ color: 'var(--blue)', borderColor: '#BFDBFE', opacity: temComprovante ? 1 : 0.4 }}
                          onClick={() => acaoComprovante(med)} disabled={!temComprovante}
                          title={temComprovante ? 'Comprovante de pagamento mais recente' : 'Nenhum comprovante gerado ainda'}>
                          🧾 Comprovante
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: copiar ou enviar por WhatsApp */}
      <Modal open={!!modalMsg} onClose={() => setModalMsg(null)} title={modalMsg?.titulo || ''}
        footer={<button className="btn btn-ghost" onClick={() => setModalMsg(null)}>Fechar</button>}>
        {modalMsg && (
          <>
            <div style={{ background: 'var(--n9)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 12.5, whiteSpace: 'pre-wrap', marginBottom: 14, maxHeight: 260, overflowY: 'auto' }}>
              {modalMsg.corpo}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={copiarModalMsg}>📋 Copiar</button>
              <button className="btn btn-primary" onClick={enviarModalMsgWhatsApp}>💬 WhatsApp</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

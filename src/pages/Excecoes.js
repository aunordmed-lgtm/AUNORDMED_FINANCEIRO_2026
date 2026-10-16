import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { registrarAuditoria, emailLogado } from '../lib/auditoria'
import { useToast } from '../components/Toast'
import { brl, fmtMes } from '../lib/helpers'
import { MOTIVOS_DIVERGENCIA, esperadoEfetivo, diferencaRecebimento, emExcecao } from '../lib/excecoes'

const fmtDia = d => (d ? d.split('T')[0].split('-').reverse().join('/') : '—')

export function Excecoes({ notas = [], onRefresh }) {
  const { toast } = useToast()
  const [aba, setAba] = useState('pendentes') // pendentes | justificadas | sem_data
  const [busca, setBusca] = useState('')
  const [fTomador, setFTomador] = useState('')
  const [rascunhos, setRascunhos] = useState({}) // id da nota -> { motivo, obs }
  const [datas, setDatas] = useState({})          // id da nota -> 'AAAA-MM-DD'
  const [salvando, setSalvando] = useState(null)

  const excecoes = useMemo(() => notas.filter(emExcecao), [notas])
  const pendentes = useMemo(() => excecoes.filter(n => !n.motivo_divergencia), [excecoes])
  const justificadas = useMemo(() => excecoes.filter(n => n.motivo_divergencia), [excecoes])
  // Notas que já entraram dinheiro mas sem a data exata: sem ela não dá pra medir o prazo médio.
  const semData = useMemo(() => notas.filter(n => n.status !== 'Emitida' && !n.data_recebimento), [notas])

  const tomadoresLista = useMemo(
    () => [...new Set(notas.map(n => n.tomador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [notas]
  )

  const listaAtiva = useMemo(() => {
    const base = aba === 'pendentes' ? pendentes : aba === 'justificadas' ? justificadas : semData
    return base
      .filter(n => !fTomador || n.tomador === fTomador)
      .filter(n => !busca || n.nf?.toLowerCase().includes(busca.toLowerCase()) || n.tomador?.toLowerCase().includes(busca.toLowerCase()))
      .sort((a, b) => (b.comp || '').localeCompare(a.comp || ''))
  }, [aba, pendentes, justificadas, semData, fTomador, busca])

  const somaDifPendentes = useMemo(() => pendentes.reduce((a, n) => a + (diferencaRecebimento(n) || 0), 0), [pendentes])

  const resumoPorMotivo = useMemo(() => {
    const m = {}
    justificadas.forEach(n => {
      const k = n.motivo_divergencia
      if (!m[k]) m[k] = { qtd: 0, soma: 0 }
      m[k].qtd++
      m[k].soma += diferencaRecebimento(n) || 0
    })
    return m
  }, [justificadas])

  const rascunhoDe = n => rascunhos[n.id] || { motivo: n.motivo_divergencia || '', obs: n.divergencia_obs || '' }
  const setRascunho = (n, campo, valor) => setRascunhos(r => ({ ...r, [n.id]: { ...rascunhoDe(n), [campo]: valor } }))

  async function registrarMotivo(n) {
    const r = rascunhoDe(n)
    if (!r.motivo) { toast('Escolha o motivo da divergência.', 'error'); return }
    if (r.motivo === 'outro' && !r.obs.trim()) { toast('Para "Outro", descreva o motivo na observação.', 'error'); return }
    setSalvando(n.id)
    try {
      const email = await emailLogado()
      const { error } = await supabase.from('notas_fiscais').update({
        motivo_divergencia: r.motivo, divergencia_obs: r.obs.trim() || null,
        divergencia_responsavel: email, divergencia_registrada_em: new Date().toISOString(),
      }).eq('id', n.id)
      if (error) throw error
      registrarAuditoria('divergencia_justificada', n.id, { nf: n.nf, motivo: r.motivo, diferenca: diferencaRecebimento(n) })
      setRascunhos(x => { const c = { ...x }; delete c[n.id]; return c })
      toast('Motivo registrado.')
      onRefresh?.()
    } catch (e) {
      toast('Erro ao registrar: ' + e.message, 'error')
    }
    setSalvando(null)
  }

  async function salvarDataRecebimento(n) {
    const d = datas[n.id]
    if (!d) { toast('Informe a data em que o tomador pagou.', 'error'); return }
    setSalvando(n.id)
    try {
      const { error } = await supabase.from('notas_fiscais').update({ data_recebimento: d }).eq('id', n.id)
      if (error) throw error
      registrarAuditoria('data_recebimento_informada', n.id, { nf: n.nf, data_recebimento: d })
      setDatas(x => { const c = { ...x }; delete c[n.id]; return c })
      toast('Data de recebimento salva.')
      onRefresh?.()
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'error')
    }
    setSalvando(null)
  }

  const tabBtn = (id, label, qtd) => (
    <button key={id} onClick={() => setAba(id)} className={`btn btn-xs ${aba === id ? 'btn-primary' : 'btn-ghost'}`}>
      {label} ({qtd})
    </button>
  )

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <span className="table-title">🚩 Exceções de recebimento</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tabBtn('pendentes', 'Sem motivo', pendentes.length)}
            {tabBtn('justificadas', 'Justificadas', justificadas.length)}
            {tabBtn('sem_data', 'Sem data de recebimento', semData.length)}
          </div>
          <select className="filter-select" value={fTomador} onChange={e => setFTomador(e.target.value)}>
            <option value="">Todos tomadores</option>
            {tomadoresLista.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="search-input" placeholder="🔍 Buscar NF ou tomador…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>

        <p style={{ fontSize: 12, color: 'var(--n4)', padding: '0 20px 12px', lineHeight: 1.5 }}>
          {aba === 'sem_data'
            ? 'Notas já recebidas que ainda não têm a data em que o tomador pagou. Sem essa data não dá para medir o prazo médio de recebimento de cada tomador.'
            : 'Entra aqui toda nota cujo valor recebido real difere do esperado (regras do tomador, ou o bruto menos 6,15% quando o tomador não tem regras). Notas sem diferença baixam sem passar por esta fila.'}
        </p>

        {aba === 'pendentes' && pendentes.length > 0 && (
          <div style={{ display: 'flex', gap: 10, padding: '0 20px 12px', flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>
              {pendentes.length} nota(s) sem motivo registrado
            </span>
            <span className="badge" style={{ background: somaDifPendentes < 0 ? '#FEF2F2' : '#EFF6FF', color: somaDifPendentes < 0 ? '#DC2626' : '#1D4ED8', border: '1px solid var(--border)' }}>
              Diferença acumulada: {somaDifPendentes >= 0 ? '+' : '-'}R$ {brl(Math.abs(somaDifPendentes))}
            </span>
          </div>
        )}

        {aba === 'justificadas' && Object.keys(resumoPorMotivo).length > 0 && (
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' }}>
            {Object.entries(resumoPorMotivo).map(([k, v]) => (
              <span key={k} className="badge" style={{ background: 'var(--n9)', color: 'var(--n3)', border: '1px solid var(--border)' }}>
                {MOTIVOS_DIVERGENCIA[k] || k}: {v.qtd} · {v.soma >= 0 ? '+' : '-'}R$ {brl(Math.abs(v.soma))}
              </span>
            ))}
          </div>
        )}

        <div className="table-wrap">
          {aba === 'sem_data' ? (
            <table>
              <thead><tr><th>NF</th><th>Tomador</th><th>Competência</th><th>Vencimento</th><th>Status</th><th>Data em que o tomador pagou</th><th></th></tr></thead>
              <tbody>
                {listaAtiva.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">✅</div><h4>Tudo preenchido</h4><p>Nenhuma nota recebida está sem data de recebimento.</p></div></td></tr>
                ) : listaAtiva.map(n => (
                  <tr key={n.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{n.nf || '—'}</td>
                    <td>{n.tomador || '—'}</td>
                    <td className="mono">{fmtMes(n.comp)}</td>
                    <td className="mono">{fmtDia(n.data_vencimento)}</td>
                    <td style={{ fontSize: 12 }}>{n.status}</td>
                    <td><input type="date" value={datas[n.id] || ''} onChange={e => setDatas(x => ({ ...x, [n.id]: e.target.value }))} style={{ height: 30, fontSize: 12 }} /></td>
                    <td><button className="btn btn-primary btn-xs" disabled={salvando === n.id} onClick={() => salvarDataRecebimento(n)}>{salvando === n.id ? '…' : 'Salvar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr>
                <th>NF</th><th>Tomador</th><th>Comp.</th>
                <th style={{ textAlign: 'right' }}>Esperado</th><th style={{ textAlign: 'right' }}>Recebido</th><th style={{ textAlign: 'right' }}>Diferença</th>
                <th>Motivo</th><th>Observação</th><th></th>
              </tr></thead>
              <tbody>
                {listaAtiva.length === 0 ? (
                  <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">{aba === 'pendentes' ? '✅' : '🚩'}</div>
                    <h4>{aba === 'pendentes' ? 'Nenhuma exceção sem motivo' : 'Nenhuma exceção justificada'}</h4>
                    <p>{aba === 'pendentes' ? 'Todas as diferenças de recebimento já têm motivo, ou não há diferenças.' : 'Ainda não há exceções com motivo registrado.'}</p></div></td></tr>
                ) : listaAtiva.map(n => {
                  const dif = diferencaRecebimento(n)
                  const r = rascunhoDe(n)
                  const mudou = aba === 'justificadas' ? (r.motivo !== (n.motivo_divergencia || '') || r.obs !== (n.divergencia_obs || '')) : true
                  return (
                    <tr key={n.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>{n.nf || '—'}</td>
                      <td style={{ maxWidth: 180 }}>{n.tomador || '—'}</td>
                      <td className="mono">{fmtMes(n.comp)}</td>
                      <td className="mono" style={{ textAlign: 'right' }} title={n.valor_esperado_recebimento != null ? 'Pelas regras do tomador' : 'Bruto menos 6,15% (tomador sem regras)'}>{brl(esperadoEfetivo(n))}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{brl(n.valor_recebido_real)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: dif < 0 ? '#DC2626' : '#1D4ED8' }}>{dif >= 0 ? '+' : '-'}{brl(Math.abs(dif))}</td>
                      <td>
                        <select value={r.motivo} onChange={e => setRascunho(n, 'motivo', e.target.value)} style={{ height: 30, fontSize: 12, minWidth: 170 }}>
                          <option value="">— escolha —</option>
                          {Object.entries(MOTIVOS_DIVERGENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="text" value={r.obs} onChange={e => setRascunho(n, 'obs', e.target.value)} placeholder={r.motivo === 'outro' ? 'Descreva o motivo (obrigatório)' : 'Detalhe (opcional)'} style={{ height: 30, fontSize: 12, minWidth: 200 }} />
                        {aba === 'justificadas' && n.divergencia_registrada_em && (
                          <div style={{ fontSize: 10, color: 'var(--n5)', marginTop: 2 }}>
                            {n.divergencia_responsavel || '—'} em {new Date(n.divergencia_registrada_em).toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-primary btn-xs" disabled={salvando === n.id || !mudou} onClick={() => registrarMotivo(n)}>
                          {salvando === n.id ? '…' : aba === 'pendentes' ? 'Registrar' : 'Atualizar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

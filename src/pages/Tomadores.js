import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl } from '../lib/helpers'

const BASES_PRAZO = {
  emissao: 'Data de emissão da nota',
  aceite: 'Aceite / aprovação da nota',
  recebimento: 'Recebimento da nota pelo tomador',
}

const FORM_VAZIO = {
  nome: '', cnpj: '', contato: '', email: '', telefone: '', obs: '', ativo: true,
  prazo_dias: '', base_prazo: 'emissao',
  retem_iss: 'nao', aliq_iss: '', municipio_iss: '',
  ret_outras_pct: '', ret_outras_desc: '',
  exige_aprovacao: false, contato_financeiro: '', canal_cobranca: '', clausulas: '',
}

const soDigitos = v => String(v || '').replace(/\D/g, '')

function textoPrazo(t) {
  if (!t.prazo_dias && t.prazo_dias !== 0) return '—'
  const base = { emissao: 'emissão', aceite: 'aceite', recebimento: 'recebimento' }[t.base_prazo || 'emissao']
  return `D+${t.prazo_dias} (${base})`
}

function textoIss(t) {
  if (t.retem_iss === 'sim') return t.aliq_iss ? `Retém ${Number(t.aliq_iss)}%` : 'Retém'
  if (t.retem_iss === 'depende') return 'Depende'
  return 'Não retém'
}

export function Tomadores({ tomadores = [], notas = [], onRefresh }) {
  const { toast } = useToast()
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Pontualidade por tomador, a partir da data em que o tomador de fato pagou
  // (data_recebimento). Nota ainda não recebida (status Emitida) e vencida conta como
  // atraso em aberto. Nota já recebida mas sem a data fica de fora do cálculo, porque
  // não dá para saber quando o tomador pagou.
  const resumoPorTomador = useMemo(() => {
    const hoje = new Date()
    const dia = v => new Date(v.split('T')[0] + 'T00:00:00')
    const m = {}
    notas.forEach(n => {
      if (!n.tomador) return
      if (!m[n.tomador]) m[n.tomador] = { qtd: 0, bruto: 0, atrasadas: 0, somaAtraso: 0, qtdPrazo: 0, somaPrazo: 0, semData: 0 }
      const r = m[n.tomador]
      r.qtd++
      r.bruto += n.bruto || 0
      // PMR: dias corridos entre a emissão e o recebimento
      if (n.emissao && n.data_recebimento) { r.qtdPrazo++; r.somaPrazo += Math.round((dia(n.data_recebimento) - dia(n.emissao)) / 86400000) }
      if (n.status !== 'Emitida' && !n.data_recebimento) r.semData++
      if (!n.data_vencimento) return
      const venc = dia(n.data_vencimento)
      let atraso = null
      if (n.data_recebimento) atraso = Math.round((dia(n.data_recebimento) - venc) / 86400000)
      else if (n.status === 'Emitida') atraso = Math.round((hoje - venc) / 86400000)
      if (atraso > 0) { r.atrasadas++; r.somaAtraso += atraso }
    })
    return m
  }, [notas])

  const lista = useMemo(() =>
    [...tomadores]
      .filter(t => !busca ||
        t.nome?.toLowerCase().includes(busca.toLowerCase()) ||
        (soDigitos(busca).length > 0 && soDigitos(t.cnpj).includes(soDigitos(busca))))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
  , [tomadores, busca])

  const abrir = (t = null) => {
    setEditando(t)
    setForm(t ? {
      ...FORM_VAZIO, ...t,
      prazo_dias: t.prazo_dias ?? '', aliq_iss: t.aliq_iss ?? '', ret_outras_pct: t.ret_outras_pct ?? '',
      base_prazo: t.base_prazo || 'emissao', retem_iss: t.retem_iss || 'nao',
      ativo: t.ativo !== false, exige_aprovacao: !!t.exige_aprovacao,
    } : FORM_VAZIO)
    setModalOpen(true)
  }

  const salvar = async () => {
    if (!form.nome.trim()) { toast('Informe o nome do tomador.', 'error'); return }
    // Filiais podem ter o mesmo nome, mas nunca o mesmo CNPJ.
    const cnpjNovo = soDigitos(form.cnpj)
    if (cnpjNovo) {
      const outro = tomadores.find(t => t.id !== editando?.id && soDigitos(t.cnpj) === cnpjNovo)
      if (outro) { toast(`Esse CNPJ já está cadastrado em "${outro.nome}".`, 'error'); return }
    }
    const num = v => (v === '' || v == null ? null : Number(v))
    const payload = {
      nome: form.nome.trim(), cnpj: form.cnpj.trim() || null, contato: form.contato || null,
      email: form.email || null, telefone: form.telefone || null, obs: form.obs || null, ativo: !!form.ativo,
      prazo_dias: num(form.prazo_dias), base_prazo: form.base_prazo,
      retem_iss: form.retem_iss, aliq_iss: form.retem_iss === 'sim' ? num(form.aliq_iss) : null,
      municipio_iss: form.municipio_iss || null,
      ret_outras_pct: num(form.ret_outras_pct), ret_outras_desc: form.ret_outras_desc || null,
      exige_aprovacao: !!form.exige_aprovacao, contato_financeiro: form.contato_financeiro || null,
      canal_cobranca: form.canal_cobranca || null, clausulas: form.clausulas || null,
    }
    setSalvando(true)
    try {
      const { error } = editando
        ? await supabase.from('tomadores').update(payload).eq('id', editando.id)
        : await supabase.from('tomadores').insert(payload)
      if (error) throw error
      toast(editando ? 'Tomador atualizado!' : 'Tomador cadastrado!')
      setModalOpen(false)
      onRefresh?.()
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'error')
    }
    setSalvando(false)
  }

  const excluir = async (t) => {
    const qtd = resumoPorTomador[t.nome]?.qtd || 0
    const aviso = qtd > 0 ? `\n\nAtenção: existem ${qtd} nota(s) lançadas com esse nome de tomador. Elas não serão apagadas.` : ''
    if (!window.confirm(`Excluir o tomador "${t.nome}"?${aviso}`)) return
    const { error } = await supabase.from('tomadores').delete().eq('id', t.id)
    if (error) { toast('Erro ao excluir: ' + error.message, 'error'); return }
    toast('Tomador removido.')
    onRefresh?.()
  }

  // "Tem regras" = pelo menos uma regra preenchida (prazo, retenção ou exigência de aprovação).
  const temRegras = t => t.prazo_dias != null || !!t.ret_outras_pct || t.retem_iss === 'sim' || t.retem_iss === 'depende' || !!t.exige_aprovacao
  const qtdSemRegras = tomadores.filter(t => !temRegras(t)).length

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <span className="table-title">Tomadores — cadastro mestre</span>
          {qtdSemRegras > 0 && (
            <span style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}
              title="Tomadores sem prazo, retenção ou exigência de aprovação preenchidos">
              {qtdSemRegras} sem regras preenchidas
            </span>
          )}
          <input className="search-input" placeholder="🔍 Buscar nome ou CNPJ…" value={busca} onChange={e => setBusca(e.target.value)} />
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => abrir()}>+ Novo tomador</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--n4)', padding: '0 20px 12px', lineHeight: 1.5 }}>
          As regras cadastradas aqui são aplicadas sozinhas ao lançar uma nota: o vencimento é calculado pelo prazo e o valor esperado de recebimento considera as retenções do tomador.
        </p>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Tomador</th><th>CNPJ</th><th>Prazo</th><th>ISS</th><th>Outras ret.</th>
              <th>Aprovação</th><th style={{ textAlign: 'center' }}>Notas</th><th>Atraso médio</th><th>PMR</th><th>Ações</th>
            </tr></thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">🏥</div><h4>Nenhum tomador</h4><p>Clique em "+ Novo tomador" para cadastrar</p></div></td></tr>
              ) : lista.map(t => {
                const r = resumoPorTomador[t.nome]
                const atrasoMedio = r?.atrasadas ? r.somaAtraso / r.atrasadas : 0
                const pmr = r?.qtdPrazo ? r.somaPrazo / r.qtdPrazo : null
                return (
                  <tr key={t.id} style={{ opacity: t.ativo === false ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 600 }}>
                      {t.nome}
                      {t.ativo === false && <span style={{ fontSize: 10, color: 'var(--n5)', marginLeft: 6 }}>(inativo)</span>}
                      {!temRegras(t) && <div style={{ fontSize: 10, color: '#D97706' }}>sem regras</div>}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{t.cnpj || '—'}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{textoPrazo(t)}</td>
                    <td style={{ fontSize: 12 }}>{textoIss(t)}{t.municipio_iss ? <div style={{ fontSize: 10, color: 'var(--n5)' }}>{t.municipio_iss}</div> : null}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{t.ret_outras_pct ? `${Number(t.ret_outras_pct)}%` : '—'}</td>
                    <td style={{ fontSize: 12 }}>{t.exige_aprovacao ? '🕒 Exige' : '—'}</td>
                    <td className="mono" style={{ textAlign: 'center' }} title={r ? `Bruto total: R$ ${brl(r.bruto)}` : ''}>{r?.qtd || 0}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: atrasoMedio > 30 ? '#DC2626' : atrasoMedio > 0 ? '#D97706' : 'var(--n5)', fontWeight: atrasoMedio > 0 ? 700 : 400 }}
                      title={r?.atrasadas ? `${r.atrasadas} nota(s) com atraso` : 'Sem atrasos registrados'}>
                      {atrasoMedio > 0 ? `${atrasoMedio.toFixed(0)} dia(s)` : '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}
                      title={r ? `Calculado com ${r.qtdPrazo} nota(s) que têm data de recebimento${r.semData ? `; ${r.semData} recebida(s) estão sem a data` : ''}` : ''}>
                      {pmr != null ? `${pmr.toFixed(0)} dia(s)` : '—'}
                    </td>
                    <td style={{ display: 'flex', gap: 4, paddingTop: 6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => abrir(t)}>✏️</button>
                      <button className="btn btn-danger btn-xs" onClick={() => excluir(t)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editando ? 'Ficha do tomador' : 'Novo tomador'} size="wide"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>}>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Identificação</div>
        <div className="form-grid">
          <div className="field form-full"><label>Nome *</label><input type="text" value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="Razão social ou nome fantasia" /></div>
          <div className="field"><label>CNPJ</label><input type="text" value={form.cnpj} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" /></div>
          <div className="field"><label>Situação</label>
            <select value={form.ativo ? '1' : '0'} onChange={e => set('ativo', e.target.value === '1')}>
              <option value="1">Ativo</option><option value="0">Inativo</option>
            </select>
          </div>
          <div className="field"><label>Contato</label><input type="text" value={form.contato} onChange={e => set('contato', e.target.value)} /></div>
          <div className="field"><label>Telefone</label><input type="text" value={form.telefone} onChange={e => set('telefone', e.target.value)} /></div>
          <div className="field form-full"><label>E-mail</label><input type="text" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g3)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '16px 0 8px' }}>Prazo de pagamento</div>
        <div className="form-grid">
          <div className="field"><label>Prazo (dias)</label>
            <input type="number" min="0" value={form.prazo_dias} onChange={e => set('prazo_dias', e.target.value)} placeholder="Ex.: 30" />
          </div>
          <div className="field"><label>Contado a partir de</label>
            <select value={form.base_prazo} onChange={e => set('base_prazo', e.target.value)}>
              {Object.entries(BASES_PRAZO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field form-full">
            <div style={{ fontSize: 11, color: 'var(--n5)' }}>
              O vencimento da nota só é calculado sozinho quando o prazo conta da <strong>emissão</strong>. Nos outros casos a data de aceite ou recebimento só é conhecida depois, então o vencimento continua manual.
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g3)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '16px 0 8px' }}>Retenções na fonte</div>
        <div className="form-grid">
          <div className="field"><label>Retém ISS?</label>
            <select value={form.retem_iss} onChange={e => set('retem_iss', e.target.value)}>
              <option value="nao">Não</option><option value="sim">Sim</option><option value="depende">Depende (conferir a cada nota)</option>
            </select>
          </div>
          <div className="field"><label>Alíquota de ISS retido (%)</label>
            <input type="number" step="0.01" min="0" value={form.aliq_iss} onChange={e => set('aliq_iss', e.target.value)}
              disabled={form.retem_iss !== 'sim'} placeholder="Ex.: 5" />
          </div>
          <div className="field"><label>Município de incidência do ISS</label>
            <input type="text" value={form.municipio_iss} onChange={e => set('municipio_iss', e.target.value)} placeholder="Ex.: Recife/PE" />
          </div>
          <div className="field"><label>Outras retenções (% somado)</label>
            <input type="number" step="0.01" min="0" value={form.ret_outras_pct} onChange={e => set('ret_outras_pct', e.target.value)} placeholder="IR, PIS, COFINS, CSLL, INSS" />
          </div>
          <div className="field form-full"><label>Quais outras retenções?</label>
            <input type="text" value={form.ret_outras_desc} onChange={e => set('ret_outras_desc', e.target.value)} placeholder="Ex.: IR 1,5% + CSLL 1% + PIS 0,65% + COFINS 3%" />
          </div>
          <div className="field form-full">
            <div style={{ fontSize: 11, color: 'var(--n5)' }}>
              Preencha só o que o tomador de fato retém na fonte. Com isso o sistema calcula o valor esperado de recebimento da nota (bruto menos as retenções). Sem nada preenchido, nenhum valor esperado é calculado.
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g3)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '16px 0 8px' }}>Cobrança e exigências</div>
        <div className="form-grid">
          <div className="field form-full">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.exige_aprovacao} onChange={e => set('exige_aprovacao', e.target.checked)} />
              Exige medição, relatório ou aprovação antes de pagar
            </label>
          </div>
          <div className="field"><label>Contato do financeiro</label><input type="text" value={form.contato_financeiro} onChange={e => set('contato_financeiro', e.target.value)} placeholder="Nome, e-mail ou telefone" /></div>
          <div className="field"><label>Canal de cobrança</label><input type="text" value={form.canal_cobranca} onChange={e => set('canal_cobranca', e.target.value)} placeholder="E-mail, portal, WhatsApp…" /></div>
          <div className="field form-full"><label>Cláusulas do contrato (multa, juros, glosa)</label>
            <textarea rows={3} value={form.clausulas} onChange={e => set('clausulas', e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div className="field form-full"><label>Observações</label><input type="text" value={form.obs} onChange={e => set('obs', e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  )
}

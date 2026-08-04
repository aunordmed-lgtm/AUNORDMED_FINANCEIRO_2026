import { useState, useMemo, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { brl, pct, fmtMes, uid } from '../lib/helpers'
import * as XLSX from 'xlsx'

const IMPOSTOS = 0.0615
const ALIQ_IR = 0.015
const ALIQ_CSLL = 0.01
const ALIQ_PIS = 0.0065
const ALIQ_COFINS = 0.03

function calcNota(bruto, medsSel) {
  const b = parseFloat(bruto) || 0
  const recebido = b * (1 - IMPOSTOS)
  const ir = b * ALIQ_IR
  const csll = b * ALIQ_CSLL
  const pis = b * ALIQ_PIS
  const cofins = b * ALIQ_COFINS
  let totalRepasse = 0
  const meds = medsSel.map(ms => {
    const ret = parseFloat(ms.ret) / 100
    const repasse = parseFloat(ms.valor || 0) * (1 - ret)
    totalRepasse += repasse
    return { ...ms, repasse }
  })
  const margem = recebido - totalRepasse
  return { bruto: b, recebido, totalRepasse, margem, pct_margem: recebido > 0 ? margem / recebido : 0, meds, ir, csll, pis, cofins }
}

export function Notas({ notas, medicos, onRefresh }) {
  const { toast } = useToast()
  const [aba, setAba] = useState('lista')
  const [modalOpen, setModalOpen] = useState(false)
  const [abaModal, setAbaModal] = useState('dados') // dados | importar
  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [fltStatus, setFltStatus] = useState('')
  const [fltComp, setFltComp] = useState('')
  const [fltTomador, setFltTomador] = useState('')
  const [sortKey, setSortKey] = useState('criado_em')
  const [sortDir, setSortDir] = useState('desc')
  const [medSel, setMedSel] = useState([])
  const [form, setForm] = useState({ nf: '', tomador: '', comp: '', mes_recebimento: '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
  // Importação Excel médicos
  const [importPreview, setImportPreview] = useState([])
  const [importErro, setImportErro] = useState('')
  const [importTotal, setImportTotal] = useState(0)
  const importRef = useRef()
  // Relatório
  const [relTipo, setRelTipo] = useState('mes')
  const [relMes, setRelMes] = useState(new Date().toISOString().substring(0, 7))
  const [relDe, setRelDe] = useState('')
  const [relAte, setRelAte] = useState('')
  const [prefillIds, setPrefillIds] = useState([])

  useEffect(() => {
    const raw = localStorage.getItem('aunordmed_prefill_nota')
    if (!raw) return
    try {
      const p = JSON.parse(raw)
      setEditando(null)
      setForm({ nf: '', tomador: p.tomador || '', comp: p.comp || '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
      setMedSel((p.medicos || []).map(m => ({ nome: m.nome, crm: '', ret: 13, valor: m.valor || '' })))
      setPrefillIds(p.solicitacaoIds || [])
      setAbaModal('dados')
      setImportPreview([])
      setImportErro('')
      setModalOpen(true)
    } catch {}
    localStorage.removeItem('aunordmed_prefill_nota')
  }, [])

  const medicosOrdenados = useMemo(() => [...medicos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [medicos])
  const comps = useMemo(() => [...new Set(notas.map(n => n.comp).filter(Boolean))].sort(), [notas])
  const tomadoresLista = useMemo(() => [...new Set(notas.map(n => n.tomador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [notas])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortArrow(key) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const filtradas = useMemo(() => {
    let f = notas.filter(n =>
      (!busca || n.nf?.toLowerCase().includes(busca.toLowerCase()) || n.tomador?.toLowerCase().includes(busca.toLowerCase())) &&
      (!fltStatus || n.status === fltStatus) &&
      (!fltComp || n.comp === fltComp) &&
      (!fltTomador || n.tomador === fltTomador)
    )
    f = [...f].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey]
      if (sortKey === 'nf') {
        // ordena numericamente quando possível (NFs são strings de números)
        const na = parseFloat(String(va || '').replace(/\D/g, '')) || 0
        const nb = parseFloat(String(vb || '').replace(/\D/g, '')) || 0
        return sortDir === 'asc' ? na - nb : nb - na
      }
      if (typeof va === 'string' || typeof vb === 'string') {
        va = va || ''; vb = vb || ''
        return sortDir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
      }
      va = va || 0; vb = vb || 0
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return f
  }, [notas, busca, fltStatus, fltComp, fltTomador, sortKey, sortDir])

  const notasRel = useMemo(() => {
    if (relTipo === 'todos') return notas
    if (relTipo === 'mes') return relMes ? notas.filter(n => n.comp === relMes) : notas
    return notas.filter(n => {
      if (!n.comp) return false
      if (relDe && n.comp < relDe) return false
      if (relAte && n.comp > relAte) return false
      return true
    })
  }, [notas, relTipo, relMes, relDe, relAte])

  const byComp = useMemo(() => {
    const m = {}
    notasRel.forEach(n => {
      const k = n.comp || 'S/D'
      if (!m[k]) m[k] = { comp: k, label: fmtMes(k), bruto: 0, recebido: 0, repasse: 0, margem: 0, count: 0 }
      m[k].bruto += n.bruto || 0
      m[k].recebido += n.recebido || 0
      m[k].repasse += n.total_repasse || 0
      m[k].margem += n.margem || 0
      m[k].count++
    })
    return Object.values(m).sort((a, b) => a.comp.localeCompare(b.comp))
  }, [notasRel])

  const totaisRel = useMemo(() => notasRel.reduce((a, n) => ({
    bruto: a.bruto + (n.bruto || 0),
    recebido: a.recebido + (n.recebido || 0),
    repasse: a.repasse + (n.total_repasse || 0),
    margem: a.margem + (n.margem || 0),
    count: a.count + 1
  }), { bruto: 0, recebido: 0, repasse: 0, margem: 0, count: 0 }), [notasRel])

  const v = calcNota(form.bruto, medSel)

  const abrirNova = () => {
    setEditando(null)
    setForm({ nf: '', tomador: '', comp: '', mes_recebimento: '', emissao: '', status: 'Emitida', obs: '', bruto: '' })
    setMedSel([])
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    setModalOpen(true)
  }

  const abrirEditar = (nota) => {
    setEditando(nota)
    setForm({ nf: nota.nf || '', tomador: nota.tomador || '', comp: nota.comp || '', mes_recebimento: nota.mes_recebimento || '', emissao: nota.emissao?.split('T')[0] || '', status: nota.status || 'Emitida', obs: nota.obs || '', bruto: nota.bruto || '' })
    setMedSel(nota.medicos_nota?.map(mn => ({ nome: mn.nome, crm: mn.crm || '', ret: mn.retencao_individual || 13, valor: mn.valor_bruto_medico || '' })) || [])
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    setModalOpen(true)
  }

  const adicionarMed = (nome) => {
    if (!nome) return
    if (medSel.find(m => m.nome === nome)) { toast('Médico já adicionado.', 'error'); return }
    const med = medicos.find(m => m.nome === nome)
    if (!med) return
    const brutoTotal = parseFloat(form.bruto) || 0
    const jaAlocado = medSel.reduce((a, m) => a + (parseFloat(m.valor) || 0), 0)
    const restante = brutoTotal - jaAlocado
    const valorSugerido = restante > 0 ? restante.toFixed(2) : ''
    setMedSel(prev => [...prev, { nome, crm: med?.crm || '', ret: med?.retencao || 13, valor: valorSugerido }])
  }

  // Importação Excel médicos
  const processarExcelMedicos = async (file) => {
    setImportErro('')
    setImportPreview([])
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (rows.length < 2) { setImportErro('Arquivo vazio.'); return }

      const header = rows[0].map(h => String(h).toLowerCase().trim())
      const colMed = header.findIndex(h => h.includes('médico') || h.includes('medico') || h.includes('nome'))
      const colVal = header.findIndex(h => h.includes('valor') || h.includes('subtotal') || h.includes('sub'))
      const colRet = header.findIndex(h => h.includes('reten') || h.includes('%'))

      if (colMed < 0 || colVal < 0) {
        setImportErro('Colunas não encontradas. O arquivo precisa ter colunas "Médico" e "Valor".')
        return
      }

      // Função de similaridade: compara primeiro e segundo nome
      const nomeSimilar = (nomeArquivo, nomeSistema) => {
        const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        const a = norm(nomeArquivo).split(' ').filter(Boolean)
        const b = norm(nomeSistema).split(' ').filter(Boolean)
        // Igual exato
        if (norm(nomeArquivo) === norm(nomeSistema)) return true
        // Primeiro e segundo nome batem
        if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1]) return true
        // Primeiro nome bate e último nome bate
        if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length-1] === b[b.length-1]) return true
        // Arquivo contém os dois primeiros nomes do sistema
        if (b.length >= 2 && a.includes(b[0]) && a.includes(b[1])) return true
        // Sistema contém os dois primeiros nomes do arquivo
        if (a.length >= 2 && b.includes(a[0]) && b.includes(a[1])) return true
        return false
      }

      const preview = []
      rows.slice(1).forEach(row => {
        if (!row.some(c => c !== '')) return
        const nomeMed = String(row[colMed] || '').trim()
        // Ignorar linha de total
        if (nomeMed.toUpperCase() === 'TOTAL' || nomeMed.toUpperCase() === 'TOTAL GERAL') return
        const valorStr = String(row[colVal] || '0').replace(/[R$\s.]/g, '').replace(',', '.')
        const valor = parseFloat(valorStr) || 0
        const ret = colRet >= 0 ? parseFloat(String(row[colRet] || '13').replace(',', '.')) || 13 : 13
        if (!nomeMed || valor <= 0) return

        // Buscar médico por similaridade (nome exato, primeiro+segundo nome, primeiro+último)
        const medCad = medicos.find(m => nomeSimilar(nomeMed, m.nome))
        preview.push({
          nome: nomeMed,
          nomeCadastrado: medCad?.nome || '',
          crm: medCad?.crm || '',
          ret,
          valor,
          encontrado: !!medCad,
          similar: !!medCad && medCad.nome.toLowerCase() !== nomeMed.toLowerCase()
        })
      })

      if (!preview.length) { setImportErro('Nenhum médico encontrado no arquivo.'); return }

      // Total é a SOMA dos individuais (ignora linha TOTAL do Excel)
      const total = preview.reduce((a, m) => a + m.valor, 0)
      setImportTotal(total)

      const bruto = parseFloat(form.bruto) || 0
      const diff = Math.abs(total - bruto)
      if (bruto > 0 && diff > 0.01) {
        setImportErro(`DIFERENÇA: Total importado R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ≠ Valor bruto da nota R$ ${bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — Diferença: R$ ${diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
      }

      setImportPreview(preview)
    } catch(e) { setImportErro('Erro ao ler arquivo: ' + e.message) }
  }

  const confirmarImport = () => {
    const novos = importMedPreview => importMedPreview.map(m => ({
      nome: m.nomeCadastrado || m.nome, crm: m.crm || '', ret: m.ret, valor: String(m.valor)
    }))
    setMedSel(novos(importPreview))
    setAbaModal('dados')
    setImportPreview([])
    setImportErro('')
    toast(`${importPreview.length} médico(s) importado(s)!`)
  }

  const salvar = async () => {
    if (!form.nf || !form.tomador || !form.bruto) { toast('Preencha NF, tomador e valor bruto.', 'error'); return }
    if (medSel.length > 0) {
      const soma = medSel.reduce((a, m) => a + (parseFloat(m.valor) || 0), 0)
      if (Math.abs(soma - parseFloat(form.bruto)) > 0.01) { toast('Soma dos valores deve ser igual ao bruto.', 'error'); return }
    }
    const calc = calcNota(form.bruto, medSel)
    const medicos_nota = medSel.length ? medSel.map(ms => ({
      nome: ms.nome, crm: ms.crm || '',
      valor_bruto_medico: parseFloat(ms.valor) || 0,
      retencao_individual: parseFloat(ms.ret) || 13,
      repasse: parseFloat(ms.valor || 0) * (1 - parseFloat(ms.ret || 13) / 100)
    })) : []
    const payload = {
      ...form, bruto: calc.bruto, recebido: calc.recebido, total_repasse: calc.totalRepasse,
      margem: calc.margem, pct_margem: calc.pct_margem,
      ir: calc.ir, csll: calc.csll, pis: calc.pis, cofins: calc.cofins,
      mes_recebimento: form.mes_recebimento || null,
      medicos_nota: medicos_nota.length ? medicos_nota : null, nomes_medicos: medSel.map(m => m.nome).join(', ') || null
    }
    setLoading(true)
    try {
      if (editando) {
        const { error } = await supabase.from('notas_fiscais').update(payload).eq('id', editando.id)
        if (error) throw error
        toast('Nota atualizada!')
      } else {
        const { data: nova, error } = await supabase.from('notas_fiscais').insert(payload).select().single()
        if (error) throw error
        for (const ms of medSel) {
          const med = medicos.find(m => m.nome === ms.nome)
          const repMed = parseFloat(ms.valor || 0) * (1 - parseFloat(ms.ret || 13) / 100)
          try {
            await supabase.from('comprovantes').insert({ token: uid(), nf_id: nova?.id, medico_nome: ms.nome, medico_crm: med?.crm || null, tomador: form.tomador, valor_repasse: repMed, competencia: form.comp || null, dados_extras: { nf: form.nf, pix: med?.chave_pix } })
          } catch (e) {}
        }
        if (prefillIds.length) {
          try {
            await supabase.from('solicitacoes_medicos').update({ status: 'Nota emitida', nota_fiscal_id: nova?.id }).in('id', prefillIds)
          } catch (e) {}
          setPrefillIds([])
        }
        toast('Nota adicionada!')
      }
      setModalOpen(false)
      onRefresh()
    } catch(e) { toast('Erro ao salvar: ' + e.message, 'error') }
    setLoading(false)
  }

  const excluir = async (id) => {
    if (!window.confirm('Excluir esta nota?')) return
    await supabase.from('notas_fiscais').delete().eq('id', id)
    toast('Nota removida.')
    onRefresh()
  }

  const alterarStatus = async (id, status) => {
    await supabase.from('notas_fiscais').update({ status }).eq('id', id)
    onRefresh()
  }

  const gerarComprovante = async (nota) => {
    if (!nota.medicos_nota?.length) { toast('Esta nota não tem médicos vinculados.', 'error'); return }
    setLoading(true)
    let gerados = 0
    for (const mn of nota.medicos_nota) {
      try {
        const med = medicos.find(m => m.nome === mn.nome)
        const repasse = mn.repasse || (mn.valor_bruto_medico * (1 - (mn.retencao_individual || 13) / 100))
        // Verificar se já existe comprovante para essa nota + médico
        const { data: exist } = await supabase.from('comprovantes').select('id').eq('nf_id', nota.id).eq('medico_nome', mn.nome).maybeSingle()
        if (exist) { toast(`Comprovante de ${mn.nome} já existe.`, 'error'); continue }
        await supabase.from('comprovantes').insert({
          token: uid(),
          nf_id: nota.id,
          medico_nome: mn.nome,
          medico_crm: mn.crm || med?.crm || null,
          tomador: nota.tomador,
          valor_repasse: repasse,
          competencia: nota.comp || null,
          dados_extras: { nf: nota.nf, pix: med?.chave_pix, tipo_pix: med?.tipo_pix }
        })
        gerados++
      } catch(e) {}
    }
    setLoading(false)
    if (gerados > 0) { toast(`${gerados} comprovante(s) gerado(s) com sucesso!`); onRefresh() }
  }

  const exportarRelatorio = () => {
    const rows = [['NF','Tomador','Médicos','Competência','Bruto','Recebido','Repasse','Margem','% Margem','Status']]
    notasRel.forEach(n => rows.push([n.nf, n.tomador, n.nomes_medicos, fmtMes(n.comp), +(n.bruto||0).toFixed(2), +(n.recebido||0).toFixed(2), +(n.total_repasse||0).toFixed(2), +(n.margem||0).toFixed(2), +((n.pct_margem||0)*100).toFixed(2)+'%', n.status]))
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Notas')
    XLSX.writeFile(wb, `notas_${relMes || 'periodo'}.xlsx`)
    toast('Excel exportado!')
  }

  const brutoNum = parseFloat(form.bruto) || 0
  const diffImport = Math.abs(importTotal - brutoNum)
  const importOk = brutoNum > 0 && importPreview.length > 0 && diffImport <= 0.01

  return (
    <div className="page-content">
      <style>{`
        .med-hover-wrap { position: relative; }
        .med-hover-tooltip {
          display: none;
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          z-index: 999;
          background: var(--n1);
          color: #fff;
          border-radius: var(--radius-lg);
          padding: 8px 12px;
          min-width: 220px;
          max-width: 320px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25);
          white-space: nowrap;
          line-height: 1.8;
        }
        .med-hover-wrap:hover .med-hover-tooltip { display: block; }
      `}</style>
      {/* Abas principais */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        {[['lista','📄 Notas fiscais'],['relatorio','📊 Relatório por período']].map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)} style={{ padding: '8px 18px', border: 'none', borderBottom: aba===id?'2px solid var(--g5)':'2px solid transparent', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: aba===id?600:400, color: aba===id?'var(--g3)':'var(--n5)', fontFamily: 'var(--sans)' }}>
            {label}
          </button>
        ))}
        {aba === 'lista' && <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={abrirNova}>+ Nova nota</button>}
      </div>

      {/* ABA LISTA */}
      {aba === 'lista' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-title">Notas fiscais</span>
            <input className="search-input" placeholder="🔍 Buscar NF ou tomador…" value={busca} onChange={e => setBusca(e.target.value)} />
            <select className="filter-select" value={fltStatus} onChange={e => setFltStatus(e.target.value)}>
              <option value="">Todos status</option>
              <option value="Emitida">Emitida</option>
              <option value="Recebida">Recebida</option>
              <option value="Paga ao médico">Paga ao médico</option>
            </select>
            <select className="filter-select" value={fltComp} onChange={e => setFltComp(e.target.value)}>
              <option value="">Competências</option>
              {comps.map(c => <option key={c} value={c}>{fmtMes(c)}</option>)}
            </select>
            <select className="filter-select" value={fltTomador} onChange={e => setFltTomador(e.target.value)}>
              <option value="">Todos tomadores</option>
              {tomadoresLista.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>#</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('nf')}>Nº NF{sortArrow('nf')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('tomador')}>Tomador{sortArrow('tomador')}</th>
                <th>Médicos</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('comp')}>Competência{sortArrow('comp')}</th>
                <th>Receb.</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('bruto')}>Bruto{sortArrow('bruto')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('recebido')}>Recebido{sortArrow('recebido')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('total_repasse')}>Repasse{sortArrow('total_repasse')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('margem')}>Margem{sortArrow('margem')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
                <th>Ações</th>
              </tr></thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={12}><div className="empty-state"><div className="empty-icon">📄</div><h4>Nenhuma nota</h4><p>Clique em "+ Nova nota" para registrar</p></div></td></tr>
                ) : filtradas.map((n, i) => (
                  <tr key={n.id}>
                    <td className="mono" style={{ color:'var(--n6)' }}>{i+1}</td>
                    <td className="mono" style={{ fontWeight:600 }}>{n.nf||'—'}</td>
                    <td>{n.tomador||'—'}</td>
                    <td style={{ maxWidth:200 }}>
                      {(() => {
                        const meds = n.medicos_nota || (n.nomes_medicos ? n.nomes_medicos.split(',').map(s => ({ nome: s.trim() })) : [])
                        if (!meds.length) return '—'
                        const primeiro = meds[0].nome
                        const todos = meds.map(m => m.nome).join('\n')
                        const count = meds.length
                        return (
                          <div style={{ position:'relative', display:'inline-block' }} className="med-hover-wrap">
                            <span className="tag" style={{ cursor: count > 1 ? 'help' : 'default', display:'flex', alignItems:'center', gap:4 }}>
                              {primeiro}
                              {count > 1 && <span style={{ background:'var(--g5)', color:'#fff', borderRadius:99, fontSize:9, fontWeight:700, padding:'1px 5px', flexShrink:0 }}>+{count-1}</span>}
                            </span>
                            {count > 1 && (
                              <div className="med-hover-tooltip">
                                {meds.map((m, i) => (
                                  <div key={i} style={{ padding:'3px 0', borderBottom: i < meds.length-1 ? '1px solid rgba(255,255,255,.1)' : 'none', fontSize:11 }}>
                                    {m.nome}
                                    {m.valor_bruto_medico > 0 && <span style={{ float:'right', opacity:.7, marginLeft:8, fontFamily:'var(--mono)' }}>R$ {Number(m.valor_bruto_medico).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="mono">{fmtMes(n.comp)}</td>
                    <td className="mono">
                      {n.mes_recebimento
                        ? <span style={{ color: n.mes_recebimento !== n.comp ? 'var(--orange, #D97706)' : 'inherit', fontWeight: n.mes_recebimento !== n.comp ? 700 : 400 }} title={n.mes_recebimento !== n.comp ? 'Recebido em mês diferente da competência de emissão' : ''}>
                            {fmtMes(n.mes_recebimento)}
                          </span>
                        : <span style={{ color: 'var(--n6)' }}>—</span>}
                    </td>
                    <td className="mono" style={{ fontWeight:600 }}>{brl(n.bruto)}</td>
                    <td className="mono" style={{ color:'var(--blue)' }}>{brl(n.recebido)}</td>
                    <td className="mono" style={{ color:'var(--n4)' }}>{brl(n.total_repasse||0)}</td>
                    <td className="mono" style={{ color:'var(--g3)', fontWeight:600 }}>{brl(n.margem)}</td>
                    <td>
                      <select style={{ height:26, fontSize:11, width:130, border:'1px solid var(--border)', borderRadius:6, padding:'0 6px', fontFamily:'var(--sans)' }}
                        value={n.status} onChange={e => alterarStatus(n.id, e.target.value)}>
                        <option value="Emitida">Emitida</option>
                        <option value="Recebida">Recebida</option>
                        <option value="Paga ao médico">Paga ao médico</option>
                      </select>
                    </td>
                    <td style={{ display:'flex', gap:4, paddingTop:6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => abrirEditar(n)}>✏️</button>
                      <button className="btn btn-outline btn-xs" style={{ fontSize:10, color:'var(--g3)', borderColor:'var(--g8)' }}
                        onClick={() => gerarComprovante(n)} title="Gerar comprovante para os médicos vinculados">🧾</button>
                      <button className="btn btn-danger btn-xs" onClick={() => excluir(n.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA RELATÓRIO */}
      {aba === 'relatorio' && (
        <>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-body">
              <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                <div className="field"><label>Período</label>
                  <select style={{ height:36 }} value={relTipo} onChange={e => setRelTipo(e.target.value)}>
                    <option value="mes">Mês específico</option>
                    <option value="intervalo">Intervalo</option>
                    <option value="todos">Todos</option>
                  </select>
                </div>
                {relTipo==='mes' && <div className="field"><label>Mês/Ano</label><input type="month" style={{ height:36 }} value={relMes} onChange={e => setRelMes(e.target.value)}/></div>}
                {relTipo==='intervalo' && <>
                  <div className="field"><label>De</label><input type="month" style={{ height:36 }} value={relDe} onChange={e => setRelDe(e.target.value)}/></div>
                  <div className="field"><label>Até</label><input type="month" style={{ height:36 }} value={relAte} onChange={e => setRelAte(e.target.value)}/></div>
                </>}
                <button className="btn btn-ghost btn-sm" onClick={exportarRelatorio}>⬇ Exportar Excel</button>
              </div>
            </div>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', marginBottom:14 }}>
            {[
              { bar:'var(--g5)', ic:'var(--g10)', icon:'📄', label:'Notas', value:totaisRel.count },
              { bar:'var(--g5)', ic:'var(--g10)', icon:'💰', label:'Total bruto', value:brl(totaisRel.bruto) },
              { bar:'var(--blue)', ic:'var(--blue-l)', icon:'📥', label:'Recebido', value:brl(totaisRel.recebido), sub:'Após impostos' },
              { bar:'var(--g5)', ic:'var(--g10)', icon:'📈', label:'Margem', value:brl(totaisRel.margem), sub:totaisRel.recebido>0?pct(totaisRel.margem/totaisRel.recebido):'—' },
            ].map((k,i) => (
              <div key={i} className="kpi">
                <div className="kpi-bar" style={{ background:k.bar }}/>
                <div className="kpi-icon" style={{ background:k.ic }}>{k.icon}</div>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value">{k.value}</div>
                {k.sub && <div className="kpi-sub">{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-header"><h3>📅 Emitido por mês</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Competência</th><th style={{textAlign:'right'}}>NFs</th><th style={{textAlign:'right'}}>Bruto</th><th style={{textAlign:'right'}}>Recebido</th><th style={{textAlign:'right'}}>Repasse</th><th style={{textAlign:'right'}}>Margem</th><th style={{textAlign:'right'}}>% Margem</th>
                </tr></thead>
                <tbody>
                  {byComp.length===0 ? <tr><td colSpan={7}><div className="empty-state" style={{padding:'1.5rem'}}><p>Nenhuma nota no período</p></div></td></tr>
                  : byComp.map((m,i) => (
                    <tr key={m.comp} style={{ background:i%2===0?'#fff':'var(--n10)' }}>
                      <td style={{ fontWeight:600 }}>{m.label}</td>
                      <td className="mono" style={{textAlign:'right'}}>{m.count}</td>
                      <td className="mono" style={{textAlign:'right',fontWeight:600}}>{brl(m.bruto)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--blue)'}}>{brl(m.recebido)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--n4)'}}>{brl(m.repasse)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--g3)',fontWeight:700}}>{brl(m.margem)}</td>
                      <td className="mono" style={{textAlign:'right'}}>{m.recebido>0?pct(m.margem/m.recebido):'—'}</td>
                    </tr>
                  ))}
                  {byComp.length>0 && <tr style={{background:'var(--g1)'}}>
                    <td style={{fontWeight:700,color:'#fff'}}>TOTAL</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{totaisRel.count}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.bruto)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.recebido)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.85)'}}>{brl(totaisRel.repasse)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'var(--g7)'}}>{brl(totaisRel.margem)}</td>
                    <td className="mono" style={{textAlign:'right',fontWeight:700,color:'var(--g7)'}}>{totaisRel.recebido>0?pct(totaisRel.margem/totaisRel.recebido):'—'}</td>
                  </tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>📋 Notas no período</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>NF</th><th>Tomador</th><th>Médicos</th><th>Competência</th><th style={{textAlign:'right'}}>Bruto</th><th style={{textAlign:'right'}}>Recebido</th><th style={{textAlign:'right'}}>Margem</th><th>Status</th></tr></thead>
                <tbody>
                  {notasRel.length===0 ? <tr><td colSpan={8}><div className="empty-state" style={{padding:'1.5rem'}}><p>Nenhuma nota no período</p></div></td></tr>
                  : notasRel.map(n => (
                    <tr key={n.id}>
                      <td className="mono" style={{fontWeight:600}}>{n.nf||'—'}</td>
                      <td>{n.tomador||'—'}</td>
                      <td style={{fontSize:11}}>{n.nomes_medicos||'—'}</td>
                      <td className="mono">{fmtMes(n.comp)}</td>
                      <td className="mono" style={{textAlign:'right',fontWeight:600}}>{brl(n.bruto)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--blue)'}}>{brl(n.recebido)}</td>
                      <td className="mono" style={{textAlign:'right',color:'var(--g3)',fontWeight:600}}>{brl(n.margem)}</td>
                      <td><span className={`badge ${n.status==='Paga ao médico'?'badge-ok':n.status==='Recebida'?'badge-rec':'badge-emit'}`}>{n.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* MODAL NOTA */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editando ? 'Editar nota fiscal' : 'Nova nota fiscal'} size="wide"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={loading}>
            {loading ? <><span className="spinner spinner-sm"/> Salvando…</> : 'Salvar nota'}
          </button>
        </>}>

        {/* Sub-abas do modal */}
        <div style={{ display:'flex', gap:2, marginBottom:16, borderBottom:'1px solid var(--border)' }}>
          {[['dados','📋 Dados da nota'],['importar','📊 Importar médicos (Excel)']].map(([id,label]) => (
            <button key={id} onClick={() => setAbaModal(id)} style={{ padding:'7px 16px', border:'none', borderBottom:abaModal===id?'2px solid var(--g5)':'2px solid transparent', background:'none', cursor:'pointer', fontSize:12, fontWeight:abaModal===id?600:400, color:abaModal===id?'var(--g3)':'var(--n5)', fontFamily:'var(--sans)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ABA DADOS */}
        {abaModal === 'dados' && (
          <>
            <div className="form-grid">
              {[['nf','Nº da NF *','text','00001'],['tomador','Tomador *','text','Unimed…'],['comp','Competência (emissão)','month',''],['mes_recebimento','Mês de recebimento','month',''],['emissao','Data emissão','date',''],['obs','Observações','text','']].map(([k,l,t,p]) => (
                <div key={k} className="field">
                  <label>{l}</label>
                  <input type={t} value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} placeholder={p}/>
                </div>
              ))}
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                  <option value="Emitida">Emitida</option>
                  <option value="Recebida">Recebida</option>
                  <option value="Paga ao médico">Paga ao médico</option>
                </select>
              </div>
              <div className="field form-full">
                <label>Valor bruto total (R$) *</label>
                <input type="number" className="inp-money" value={form.bruto} onChange={e => setForm(f=>({...f,bruto:e.target.value}))} placeholder="0,00" min="0" step="0.01"/>
              </div>
            </div>

            <div style={{ marginTop:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <label style={{ fontSize:10, fontWeight:700, color:'var(--n4)', textTransform:'uppercase', letterSpacing:.4 }}>Médicos vinculados</label>
                <button type="button" className="btn btn-outline btn-xs" onClick={() => setAbaModal('importar')}>📊 Importar via Excel</button>
              </div>
              <div className="med-picker">
                <div className="med-picker-header">
                  <span>Médico</span>
                  <div style={{ display:'flex', gap:36, fontSize:10, color:'var(--n5)' }}>
                    <span style={{ width:100, textAlign:'center' }}>Valor (R$)</span>
                    <span style={{ width:100, textAlign:'center' }}>% Retenção</span>
                    <span style={{ width:30 }}></span>
                  </div>
                </div>
                <div className="med-picker-list">
                  {medSel.length===0 && <div style={{ padding:12, textAlign:'center', color:'var(--n6)', fontSize:11 }}>Nenhum médico adicionado</div>}
                  {medSel.map((ms,i) => (
                    <div key={i} className="med-picker-row">
                      <div>
                        <div style={{ fontWeight:500, fontSize:12 }}>{ms.nome}</div>
                        <div style={{ fontSize:10, color:'var(--n5)' }}>{ms.crm}</div>
                      </div>
                      <input type="number" value={ms.valor} placeholder="0,00" min="0" step="0.01"
                        style={{ height:28, fontSize:12, fontFamily:'var(--mono)', textAlign:'right', padding:'0 6px', border:'1px solid var(--border)', borderRadius:6 }}
                        onChange={e => setMedSel(prev => prev.map((m,j) => j===i?{...m,valor:e.target.value}:m))}/>
                      <input type="number" value={ms.ret} min="0" max="100" step="0.01"
                        style={{ height:28, fontSize:12, fontFamily:'var(--mono)', textAlign:'right', padding:'0 6px', border:'1px solid var(--border)', borderRadius:6 }}
                        onChange={e => setMedSel(prev => prev.map((m,j) => j===i?{...m,ret:e.target.value}:m))}/>
                      <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--n5)', fontSize:14 }}
                        onClick={() => setMedSel(prev => prev.filter((_,j) => j!==i))}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="med-picker-add">
                  <input type="text" list="med-datalist" placeholder="🔍 Digite o nome do médico para adicionar..." id="med-search-input" autoComplete="off"
                    style={{ height:34, fontSize:12, width:'100%', border:'1px solid var(--border)', borderRadius:6, padding:'0 10px', background:'var(--n10)', fontFamily:'var(--sans)' }}
                    onChange={e => {
                      const nome = e.target.value.trim()
                      const med = medicosOrdenados.find(m => m.nome===nome)
                      if (med) { adicionarMed(nome); setTimeout(() => { const el=document.getElementById('med-search-input'); if(el) el.value='' }, 50) }
                    }}/>
                  <datalist id="med-datalist">
                    {medicosOrdenados.map(m => <option key={m.id} value={m.nome}>{m.crm?`${m.nome} (${m.crm})`:m.nome}</option>)}
                  </datalist>
                </div>
                {medSel.length>0 && form.bruto && Math.abs(medSel.reduce((a,m)=>a+(parseFloat(m.valor)||0),0)-parseFloat(form.bruto))>0.01 && (
                  <div className="pct-warn">⚠️ Soma dos valores deve ser igual ao valor bruto total</div>
                )}
              </div>
            </div>

            <div className="computed-row">
              <div className="computed-box blue"><div className="computed-label">Recebido (−6,15%)</div><div className="computed-value">{brl(v.recebido)}</div></div>
              <div className="computed-box"><div className="computed-label">Total repasse</div><div className="computed-value">{brl(v.totalRepasse)}</div></div>
              <div className="computed-box highlight"><div className="computed-label">Margem empresa</div><div className="computed-value">{brl(v.margem)}</div></div>
              <div className="computed-box"><div className="computed-label">% Margem</div><div className="computed-value">{pct(v.pct_margem)}</div></div>
            </div>

            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--n4)', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>
                Retenções federais (detalhamento dos 6,15%)
              </div>
              <div className="computed-row">
                <div className="computed-box"><div className="computed-label">IR (1,5%)</div><div className="computed-value">{brl(v.ir)}</div></div>
                <div className="computed-box"><div className="computed-label">CSLL (1%)</div><div className="computed-value">{brl(v.csll)}</div></div>
                <div className="computed-box"><div className="computed-label">PIS (0,65%)</div><div className="computed-value">{brl(v.pis)}</div></div>
                <div className="computed-box"><div className="computed-label">COFINS (3%)</div><div className="computed-value">{brl(v.cofins)}</div></div>
              </div>
            </div>
          </>
        )}

        {/* ABA IMPORTAR EXCEL */}
        {abaModal === 'importar' && (
          <div>
            <div style={{ background:'var(--g10)', border:'1px solid var(--g8)', borderRadius:'var(--radius-lg)', padding:'12px 16px', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--g2)', marginBottom:6 }}>📊 Importar médicos de planilha Excel</div>
              <div style={{ fontSize:12, color:'var(--n4)', lineHeight:1.6 }}>
                O arquivo deve ter colunas: <strong>Médico</strong> (nome), <strong>Valor</strong> (subtotal) e opcionalmente <strong>Retenção %</strong>.
                O sistema verifica se o total importado é igual ao valor bruto da nota (<strong>{brl(brutoNum)}</strong>).
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginBottom:14 }}>
              <button className="btn btn-primary" onClick={() => importRef.current?.click()}>📂 Selecionar arquivo Excel</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const ws = XLSX.utils.aoa_to_sheet([['Médico','Valor','Retenção %'],['Dr. Nome Completo','1250.00','13'],['Dra. Outra Médica','2000.00','13']])
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Médicos'); XLSX.writeFile(wb, 'modelo_medicos.xlsx'); toast('Modelo baixado!')
              }}>⬇ Baixar modelo</button>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={e => { if(e.target.files[0]) processarExcelMedicos(e.target.files[0]) }}/>
            </div>

            {/* Resultado da importação */}
            {importErro && (
              <div style={{ background: importErro.includes('DIFERENÇA') ? 'var(--yellow-l)' : 'var(--red-l)', border: `1px solid ${importErro.includes('DIFERENÇA')?'#FDE68A':'#FCA5A5'}`, borderRadius:'var(--radius-lg)', padding:'12px 16px', marginBottom:12, fontSize:12, fontWeight:600, color: importErro.includes('DIFERENÇA')?'#92400E':'var(--red-d)' }}>
                {importErro.includes('DIFERENÇA') ? '⚠️' : '❌'} {importErro}
              </div>
            )}

            {importPreview.length > 0 && (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--n2)' }}>{importPreview.length} médico(s) encontrado(s) no arquivo</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:12 }}>
                    <span>Total importado: <strong style={{ color: importOk?'var(--g3)':'var(--red)' }}>{brl(importTotal)}</strong></span>
                    <span>Valor bruto da nota: <strong>{brl(brutoNum)}</strong></span>
                    {importOk && <span style={{ background:'var(--g10)', color:'var(--g3)', border:'1px solid var(--g8)', borderRadius:99, padding:'2px 10px', fontSize:11, fontWeight:700 }}>✓ Valores batem!</span>}
                  </div>
                </div>
                <div className="table-wrap" style={{ marginBottom:14 }}>
                  <table>
                    <thead><tr>
                      <th>Nome no arquivo</th><th>Médico no sistema</th><th>CRM</th><th style={{textAlign:'right'}}>Valor</th><th style={{textAlign:'center'}}>Ret %</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {importPreview.map((m,i) => (
                        <tr key={i} style={{ background: !m.encontrado?'#FFFBEB':i%2===0?'#fff':'var(--n10)' }}>
                          <td style={{ fontSize:12 }}>{m.nome}</td>
                          <td style={{ fontSize:12, fontWeight:500, color:m.encontrado?'var(--g3)':'var(--orange-d)' }}>
                            {m.encontrado ? (m.similar ? `${m.nomeCadastrado} ↩` : m.nomeCadastrado) : '⚠️ Não cadastrado'}
                          </td>
                          <td style={{ fontSize:11, color:'var(--n5)' }}>{m.crm||'—'}</td>
                          <td className="mono" style={{ textAlign:'right', fontWeight:600 }}>{brl(m.valor)}</td>
                          <td className="mono" style={{ textAlign:'center' }}>{m.ret}%</td>
                          <td>{m.encontrado ? <span className="badge badge-ok">✓ OK</span> : <span className="badge badge-emit">Não cadastrado</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button className="btn btn-primary" onClick={confirmarImport}>
                    ✓ Confirmar e aplicar médicos
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setImportPreview([]); setImportErro('') }}>Limpar</button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

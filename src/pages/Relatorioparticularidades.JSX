import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

const CATEGORIAS = {
  acordo_verbal: '🤝 Acordo verbal',
  erro_terceiros: '⚠️ Erro de terceiros',
  excecao_fiscal: '🧾 Exceção fiscal',
  atraso_justificado: '⏱️ Atraso justificado',
  ajuste_manual: '✏️ Ajuste manual',
  outro: '📌 Outro',
}

const fmtDataHora = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function RelatorioParticularidades() {
  const { toast } = useToast()
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [modoPeriodo, setModoPeriodo] = useState('mensal') // mensal | anual | personalizado
  const hoje = new Date()
  const [mesRef, setMesRef] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`)
  const [anoRef, setAnoRef] = useState(String(hoje.getFullYear()))
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [fCategoria, setFCategoria] = useState('')
  const [busca, setBusca] = useState('')

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    try {
      const { data, error } = await supabase.from('particularidades').select('*').order('criado_em', { ascending: false })
      if (error) throw error
      setItens(data || [])
    } catch (e) {
      toast('Erro ao carregar: ' + e.message, 'error')
    }
    setCarregando(false)
  }

  const filtrados = useMemo(() => {
    let out = itens
    if (modoPeriodo === 'mensal' && mesRef) {
      out = out.filter(p => p.criado_em?.slice(0, 7) === mesRef)
    } else if (modoPeriodo === 'anual' && anoRef) {
      out = out.filter(p => p.criado_em?.slice(0, 4) === anoRef)
    } else if (modoPeriodo === 'personalizado') {
      if (dataDe) out = out.filter(p => p.criado_em?.slice(0, 10) >= dataDe)
      if (dataAte) out = out.filter(p => p.criado_em?.slice(0, 10) <= dataAte)
    }
    if (fCategoria) out = out.filter(p => p.categoria === fCategoria)
    if (busca) out = out.filter(p =>
      p.nf?.toLowerCase().includes(busca.toLowerCase()) ||
      p.tomador?.toLowerCase().includes(busca.toLowerCase()) ||
      p.descricao?.toLowerCase().includes(busca.toLowerCase())
    )
    return out
  }, [itens, modoPeriodo, mesRef, anoRef, dataDe, dataAte, fCategoria, busca])

  const resumoPorCategoria = useMemo(() => {
    const m = {}
    filtrados.forEach(p => { m[p.categoria] = (m[p.categoria] || 0) + 1 })
    return m
  }, [filtrados])

  function exportarCSV() {
    const linhas = [['Data', 'NF', 'Tomador', 'Médico', 'Categoria', 'Descrição']]
    filtrados.forEach(p => linhas.push([
      fmtDataHora(p.criado_em), p.nf || '', p.tomador || '', p.medico_nome || '',
      CATEGORIAS[p.categoria] || p.categoria, p.descricao || '',
    ]))
    const csv = linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `particularidades_${modoPeriodo}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <span className="table-title">📌 Relatório de Particularidades</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['mensal', 'Mensal'], ['anual', 'Anual'], ['personalizado', 'Período']].map(([id, label]) => (
              <button key={id} onClick={() => setModoPeriodo(id)} className={`btn btn-xs ${modoPeriodo === id ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
            ))}
          </div>
          {modoPeriodo === 'mensal' && (
            <input type="month" className="filter-select" value={mesRef} onChange={e => setMesRef(e.target.value)} />
          )}
          {modoPeriodo === 'anual' && (
            <select className="filter-select" value={anoRef} onChange={e => setAnoRef(e.target.value)}>
              {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - i).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {modoPeriodo === 'personalizado' && (
            <>
              <input type="date" className="filter-select" style={{ width: 140 }} value={dataDe} onChange={e => setDataDe(e.target.value)} title="De" />
              <input type="date" className="filter-select" style={{ width: 140 }} value={dataAte} onChange={e => setDataAte(e.target.value)} title="Até" />
            </>
          )}
          <select className="filter-select" value={fCategoria} onChange={e => setFCategoria(e.target.value)}>
            <option value="">Todas categorias</option>
            {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="search-input" placeholder="🔍 Buscar NF, tomador ou texto…" value={busca} onChange={e => setBusca(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={exportarCSV} disabled={!filtrados.length}>⬇ Exportar CSV</button>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span className="badge badge-ok">{filtrados.length} registro(s) no período</span>
          {Object.entries(resumoPorCategoria).map(([cat, qtd]) => (
            <span key={cat} className="badge" style={{ background: 'var(--n9)', color: 'var(--n3)', border: '1px solid var(--border)' }}>
              {CATEGORIAS[cat] || cat}: {qtd}
            </span>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>NF</th><th>Tomador</th><th>Médico</th><th>Categoria</th><th>Descrição</th></tr></thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={6}><div className="empty-state" style={{ padding: '1.5rem' }}><p>Carregando…</p></div></td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={6}><div className="empty-state" style={{ padding: '1.5rem' }}><div className="empty-icon">📌</div><h4>Nada por aqui</h4><p>Nenhuma particularidade registrada nesse período.</p></div></td></tr>
              ) : filtrados.map(p => (
                <tr key={p.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>{fmtDataHora(p.criado_em)}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{p.nf || '—'}</td>
                  <td>{p.tomador || '—'}</td>
                  <td>{p.medico_nome || '—'}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{CATEGORIAS[p.categoria] || p.categoria}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--n3)' }}>{p.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

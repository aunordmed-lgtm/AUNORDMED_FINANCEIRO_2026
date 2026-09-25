import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import * as XLSX from 'xlsx'
import { uid, mesAtual } from '../lib/helpers'

const NS = 'http://www.sped.fazenda.gov.br/nfse'

function getTag(el, tag) {
  let found = el.getElementsByTagNameNS(NS, tag)
  if (found.length > 0) return found[0].textContent?.trim() || null
  found = el.getElementsByTagName(tag)
  if (found.length > 0) return found[0].textContent?.trim() || null
  return null
}

function getTagIn(el, parent, tag) {
  let pEls = el.getElementsByTagNameNS(NS, parent)
  if (!pEls.length) pEls = el.getElementsByTagName(parent)
  if (!pEls.length) return null
  const p = pEls[0]
  let found = p.getElementsByTagNameNS(NS, tag)
  if (!found.length) found = p.getElementsByTagName(tag)
  return found.length > 0 ? found[0].textContent?.trim() || null : null
}

function parseXMLNFSe(xmlText) {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'text/xml')
    const notas = []

    let nfsElements = Array.from(doc.getElementsByTagNameNS(NS, 'infNFSe'))
    if (!nfsElements.length) nfsElements = Array.from(doc.getElementsByTagName('infNFSe'))
    if (!nfsElements.length) nfsElements = [doc.documentElement]

    nfsElements.forEach((el, i) => {
      const numero = getTag(el, 'nNFSe') || getTag(el, 'nDFSe') || `IMPORT-${i+1}`
      const valorBruto = parseFloat(getTag(el, 'vServ') || getTag(el, 'vBC') || '0')
      const tomador = getTagIn(el, 'toma', 'xNome') || 'Tomador não identificado'
      const tomadorCnpj = getTagIn(el, 'toma', 'CNPJ') || null
      const dCompet = getTag(el, 'dCompet') || getTag(el, 'dhEmi') || ''
      let comp = '', emissao = ''
      if (dCompet) {
        const d = new Date(dCompet)
        if (!isNaN(d)) { comp = d.toISOString().substring(0, 7); emissao = d.toISOString().split('T')[0] }
      }
      const vISSQN = parseFloat(getTag(el, 'vISSQN') || '0')
      const discriminacao = getTag(el, 'xDescServ') || ''
      if (valorBruto > 0) {
        notas.push({ nf: numero, tomador: tomador.substring(0, 100), tomadorCnpj, comp, emissao, bruto: valorBruto, iss_retido: vISSQN, discriminacao: discriminacao.substring(0, 500), status: 'Emitida', origem: 'xml' })
      }
    })
    return notas
  } catch(e) { return [] }
}

function parseExcel(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (rows.length < 2) { resolve([]); return }
        const header = rows[0].map(h => String(h).toLowerCase().trim())
        const col = (names) => { for (const n of names) { const idx = header.findIndex(h => h.includes(n)); if (idx >= 0) return idx } return -1 }
        const cols = {
          nf: col(['número','numero','nf','nota']),
          tomador: col(['tomador','cliente','razão','razao','nome']),
          tomadorCnpj: col(['cnpj']),
          valor: col(['valor','bruto','serviço','servico','total']),
          competencia: col(['competência','competencia','período','periodo','mês','mes']),
          emissao: col(['emissão','emissao','data','dt']),
          status: col(['status','situação','situacao']),
        }
        const notas = []
        rows.slice(1).forEach((row, i) => {
          if (!row.some(c => c !== '')) return
          try {
            const get = (c) => c >= 0 ? String(row[c] || '').trim() : ''
            const getNum = (c) => c >= 0 ? parseFloat(String(row[c] || '0').replace(/[^\d.,]/g,'').replace(',','.')) || 0 : 0
            const valorBruto = getNum(cols.valor)
            if (valorBruto <= 0) return
            let comp = ''
            const compRaw = get(cols.competencia)
            if (compRaw) {
              const m1 = compRaw.match(/^(\d{2})\/(\d{4})$/)
              const m2 = compRaw.match(/^(\d{4})-(\d{2})$/)
              if (m1) comp = `${m1[2]}-${m1[1]}`
              else if (m2) comp = compRaw
              else { const d = new Date(compRaw); if (!isNaN(d)) comp = d.toISOString().substring(0,7) }
            }
            let emissao = ''
            const emissaoRaw = get(cols.emissao) || row[cols.emissao]
            if (emissaoRaw instanceof Date) emissao = emissaoRaw.toISOString().split('T')[0]
            else if (emissaoRaw) { const d = new Date(emissaoRaw); if (!isNaN(d)) emissao = d.toISOString().split('T')[0] }
            notas.push({ nf: get(cols.nf) || `IMPORT-${i+1}`, tomador: get(cols.tomador) || 'Não informado', tomadorCnpj: get(cols.tomadorCnpj) || null, comp: comp || mesAtual(), emissao, bruto: valorBruto, status: get(cols.status) || 'Emitida', origem: 'excel' })
          } catch(e) {}
        })
        resolve(notas)
      } catch(e) { resolve([]) }
    }
    reader.readAsArrayBuffer(file)
  })
}

export function ImportacaoNF({ medicos, onRefresh }) {
  const { toast } = useToast()
  const [etapa, setEtapa] = useState('upload')
  const [loading, setLoading] = useState(false)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0, arquivo: '' })
  const [notasImportadas, setNotasImportadas] = useState([])
  const [resultado, setResultado] = useState(null)
  const [medicoSelecionado, setMedicoSelecionado] = useState('')
  const [retencaoCustom, setRetencaoCustom] = useState('')
  const [selecionadas, setSelecionadas] = useState(new Set())
  const fileRef = useRef()

  const processarArquivos = async (files) => {
    if (!files.length) return
    setLoading(true)
    setProgresso({ atual: 0, total: files.length, arquivo: '' })
    const todasNotas = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setProgresso({ atual: i + 1, total: files.length, arquivo: file.name })
      try {
        let notas = []
        if (file.name.toLowerCase().endsWith('.xml') || file.name.toLowerCase().endsWith('.arq')) {
          const text = await file.text()
          notas = parseXMLNFSe(text)
        } else {
          notas = await parseExcel(file)
        }
        todasNotas.push(...notas)
      } catch(e) {}
    }

    setLoading(false)
    if (todasNotas.length > 0) {
      setNotasImportadas(todasNotas)
      setSelecionadas(new Set(todasNotas.map((_, i) => i)))
      setEtapa('preview')
      toast(`${todasNotas.length} nota(s) encontrada(s) em ${files.length} arquivo(s)!`)
    } else {
      toast('Nenhuma nota encontrada nos arquivos. Verifique se os XMLs não estão todos cancelados.', 'error')
    }
  }

  const handleFiles = (files) => processarArquivos(Array.from(files))
  const handleDrop = (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }

  const importar = async () => {
    const notasSel = notasImportadas.filter((_, i) => selecionadas.has(i))
    if (!notasSel.length) { toast('Selecione ao menos uma nota.', 'error'); return }
    const med = medicos.find(m => m.nome === medicoSelecionado)
    const retencao = parseFloat(retencaoCustom) || med?.retencao || 13
    setLoading(true)
    let sucesso = 0, falhas = 0, duplicadas = 0
    const falhasDetalhe = []

    // Buscar NFs já existentes para evitar duplicatas
    const nfsExistentes = await supabase.from('notas_fiscais').select('nf,comp').then(r => r.data || [])
    const chaves = new Set(nfsExistentes.map(n => `${n.nf}__${n.comp}`))

    for (let i = 0; i < notasSel.length; i++) {
      const n = notasSel[i]
      setProgresso({ atual: i + 1, total: notasSel.length, arquivo: `Salvando nota ${n.nf}...` })

      // Verificar duplicata
      const chave = `${n.nf}__${n.comp}`
      if (chaves.has(chave)) { duplicadas++; continue }
      chaves.add(chave)

      try {
        // Resolve o CNPJ do tomador: usa o que veio do XML/Excel, ou busca no
        // cadastro já existente — e cadastra automaticamente se ainda não existir.
        let tomadorCnpjFinal = n.tomadorCnpj || null
        if (n.tomador && n.tomador !== 'Tomador não identificado' && n.tomador !== 'Não informado') {
          const { data: tomExist } = await supabase.from('tomadores').select('id, cnpj').eq('nome', n.tomador).single().catch(() => ({ data: null }))
          if (tomExist) {
            if (!tomadorCnpjFinal && tomExist.cnpj) tomadorCnpjFinal = tomExist.cnpj
          } else {
            await supabase.from('tomadores').insert({ nome: n.tomador, cnpj: tomadorCnpjFinal || null, obs: 'Cadastrado automaticamente via importação de NF' }).catch(() => {})
          }
        }
        const recebido = n.bruto * 0.9385
        const medicos_nota = medicoSelecionado ? [{ nome: medicoSelecionado, crm: med?.crm || '', valor_bruto_medico: n.bruto, retencao_individual: retencao, repasse: n.bruto * (1 - retencao/100) }] : []
        const totalRepasse = medicos_nota.reduce((a, m) => a + m.repasse, 0)
        const margem = recebido - totalRepasse
        const payload = { nf: n.nf, tomador: n.tomador, tomador_cnpj: tomadorCnpjFinal, comp: n.comp, emissao: n.emissao, status: n.status, bruto: n.bruto, recebido, total_repasse: totalRepasse, margem, pct_margem: recebido > 0 ? margem/recebido : 0, medicos_nota: medicos_nota.length ? medicos_nota : null, nomes_medicos: medicoSelecionado || null, obs: n.discriminacao ? `Discriminação: ${n.discriminacao}` : null }
        const { data: nova, error: erroInsert } = await supabase.from('notas_fiscais').insert(payload).select().single()
        if (erroInsert) throw erroInsert
        if (medicoSelecionado && nova?.id) {
          const { error: erroComp } = await supabase.from('comprovantes').insert({ token: uid(), nf_id: nova.id, medico_nome: medicoSelecionado, medico_crm: med?.crm || null, tomador: n.tomador, valor_repasse: n.bruto * (1 - retencao/100), competencia: n.comp, dados_extras: { nf: n.nf, pix: med?.chave_pix } })
          if (erroComp) throw erroComp
        }
        sucesso++
      } catch(e) {
        falhas++
        falhasDetalhe.push({ nf: n.nf, motivo: e.message || 'Erro desconhecido' })
      }
    }
    setLoading(false)
    setResultado({ sucesso, falhas, duplicadas, total: notasSel.length, falhasDetalhe })
    setEtapa('resultado')
    onRefresh()
  }

  const reiniciar = () => { setEtapa('upload'); setNotasImportadas([]); setResultado(null); setSelecionadas(new Set()); setMedicoSelecionado(''); setRetencaoCustom('') }
  const toggleSel = (i) => setSelecionadas(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  const toggleTodos = () => selecionadas.size === notasImportadas.length ? setSelecionadas(new Set()) : setSelecionadas(new Set(notasImportadas.map((_, i) => i)))

  return (
    <div className="page-content">
      {etapa === 'upload' && (
        <>
          {/* DESTAQUE LOTE */}
          <div style={{ background: 'linear-gradient(135deg, var(--g10) 0%, var(--blue-l) 100%)', border: '1px solid var(--g8)', borderRadius: 'var(--radius-xl)', padding: '16px 20px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 32 }}>📦</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--g2)', marginBottom: 2 }}>Importação em lote</div>
              <div style={{ fontSize: 12, color: 'var(--n4)' }}>Selecione <strong>vários arquivos de uma vez</strong> — XML, Excel e CSV juntos. O sistema processa tudo automaticamente.</div>
            </div>
            <button className="btn btn-primary" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => { fileRef.current.accept='.xml,.arq,.xlsx,.xls,.csv'; fileRef.current.click() }}>
              📂 Selecionar arquivos
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div className="card">
              <div className="card-header"><h3>📄 XML — Portal Nacional NFS-e</h3></div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--n4)', marginBottom: 14, lineHeight: 1.6 }}>Padrão <strong>SPED Fazenda (gov.br)</strong> — prefeitura de Olinda/PE e demais municípios. Suporta múltiplos XMLs.</p>
                <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, textAlign: 'center', cursor: 'pointer', background: 'var(--n10)', transition: 'all .2s' }}
                  onClick={() => { fileRef.current.accept='.xml,.arq'; fileRef.current.click() }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--g5)'; e.currentTarget.style.background='var(--g10)' }}
                  onDragLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)' }}
                  onDrop={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)'; handleDrop(e) }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🗂️</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n2)', marginBottom: 3 }}>Arraste XMLs aqui</div>
                  <div style={{ fontSize: 11, color: 'var(--n5)' }}>ou clique para selecionar (múltiplos)</div>
                  <div style={{ marginTop: 10 }}><><span style={{ background: 'var(--g10)', color: 'var(--g3)', border: '1px solid var(--g8)', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 10px', marginRight: 4 }}>XML</span><span style={{ background: 'var(--orange-l)', color: 'var(--orange-d)', border: '1px solid #FED7AA', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 10px' }}>ARQ</span></></div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>📊 Excel / CSV</h3></div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--n4)', marginBottom: 14, lineHeight: 1.6 }}>Planilhas com colunas de <strong>número, tomador, valor, competência</strong>. Detecta os campos automaticamente.</p>
                <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, textAlign: 'center', cursor: 'pointer', background: 'var(--n10)', transition: 'all .2s' }}
                  onClick={() => { fileRef.current.accept='.xlsx,.xls,.csv'; fileRef.current.click() }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--blue)'; e.currentTarget.style.background='var(--blue-l)' }}
                  onDragLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)' }}
                  onDrop={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)'; handleDrop(e) }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n2)', marginBottom: 3 }}>Arraste Excel aqui</div>
                  <div style={{ fontSize: 11, color: 'var(--n5)' }}>ou clique para selecionar</div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {['XLSX','XLS','CSV'].map(f => <span key={f} style={{ background: 'var(--blue-l)', color: 'var(--blue)', border: '1px solid #BFDBFE', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 10px' }}>{f}</span>)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>📋 Modelo Excel</h3></div>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--n4)' }}>Baixe o modelo para criar sua planilha de importação com os campos corretos.</div>
              <button className="btn btn-outline btn-sm" onClick={() => {
                const ws = XLSX.utils.aoa_to_sheet([['Número','Tomador','Valor','Competência','Emissão','Status'],['00001','Unimed Sergipe','1200,00','05/2026','15/05/2026','Emitida'],['00002','Bradesco Saúde','850,00','05/2026','16/05/2026','Emitida']])
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Modelo'); XLSX.writeFile(wb, 'modelo_importacao_nf.xlsx'); toast('Modelo baixado!')
              }}>⬇ Baixar modelo</button>
            </div>
          </div>

          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => { if(e.target.files.length) handleFiles(e.target.files) }} />

          {loading && (
            <div className="loading-full">
              <div className="spinner spinner-lg"/>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n2)', marginBottom: 4 }}>Processando arquivos...</div>
                <div style={{ fontSize: 12, color: 'var(--n5)', marginBottom: 12 }}>{progresso.arquivo}</div>
                <div style={{ width: 200, height: 6, background: 'var(--n8)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--g5)', borderRadius: 3, width: `${progresso.total > 0 ? (progresso.atual/progresso.total)*100 : 0}%`, transition: 'width .3s' }}/>
                </div>
                <div style={{ fontSize: 11, color: 'var(--n6)', marginTop: 6 }}>{progresso.atual} de {progresso.total} arquivo(s)</div>
              </div>
            </div>
          )}
        </>
      )}

      {etapa === 'preview' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <div className="card-header"><h3>👨‍⚕️ Vincular médico (opcional)</h3></div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field"><label>Médico</label>
                    <select value={medicoSelecionado} onChange={e => setMedicoSelecionado(e.target.value)}>
                      <option value="">— sem vínculo —</option>
                      {[...medicos].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')).map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>% Retenção</label>
                    <input type="number" value={retencaoCustom} onChange={e => setRetencaoCustom(e.target.value)} placeholder={medicos.find(m=>m.nome===medicoSelecionado)?.retencao||'13'} step="0.01"/>
                  </div>
                </div>
              </div>
            </div>
            <div className="kpi" style={{ minWidth: 140 }}>
              <div className="kpi-bar" style={{ background: 'var(--g5)' }}/>
              <div className="kpi-label">Notas encontradas</div>
              <div className="kpi-value">{notasImportadas.length}</div>
              <div className="kpi-sub">{selecionadas.size} selecionadas</div>
            </div>
          </div>

          <div className="card">
            <div className="table-toolbar">
              <span className="table-title">Notas para importar</span>
              <button className="btn btn-ghost btn-sm" onClick={toggleTodos}>{selecionadas.size === notasImportadas.length ? 'Desmarcar todas' : 'Selecionar todas'}</button>
              <button className="btn btn-ghost btn-sm" onClick={reiniciar}>← Voltar</button>
              <button className="btn btn-primary btn-sm" onClick={importar} disabled={loading || !selecionadas.size}>
                {loading ? <><span className="spinner spinner-sm"/> Importando {progresso.atual}/{progresso.total}…</> : `✓ Importar ${selecionadas.size} nota(s)`}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th><input type="checkbox" checked={selecionadas.size===notasImportadas.length} onChange={toggleTodos}/></th>
                  <th>Nº NF</th><th>Tomador</th><th>Competência</th><th>Emissão</th><th>Valor bruto</th><th>Status</th><th>Origem</th>
                </tr></thead>
                <tbody>{notasImportadas.map((n, i) => (
                  <tr key={i} style={{ opacity: selecionadas.has(i) ? 1 : .45 }}>
                    <td><input type="checkbox" checked={selecionadas.has(i)} onChange={() => toggleSel(i)}/></td>
                    <td className="mono" style={{ fontWeight: 600 }}>{n.nf}</td>
                    <td>{n.tomador}</td>
                    <td className="mono">{n.comp || '—'}</td>
                    <td className="mono">{n.emissao || '—'}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--g3)' }}>{Number(n.bruto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td><span className="badge badge-emit">{n.status}</span></td>
                    <td><span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: n.origem==='xml'?'#EFF6FF':n.origem==='xml-olinda'?'#FFF7ED':'#F0FDF4', color: n.origem==='xml'?'#2563EB':n.origem==='xml-olinda'?'#C2410C':'#15803D', border: `1px solid ${n.origem==='xml'?'#BFDBFE':n.origem==='xml-olinda'?'#FED7AA':'#BBF7D0'}`, fontWeight: 700 }}>{n.origem==='xml-olinda'?'OLINDA':n.origem?.toUpperCase()}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {etapa === 'resultado' && resultado && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 20 }}>
          <div style={{ fontSize: 64 }}>{resultado.falhas === 0 ? '🎉' : '⚠️'}</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--n1)', marginBottom: 8 }}>Importação concluída!</div>
            <div style={{ fontSize: 14, color: 'var(--n4)' }}>
              <span style={{ color: 'var(--g3)', fontWeight: 700 }}>{resultado.sucesso}</span> de <strong>{resultado.total}</strong> nota(s) importada(s) com sucesso
              {resultado.falhas > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · {resultado.falhas} falha(s)</span>}
              {resultado.duplicadas > 0 && <span style={{ color: 'var(--orange)', fontWeight: 700 }}> · {resultado.duplicadas} já existiam (ignoradas)</span>}
            </div>
            {resultado.falhasDetalhe?.length > 0 && (
              <div style={{ marginTop: 16, textAlign: 'left', maxWidth: 480, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', marginBottom: 6 }}>Motivo das falhas:</div>
                {resultado.falhasDetalhe.map((f, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: '#B91C1C', marginBottom: 4 }}>
                    <strong>NF {f.nf || '—'}:</strong> {f.motivo}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={reiniciar}>⬆ Importar mais</button>
            <button className="btn btn-primary" onClick={() => window.location.href = '/notas'}>📄 Ver notas importadas</button>
          </div>
        </div>
      )}
    </div>
  )
}

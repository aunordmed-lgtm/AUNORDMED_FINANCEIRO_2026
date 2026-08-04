import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { brl, fmtData } from '../lib/helpers'

// Parser OFX formato Banco Inter (SGML Latin-1)
function parseOFX(text) {
  const transacoes = []

  // Extrair blocos STMTTRN
  const blocos = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || []

  blocos.forEach((bloco, i) => {
    const get = (tag) => {
      const match = bloco.match(new RegExp(`<${tag}>([^<\r\n]+)`, 'i'))
      return match ? match[1].trim() : ''
    }

    const tipo = get('TRNTYPE').toUpperCase()
    const valorStr = get('TRNAMT').replace(',', '.')
    const valor = parseFloat(valorStr) || 0
    const dtRaw = get('DTPOSTED')
    const memo = get('MEMO') || get('NAME') || ''
    const nome = get('NAME') || ''
    const fitid = get('FITID') || `T${i}`

    // Converter data YYYYMMDD → YYYY-MM-DD
    let data = ''
    if (dtRaw.length >= 8) {
      data = `${dtRaw.substring(0,4)}-${dtRaw.substring(4,6)}-${dtRaw.substring(6,8)}`
    }

    if (valor !== 0) {
      transacoes.push({
        id: fitid,
        valor,
        data,
        memo: memo.replace(/["]/g, '').trim(),
        nome: nome.trim(),
        tipo: valor > 0 ? 'credito' : 'debito',
        trntype: tipo
      })
    }
  })

  return transacoes
}

function cruzar(transacoes, notas) {
  const MARGEM = 0.02
  const resultado = []

  transacoes.filter(t => t.tipo === 'credito').forEach(t => {
    const valorT = Math.abs(t.valor)

    const notaMatch = notas.find(n => {
      if (n.status === 'Paga ao médico') return false
      const recebido = n.recebido || (n.bruto * 0.9385)
      const diff = Math.abs(recebido - valorT) / Math.max(valorT, 0.01)
      return diff <= MARGEM
    })

    resultado.push({
      transacao: t,
      nota: notaMatch || null,
      status: notaMatch ? 'encontrada' : 'nao_encontrada'
    })
  })

  return resultado
}

export function ExtratoOFX({ notas, onRefresh }) {
  const { toast } = useToast()
  const [etapa, setEtapa] = useState('upload')
  const [loading, setLoading] = useState(false)
  const [transacoes, setTransacoes] = useState([])
  const [cruzamento, setCruzamento] = useState([])
  const [resultado, setResultado] = useState(null)
  const [selecionadas, setSelecionadas] = useState(new Set())
  const fileRef = useRef()

  const processarOFX = async (file) => {
    setLoading(true)
    try {
      // Leitura com encoding Latin-1 (padrão Inter)
      const buffer = await file.arrayBuffer()
      const decoder = new TextDecoder('iso-8859-1')
      const text = decoder.decode(buffer)

      const trans = parseOFX(text)
      if (!trans.length) { toast('Nenhuma transação encontrada no extrato.', 'error'); setLoading(false); return }

      const cruz = cruzar(trans, notas)
      setTransacoes(trans)
      setCruzamento(cruz)
      setSelecionadas(new Set(
        cruz.map((c, i) => c.status === 'encontrada' ? i : -1).filter(i => i >= 0)
      ))
      setEtapa('preview')
      const encontradas = cruz.filter(c => c.status === 'encontrada').length
      toast(`${trans.length} transação(ões) · ${encontradas} NF(s) identificada(s) automaticamente!`)
    } catch(e) { toast('Erro ao processar: ' + e.message, 'error') }
    setLoading(false)
  }

  const darBaixa = async () => {
    const sels = cruzamento.filter((_, i) => selecionadas.has(i))
    if (!sels.length) { toast('Selecione ao menos um item.', 'error'); return }
    setLoading(true)
    let sucesso = 0, falhas = 0

    for (const item of sels) {
      if (!item.nota) continue
      try {
        await supabase.from('notas_fiscais').update({ status: 'Recebida' }).eq('id', item.nota.id)
        sucesso++
      } catch(e) { falhas++ }
    }

    setLoading(false)
    setResultado({ sucesso, falhas })
    setEtapa('resultado')
    onRefresh()
  }

  const reiniciar = () => { setEtapa('upload'); setTransacoes([]); setCruzamento([]); setResultado(null); setSelecionadas(new Set()) }
  const toggleSel = (i) => setSelecionadas(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  const toggleTodos = () => selecionadas.size === cruzamento.length ? setSelecionadas(new Set()) : setSelecionadas(new Set(cruzamento.map((_, i) => i)))

  const encontradas = cruzamento.filter(c => c.status === 'encontrada').length
  const naoEncontradas = cruzamento.filter(c => c.status === 'nao_encontrada').length
  const totalCreditos = transacoes.filter(t => t.tipo === 'credito').reduce((a, t) => a + t.valor, 0)

  return (
    <div className="page-content">
      {etapa === 'upload' && (
        <>
          <div style={{ background: 'linear-gradient(135deg, var(--blue-l), var(--g10))', border: '1px solid #BFDBFE', borderRadius: 'var(--radius-xl)', padding: '18px 22px', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--g2)', marginBottom: 10 }}>🏦 Como funciona o cruzamento com extrato</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { n:'1', t:'Baixe o OFX no Inter', d:'Extrato → Exportar → período desejado → formato OFX' },
                { n:'2', t:'Cruzamento automático', d:'Compara os créditos do banco com o valor recebido das NFs (bruto − 6,15%)' },
                { n:'3', t:'Dê baixa', d:'Confirme os matches e marque as NFs como "Recebida" automaticamente' },
              ].map(s => (
                <div key={s.n} style={{ background: 'rgba(255,255,255,.7)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', display: 'flex', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--g4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.n}</div>
                  <div><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n2)', marginBottom: 2 }}>{s.t}</div><div style={{ fontSize: 11, color: 'var(--n4)' }}>{s.d}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>📂 Importar extrato OFX — Banco Inter</h3></div>
            <div className="card-body">
              <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center', cursor: 'pointer', background: 'var(--n10)', transition: 'all .2s' }}
                onClick={() => fileRef.current.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--blue)'; e.currentTarget.style.background='var(--blue-l)' }}
                onDragLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)' }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--n10)'; if(e.dataTransfer.files[0]) processarOFX(e.dataTransfer.files[0]) }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n2)', marginBottom: 4 }}>Arraste o extrato OFX aqui</div>
                <div style={{ fontSize: 12, color: 'var(--n5)', marginBottom: 12 }}>ou clique para selecionar</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {['OFX','QFX'].map(f => <span key={f} style={{ background: 'var(--blue-l)', color: 'var(--blue)', border: '1px solid #BFDBFE', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '3px 12px' }}>{f}</span>)}
                </div>
              </div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".ofx,.qfx,.ofc,.txt" style={{ display: 'none' }} onChange={e => { if(e.target.files[0]) processarOFX(e.target.files[0]) }} />
          {loading && <div className="loading-full"><div className="spinner spinner-lg"/><span>Processando extrato...</span></div>}
        </>
      )}

      {etapa === 'preview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { bar:'var(--g5)', ic:'var(--g10)', icon:'📊', label:'Total transações', value:transacoes.length, sub:'No extrato' },
              { bar:'var(--blue)', ic:'var(--blue-l)', icon:'💰', label:'Total créditos', value:brl(totalCreditos), sub:`${transacoes.filter(t=>t.tipo==='credito').length} entradas` },
              { bar:'var(--g5)', ic:'var(--g10)', icon:'✅', label:'NFs identificadas', value:encontradas, sub:'Match automático' },
              { bar:'var(--orange)', ic:'var(--orange-l)', icon:'❓', label:'Não identificadas', value:naoEncontradas, sub:'Verificar manualmente' },
            ].map((k,i) => (
              <div key={i} className="kpi">
                <div className="kpi-bar" style={{ background:k.bar }}/>
                <div className="kpi-icon" style={{ background:k.ic }}>{k.icon}</div>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value">{k.value}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="table-toolbar">
              <span className="table-title">Cruzamento extrato × notas fiscais</span>
              <button className="btn btn-ghost btn-sm" onClick={toggleTodos}>{selecionadas.size === cruzamento.length ? 'Desmarcar todas' : 'Selecionar todas'}</button>
              <button className="btn btn-ghost btn-sm" onClick={reiniciar}>← Voltar</button>
              <button className="btn btn-primary btn-sm" onClick={darBaixa} disabled={loading || !selecionadas.size}>
                {loading ? <><span className="spinner spinner-sm"/> Processando…</> : `✓ Dar baixa em ${selecionadas.size} NF(s)`}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th></th>
                  <th>Data</th><th>Valor banco</th><th>Descrição</th>
                  <th>NF vinculada</th><th>Tomador</th><th>Valor NF</th><th>Match</th>
                </tr></thead>
                <tbody>
                  {cruzamento.map((item, i) => (
                    <tr key={i} style={{ background: item.status==='encontrada'?'#F0FDF4':'#FFFBEB' }}>
                      <td>{item.nota && <input type="checkbox" checked={selecionadas.has(i)} onChange={() => toggleSel(i)}/>}</td>
                      <td className="mono">{fmtData(item.transacao.data)}</td>
                      <td className="mono" style={{ fontWeight:700, color:'var(--g3)' }}>{brl(item.transacao.valor)}</td>
                      <td style={{ fontSize:11, color:'var(--n4)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={item.transacao.memo}>{item.transacao.memo}</td>
                      <td className="mono" style={{ fontWeight:600 }}>{item.nota?.nf || '—'}</td>
                      <td style={{ fontSize:11 }}>{item.nota?.tomador || '—'}</td>
                      <td className="mono">{item.nota ? brl(item.nota.recebido || item.nota.bruto * 0.9385) : '—'}</td>
                      <td>
                        {item.status==='encontrada'
                          ? <span style={{ background:'var(--g10)', color:'var(--g3)', border:'1px solid var(--g8)', borderRadius:99, fontSize:10, fontWeight:700, padding:'2px 8px' }}>✓ Match</span>
                          : <span style={{ background:'var(--yellow-l)', color:'var(--yellow)', border:'1px solid #FDE68A', borderRadius:99, fontSize:10, fontWeight:700, padding:'2px 8px' }}>? Não encontrado</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {etapa === 'resultado' && resultado && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:20 }}>
          <div style={{ fontSize:64 }}>{resultado.falhas===0?'🎉':'⚠️'}</div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:800, color:'var(--n1)', marginBottom:8 }}>Baixa realizada!</div>
            <div style={{ fontSize:14, color:'var(--n4)' }}>
              <span style={{ color:'var(--g3)', fontWeight:700 }}>{resultado.sucesso}</span> NF(s) marcadas como <strong>Recebida</strong>
              {resultado.falhas>0 && <span style={{ color:'var(--red)', fontWeight:700 }}> · {resultado.falhas} falha(s)</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-outline" onClick={reiniciar}>⬆ Importar outro extrato</button>
            <button className="btn btn-primary" onClick={() => window.location.href='/pendencias'}>📋 Ver pendências</button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useMemo } from 'react'

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMes = m => {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  const ms = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${ms[+mo - 1]}/${y}`
}

const G = { g1: '#0D3D20', g2: '#145C30', g3: '#1A7A3E', g6: '#A8DCBA', g7: '#E8F5ED' }
const GRAY = { 0: '#0F172A', 1: '#1E293B', 2: '#475569', 3: '#94A3B8', 5: '#E2E8F0', 6: '#F1F5F9' }
const RED = '#DC2626'
const ORANGE = '#D97706'
const BLUE = '#1D4ED8'

const cardStyle = { background: '#fff', border: '1px solid #D4E6DA', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }
const badge = (bg, color, border) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: bg, color, border: '1px solid ' + border })

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ ...cardStyle, padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY[2], textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'monospace', color: color || GRAY[0] }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY[3], marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function RiscoCard({ icon, titulo, valor, sub, cor, ok }) {
  return (
    <div style={{ ...cardStyle, padding: '16px 18px', borderLeft: `4px solid ${ok ? G.g3 : cor}` }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{ok ? '✅' : icon}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: GRAY[2], marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ok ? G.g3 : cor, fontFamily: 'monospace' }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: GRAY[3], marginTop: 3 }}>{sub}</div>
    </div>
  )
}

const TIPOS_DOC = [
  { key: 'contrato_social', label: 'Contrato Social', validadeDias: null }, // não tem "vencimento" natural
  { key: 'certidao_federal', label: 'Certidão Negativa Federal', validadeDias: 180 },
  { key: 'certidao_estadual', label: 'Certidão Negativa Estadual', validadeDias: 90 },
  { key: 'certidao_municipal', label: 'Certidão Negativa Municipal', validadeDias: 90 },
  { key: 'certidao_fgts', label: 'Certidão Negativa do FGTS', validadeDias: 30 },
  { key: 'certidao_trabalhista', label: 'Certidão Negativa Trabalhista', validadeDias: 180 },
]

export function Governanca({ notas = [], medicos = [], extratoBancario = [], documentosEmpresa = [] }) {
  // ── Financeiro consolidado ──
  const financeiro = useMemo(() => {
    const bruto = notas.reduce((a, n) => a + (n.bruto || 0), 0)
    const recebido = notas.reduce((a, n) => a + (n.recebido || 0), 0)
    const repasseDevido = notas.reduce((a, n) => a + (n.total_repasse || 0), 0)
    const margem = recebido - repasseDevido
    return { bruto, recebido, repasseDevido, margem, pctMargem: recebido > 0 ? margem / recebido : 0 }
  }, [notas])

  // ── Conciliação (mesma lógica da aba de Notas Fiscais) ──
  const pagoRealPorNf = useMemo(() => {
    const m = {}
    extratoBancario.forEach(e => { if (e.nf) m[e.nf] = (m[e.nf] || 0) + (e.valor || 0) })
    return m
  }, [extratoBancario])

  const conciliacao = useMemo(() => {
    let bate = 0, menor = 0, maior = 0, semPagamento = 0
    notas.forEach(n => {
      const esperado = n.total_repasse || 0
      const pago = pagoRealPorNf[n.nf] || 0
      if (!pago) { semPagamento++; return }
      if (Math.abs(pago - esperado) <= 0.01) bate++
      else if (pago < esperado) menor++
      else maior++
    })
    const total = notas.length || 1
    return { bate, menor, maior, semPagamento, pctBate: (bate / total) * 100 }
  }, [notas, pagoRealPorNf])

  // ── Riscos operacionais ──
  const riscos = useMemo(() => {
    const emPrejuizo = notas.filter(n => (n.margem || 0) < 0)
    const hojeISO = new Date().toISOString().split('T')[0]
    const vencidasSemBaixa = notas.filter(n => n.status !== 'Paga ao médico' && n.data_vencimento && n.data_vencimento.split('T')[0] < hojeISO)
    const travadas = notas.filter(n => n.status === 'Emitida')

    // Médicos sem faturar nos últimos 2 meses (mesma lógica usada em Gargalos)
    const hoje = new Date()
    const mesesRecentes = [0, 1].map(i => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
    const medicosAtivosRecente = new Set()
    notas.forEach(n => { if (mesesRecentes.includes(n.comp)) (n.medicos_nota || []).forEach(mn => medicosAtivosRecente.add(mn.nome)) })
    const medicosInativos = medicos.filter(m => !medicosAtivosRecente.has(m.nome) && m.ativo !== false)

    return {
      emPrejuizo: { qtd: emPrejuizo.length, valor: emPrejuizo.reduce((a, n) => a + Math.abs(n.margem || 0), 0) },
      vencidasSemBaixa: { qtd: vencidasSemBaixa.length, valor: vencidasSemBaixa.reduce((a, n) => a + (n.bruto || 0), 0) },
      travadas: { qtd: travadas.length, valor: travadas.reduce((a, n) => a + (n.bruto || 0), 0) },
      medicosInativos: medicosInativos.length,
    }
  }, [notas, medicos])

  // ── Documentos / compliance ──
  const documentos = useMemo(() => {
    const hoje = new Date()
    return TIPOS_DOC.map(t => {
      const doc = documentosEmpresa.find(d => d.tipo === t.key)
      if (!doc) return { ...t, status: 'faltando' }
      const diasDesdeAtualizacao = Math.floor((hoje - new Date(doc.atualizado_em)) / 86400000)
      const desatualizado = t.validadeDias != null && diasDesdeAtualizacao > t.validadeDias
      return { ...t, status: desatualizado ? 'desatualizado' : 'ok', diasDesdeAtualizacao, atualizadoEm: doc.atualizado_em, url: doc.url }
    })
  }, [documentosEmpresa])

  const qtdDocsOk = documentos.filter(d => d.status === 'ok').length
  const qtdDocsProblema = documentos.filter(d => d.status !== 'ok').length

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ background: `linear-gradient(135deg, ${G.g1} 0%, ${G.g3} 100%)`, borderRadius: 20, padding: '24px 28px', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>🏛️ Painel de Governança</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4, maxWidth: 660, lineHeight: 1.5 }}>
            Visão executiva consolidada: saúde financeira, conciliação bancária, riscos operacionais e regularidade documental — tudo num só lugar.
          </div>
        </div>

        {/* SAÚDE FINANCEIRA */}
        <div style={{ fontSize: 13, fontWeight: 700, color: GRAY[1], marginBottom: 10 }}>💰 Saúde financeira</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <Kpi label="Total faturado (bruto)" value={`R$ ${brl(financeiro.bruto)}`} sub={`${notas.length} nota(s)`} />
          <Kpi label="Repasse devido" value={`R$ ${brl(financeiro.repasseDevido)}`} sub="segundo as notas" color={BLUE} />
          <Kpi label="Margem total" value={`R$ ${brl(financeiro.margem)}`} sub={`${(financeiro.pctMargem * 100).toFixed(1)}% sobre o recebido`} color={financeiro.margem >= 0 ? G.g3 : RED} />
          <Kpi label="Conciliação em dia" value={`${conciliacao.pctBate.toFixed(0)}%`} sub={`${conciliacao.bate} de ${notas.length} nota(s) batendo certinho`} color={conciliacao.pctBate >= 80 ? G.g3 : conciliacao.pctBate >= 50 ? ORANGE : RED} />
        </div>

        {/* CONCILIAÇÃO */}
        <div style={{ fontSize: 13, fontWeight: 700, color: GRAY[1], marginBottom: 10 }}>🔄 Conciliação bancária</div>
        <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={badge(G.g7, G.g2, G.g6)}>✅ {conciliacao.bate} bate(m) certinho</span>
          <span style={badge('#FFFBEB', ORANGE, '#FDE68A')}>📉 {conciliacao.menor} paga(s) a menor</span>
          <span style={badge('#EFF6FF', BLUE, '#BFDBFE')}>📈 {conciliacao.maior} paga(s) a maior</span>
          <span style={badge(GRAY[6], GRAY[3], GRAY[5])}>⚪ {conciliacao.semPagamento} sem pagamento registrado</span>
        </div>

        {/* RISCOS OPERACIONAIS */}
        <div style={{ fontSize: 13, fontWeight: 700, color: GRAY[1], marginBottom: 10 }}>⚠️ Riscos operacionais</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <RiscoCard icon="🚨" titulo="Notas em prejuízo" valor={riscos.emPrejuizo.qtd} sub={riscos.emPrejuizo.qtd > 0 ? `R$ ${brl(riscos.emPrejuizo.valor)} em prejuízo acumulado` : 'Nenhuma nota em prejuízo'} cor={RED} ok={riscos.emPrejuizo.qtd === 0} />
          <RiscoCard icon="📅" titulo="Vencidas sem baixa" valor={riscos.vencidasSemBaixa.qtd} sub={riscos.vencidasSemBaixa.qtd > 0 ? `R$ ${brl(riscos.vencidasSemBaixa.valor)} em aberto` : 'Nenhum prazo vencido'} cor={RED} ok={riscos.vencidasSemBaixa.qtd === 0} />
          <RiscoCard icon="🔒" titulo="Notas travadas (emitidas)" valor={riscos.travadas.qtd} sub={riscos.travadas.qtd > 0 ? `R$ ${brl(riscos.travadas.valor)} aguardando recebimento` : 'Nada travado'} cor={ORANGE} ok={riscos.travadas.qtd === 0} />
          <RiscoCard icon="👨‍⚕️" titulo="Médicos inativos" valor={riscos.medicosInativos} sub="sem faturar nos últimos 2 meses" cor={ORANGE} ok={riscos.medicosInativos === 0} />
        </div>

        {/* DOCUMENTOS / COMPLIANCE */}
        <div style={{ fontSize: 13, fontWeight: 700, color: GRAY[1], marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          📎 Regularidade documental
          <span style={badge(qtdDocsProblema === 0 ? G.g7 : '#FEF2F2', qtdDocsProblema === 0 ? G.g2 : RED, qtdDocsProblema === 0 ? G.g6 : '#FECACA')}>
            {qtdDocsOk}/{documentos.length} em dia
          </span>
        </div>
        <div style={{ ...cardStyle, overflow: 'hidden', marginBottom: 24 }}>
          {documentos.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
              borderBottom: i < documentos.length - 1 ? '1px solid ' + GRAY[6] : 'none',
            }}>
              <span style={{ fontSize: 16 }}>{d.status === 'ok' ? '✅' : d.status === 'desatualizado' ? '⚠️' : '❌'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: GRAY[1] }}>{d.label}</div>
                <div style={{ fontSize: 10.5, color: GRAY[3] }}>
                  {d.status === 'faltando' ? 'Nenhum arquivo enviado ainda' :
                   d.status === 'desatualizado' ? `Atualizado há ${d.diasDesdeAtualizacao} dias — recomendado renovar (validade estimada: ${d.validadeDias} dias)` :
                   `Atualizado há ${d.diasDesdeAtualizacao} dia(s)`}
                </div>
              </div>
              {d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: G.g2 }}>Ver arquivo</a>}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 10.5, color: GRAY[3], textAlign: 'center', paddingBottom: 10 }}>
          Prazos de validade das certidões são estimativas de referência — confirme o prazo oficial de cada órgão emissor.
        </div>
      </div>
    </div>
  )
}

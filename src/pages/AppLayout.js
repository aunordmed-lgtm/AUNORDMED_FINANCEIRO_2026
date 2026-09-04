import { Routes, Route } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Sidebar } from '../components/Sidebar'
import { Dashboard } from './Dashboard'
import { Notas } from './Notas'
import { Pendencias } from './Pendencias'
import { Medicos } from './Medicos'
import { Tomadores } from './Tomadores'
import { Adiantamentos } from './Adiantamentos'
import { Cashback } from './Cashback'
import { Comprovante } from './Comprovante'
import { Comprovantes } from './Comprovantes'
import { Relatorios } from './Relatorios'
import { RelatorioGerencial } from './RelatorioGerencial'
import { FluxoCaixa } from './FluxoCaixa'
import { Contas } from './Contas'
import { Impostos } from './Impostos'
import { DRE } from './DRE'
import { Configuracoes } from './Configuracoes'
import { ImportacaoNF } from './ImportacaoNF'
import { RegimeCaixa } from './RegimeCaixa'
import { Repasses } from './Repasses'
import { ConferenciaPDF } from './ConferenciaPDF'
import { Solicitacoes } from './Solicitacoes'
import { Gargalos } from './Gargalos'
import { Documentos } from './Documentos'

async function safeQueryCustom(fn) {
  try {
    const { data, error } = await fn()
    if (error) return []
    return data || []
  } catch { return [] }
}

export function AppLayout() {
  const [data, setData] = useState({
    notas: [], medicos: [], tomadores: [], adiantamentos: [],
    cashbacks: [], comprovantes: [], contas: [], impostos: [], solicitacoes: [], extratoBancario: [], documentosEmpresa: []
  })
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    const [notas, medicos, tomadores, adiantamentos, cashbacks, comprovantes, contas, impostos, solicitacoes, extratoBancario, documentosEmpresa] = await Promise.all([
      safeQueryCustom(() => supabase.from('notas_fiscais').select('*').order('criado_em', { ascending: false })),
      safeQueryCustom(() => supabase.from('medicos').select('*').order('nome')),
      safeQueryCustom(() => supabase.from('tomadores').select('*').order('nome')),
      safeQueryCustom(() => supabase.from('adiantamentos').select('*').order('criado_em', { ascending: false })),
      safeQueryCustom(() => supabase.from('cashback').select('*').order('criado_em', { ascending: false })),
      safeQueryCustom(() => supabase.from('comprovantes').select('*').order('criado_em', { ascending: false })),
      safeQueryCustom(() => supabase.from('contas_pagar_receber').select('*').order('vencimento')),
      safeQueryCustom(() => supabase.from('impostos').select('*').order('competencia', { ascending: false })),
      safeQueryCustom(() => supabase.from('solicitacoes_medicos').select('*').order('criado_em', { ascending: false })),
      safeQueryCustom(() => supabase.from('extrato_bancario').select('*').order('data', { ascending: false })),
      safeQueryCustom(() => supabase.from('documentos_empresa').select('*')),
    ])
    setData({ notas, medicos, tomadores, adiantamentos, cashbacks, comprovantes, contas, impostos, solicitacoes, extratoBancario, documentosEmpresa })
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const hojeISO = new Date().toISOString().split('T')[0]
  const badges = {
    nf: data.notas.length,
    pend: data.notas.filter(n => n.status === 'Emitida' || n.status === 'Recebida').length,
    med: data.medicos.length,
    comp: data.comprovantes.length,
    adt: data.adiantamentos.filter(a => a.status === 'pendente').length,
    cb: data.cashbacks.filter(c => c.status === 'pendente').length,
    contas: data.contas.filter(c => c.status === 'pendente').length,
    solic: data.solicitacoes.filter(s => s.status === 'Pendente').length,
    gargalo: data.notas.filter(n => n.status === 'Emitida').length + data.notas.filter(n => n.valor_recebido_real != null && n.valor_recebido_real < (n.recebido || 0) - 0.01).length,
    vencidas: data.notas.filter(n => n.status !== 'Paga ao médico' && n.data_vencimento && n.data_vencimento.split('T')[0] < hojeISO).length,
  }

  if (loading) return (
    <div className="loading-full">
      <div className="spinner spinner-lg" />
      <span>Carregando AunordMED...</span>
    </div>
  )

  const props = { ...data, onRefresh: carregar }

  return (
    <div className="app-layout">
      <Sidebar badges={badges} />
      <div className="main">
        <Routes>
          <Route path="/" element={<Dashboard {...props} />} />
          <Route path="/notas" element={<Notas {...props} />} />
          <Route path="/importacao" element={<ImportacaoNF {...props} />} />
          <Route path="/solicitacoes" element={<Solicitacoes {...props} />} />
          <Route path="/gargalos" element={<Gargalos {...props} />} />
          <Route path="/documentos" element={<Documentos {...props} />} />
          <Route path="/pendencias" element={<Pendencias {...props} />} />
          <Route path="/medicos" element={<Medicos {...props} />} />
          <Route path="/tomadores" element={<Tomadores {...props} />} />
          <Route path="/adiantamentos" element={<Adiantamentos {...props} />} />
          <Route path="/cashback" element={<Cashback {...props} />} />
          <Route path="/comprovantes" element={<Comprovantes {...props} />} />
          <Route path="/relatorios" element={<Relatorios {...props} />} />
          <Route path="/relatorio-gerencial" element={<RelatorioGerencial {...props} />} />
          <Route path="/regime-caixa" element={<RegimeCaixa {...props} />} />
          <Route path="/fluxo-caixa" element={<FluxoCaixa {...props} />} />
          <Route path="/contas" element={<Contas {...props} />} />
          <Route path="/impostos" element={<Impostos {...props} />} />
          <Route path="/dre" element={<DRE {...props} />} />
          <Route path="/configuracoes" element={<Configuracoes {...props} />} />
          <Route path="/repasses" element={<Repasses {...props} />} />
          <Route path="/conferencia-pdf" element={<ConferenciaPDF {...props} />} />
        </Routes>
      </div>
    </div>
  )
}

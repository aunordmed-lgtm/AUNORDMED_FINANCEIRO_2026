import { supabase, getUser } from './supabase'

// E-mail de quem está logado (ou null, se não der para saber).
export async function emailLogado() {
  try { const { data } = await getUser(); return data?.user?.email || null } catch (e) { return null }
}

// Grava um evento na trilha de auditoria. Nunca trava a ação principal se falhar.
export async function registrarAuditoria(acao, registroId, dados, tabela = 'notas_fiscais') {
  try {
    await supabase.from('auditoria').insert({
      usuario_email: await emailLogado(), acao, tabela, registro_id: String(registroId), dados,
    })
  } catch (e) { /* auditoria é complementar: ignora falha */ }
}

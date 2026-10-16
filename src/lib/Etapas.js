// Etapas do ciclo Order-to-Cash de uma nota fiscal.
// "etapa" é um campo à parte do "status" (Emitida / Recebida / Paga ao médico):
// o status continua alimentando todos os relatórios; a etapa diz em que ponto do
// ciclo a nota está agora, quem mexeu por último e quando.
export const ETAPAS = {
  emitida: '📄 Emitida',
  aguardando_aprovacao: '🕒 Aguardando medição/aprovação',
  em_cobranca: '📣 Em cobrança',
  em_divergencia: '⚠️ Em divergência (glosa/retenção)',
  recebida: '💰 Recebida',
  repassada: '💸 Repassada ao médico',
  encerrada: '✅ Competência encerrada',
}

export const ORDEM_ETAPAS = Object.keys(ETAPAS)

// Se a nota ainda não tem etapa registrada (notas antigas), deduz pelo status.
export function etapaEfetiva(nota) {
  if (!nota) return 'emitida'
  if (nota.etapa && ETAPAS[nota.etapa]) return nota.etapa
  if (nota.status === 'Paga ao médico') return 'repassada'
  if (nota.status === 'Recebida') return 'recebida'
  return 'emitida'
}

// Etapa que corresponde a cada status, usada quando o status é trocado na lista.
export function etapaDoStatus(status) {
  if (status === 'Paga ao médico') return 'repassada'
  if (status === 'Recebida') return 'recebida'
  return 'emitida'
}

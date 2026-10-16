// Regras de "exceção de recebimento", compartilhadas pela tela de Exceções e pelo
// contador do menu, para os dois sempre concordarem.

export const MOTIVOS_DIVERGENCIA = {
  iss_retido: 'ISS retido pelo tomador',
  glosa: 'Glosa',
  retencao_federal: 'Retenção federal',
  pagamento_parcial: 'Pagamento parcial',
  desconto_comercial: 'Desconto comercial',
  erro_valor: 'Erro de valor',
  outro: 'Outro (descrever)',
}

// Valor que deveria ter entrado: o calculado pelas regras do tomador, quando existe;
// senão, o "recebido" padrão da nota (bruto menos 6,15%), que é o que o sistema já usava.
export function esperadoEfetivo(n) {
  if (n.valor_esperado_recebimento != null) return Number(n.valor_esperado_recebimento)
  return Number(n.recebido || 0)
}

// Diferença = recebido de fato - esperado. Negativa = recebeu a menos.
// Só existe quando o "valor recebido real" foi informado na nota.
export function diferencaRecebimento(n) {
  if (n.valor_recebido_real == null || n.valor_recebido_real === '') return null
  const esp = esperadoEfetivo(n)
  if (!esp) return null
  return Number(n.valor_recebido_real) - esp
}

export function emExcecao(n) {
  const d = diferencaRecebimento(n)
  // Compara em centavos inteiros: evita que 1 centavo vire exceção por arredondamento.
  return d != null && Math.round(Math.abs(d) * 100) > 1
}

// Exceção ainda sem motivo registrado: é o que entra na fila de pendências.
export function excecaoPendente(n) {
  return emExcecao(n) && !n.motivo_divergencia
}

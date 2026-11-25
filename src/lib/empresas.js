// Empresas atendidas pelo sistema. Cada uma usa um schema próprio no MESMO Supabase:
//   2HT0 → schema "public"   |   2HT1 → schema "ht1"
// A empresa escolhida fica salva no navegador e o app recarrega ao trocar.

export const EMPRESAS = [
  {
    id: '2HT0',
    schema: 'public',
    nome: 'AUNORDMED 2HT0',
    razao: 'AUNORDMED 2HT0 LTDA',
    cnpj: '60577717000122',
    // Conta usada no CNAB 240 (Banco Inter)
    banco: { agencia: '00001', conta: '000044349336', dv: '7', nomeCnab: 'AUNORDMED LTDA' },
  },
  {
    id: '2HT1',
    schema: 'ht1',
    nome: 'AUNORDMED 2HT1',
    razao: 'AUNORDMED 2HT1 LTDA',
    cnpj: '61892199000102',
    banco: null, // preencher agência/conta da 2HT1 para liberar o CNAB 240
  },
]

const STORAGE_KEY = 'am_empresa'

function lerSalva() {
  try { return localStorage.getItem(STORAGE_KEY) } catch (e) { return null }
}

function padraoDoAmbiente() {
  // Mantém compatibilidade com deploys antigos que fixavam o schema por variável de ambiente
  const schema = process.env.REACT_APP_SUPABASE_SCHEMA
  const porSchema = schema && EMPRESAS.find(e => e.schema === schema)
  return (porSchema || EMPRESAS[0]).id
}

export function getEmpresaAtual() {
  // Permite abrir direto numa empresa: ?empresa=2HT1
  let id = null
  try {
    const p = new URLSearchParams(window.location.search).get('empresa')
    if (p) {
      id = p.toUpperCase()
      if (EMPRESAS.some(e => e.id === id)) {
        try { localStorage.setItem(STORAGE_KEY, id) } catch (e) {}
      }
    }
  } catch (e) {}
  if (!id) id = lerSalva() || padraoDoAmbiente()
  return EMPRESAS.find(e => e.id === id) || EMPRESAS[0]
}

export function trocarEmpresa(id) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch (e) {}
  window.location.href = '/'
}

export const formatCNPJ = c =>
  String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

// Chave das configurações locais (WhatsApp, impostos...) separada por empresa.
// A 2HT0 continua usando a chave antiga para não perder o que já estava salvo.
export function cfgKey() {
  const e = getEmpresaAtual()
  return e.id === '2HT0' ? 'am_cfg4' : `am_cfg4_${e.id}`
}

import { createClient } from '@supabase/supabase-js'
import { getEmpresaAtual } from './empresas'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY
// 2HT0 usa "public"; a 2HT1 usa o schema "ht1" no mesmo Supabase.
// O schema vem da empresa selecionada no menu lateral (ver lib/empresas.js).
export const empresaAtual = getEmpresaAtual()
const supabaseSchema = empresaAtual.schema

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: supabaseSchema },
})

// Auth helpers
export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password })

export const signOut = () => supabase.auth.signOut()

export const getUser = () => supabase.auth.getUser()

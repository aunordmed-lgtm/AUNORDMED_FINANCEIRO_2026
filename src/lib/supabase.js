import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY
// 2HT0 usa "public"; a 2HT1 usa o schema "ht1" no mesmo Supabase (REACT_APP_SUPABASE_SCHEMA=ht1).
const supabaseSchema = process.env.REACT_APP_SUPABASE_SCHEMA || 'public'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: supabaseSchema },
})

// Auth helpers
export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password })

export const signOut = () => supabase.auth.signOut()

export const getUser = () => supabase.auth.getUser()

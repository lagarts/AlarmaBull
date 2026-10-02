import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../config/env'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  }
  return client
}

export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Supabase no está configurado. Completá el archivo .env.')
  }
  return supabase
}

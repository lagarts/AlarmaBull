export const APP_NAME = 'Alarma Vecinal'

const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseUrl = rawUrl && /^https?:\/\//.test(rawUrl) ? rawUrl : undefined
export const supabaseAnonKey = rawKey && rawKey.length > 20 ? rawKey : undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const appUrl = import.meta.env.VITE_APP_URL?.trim() || window.location.origin

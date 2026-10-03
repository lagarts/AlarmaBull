import { requireSupabase } from '../lib/supabase'

/** Error de aplicación con mensaje apto para el usuario (en español). */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

const GENERIC = 'No pudimos completar la operación. Intentá de nuevo en unos segundos.'

function translate(raw: string): string {
  const message = raw.toLowerCase()
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'No tenés permiso para realizar esta acción.'
  }
  if (message.includes('duplicate key')) return 'Esa operación ya se había realizado.'
  if (message.includes('network') || message.includes('failed to fetch')) {
    return 'Sin conexión con el servidor. Revisá tu internet.'
  }
  return raw.trim() || GENERIC
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const raw = String((error as { message: unknown }).message)
    if (raw.includes('PGRST')) return new AppError(GENERIC)
    return new AppError(translate(raw))
  }
  if (error instanceof Error && error.message) return new AppError(translate(error.message))
  return new AppError(GENERIC)
}

/** Llama a una RPC y devuelve su resultado. Lanza AppError con mensaje en español. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) throw toAppError(error)
  return data as T
}

/** Igual que rpc, pero devuelve null si no hay sesión (para hooks al montar). */
export async function rpcOrNull<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null
  return rpc<T>(fn, args)
}

/** Mensaje de error listo para mostrar en la UI. */
export function errorMessage(error: unknown): string {
  return toAppError(error).message
}

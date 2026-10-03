import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'
import type { MyProfile } from './types'

export async function getMyProfile(): Promise<MyProfile | null> {
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, suspended, suspended_reason, created_at')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (error) throw toAppError(error)
  return (data as MyProfile | null) ?? null
}

export function updateMyProfile(fullName: string, phone: string): Promise<void> {
  return rpc<void>('update_own_profile', { p_full_name: fullName, p_phone: phone })
}

export async function changePassword(newPassword: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw toAppError(error)
}

export async function resendConfirmation(email: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) throw toAppError(error)
}

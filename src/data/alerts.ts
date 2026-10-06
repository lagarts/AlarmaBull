import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'
import type { AlertRecipientRow, AlertRow, AlertSeverity, TriggerAlertResult } from './types'

/**
 * Dispara la alarma (`alerta`) o un aviso de precaución con mensaje.
 * La clave de idempotencia evita dobles envíos y el cooldown se aplica
 * por separado para cada severidad en el servidor.
 */
export function triggerAlert(
  communityId: string,
  idempotencyKey: string,
  coords?: { latitude: number; longitude: number } | null,
  severity: AlertSeverity = 'alerta',
  message?: string | null,
): Promise<TriggerAlertResult> {
  return rpc<TriggerAlertResult>('trigger_alert', {
    p_community_id: communityId,
    p_idempotency_key: idempotencyKey,
    p_latitude: coords?.latitude ?? null,
    p_longitude: coords?.longitude ?? null,
    p_severity: severity,
    p_message: message ?? null,
  })
}

export async function listAlerts(communityId: string, limit = 50): Promise<AlertRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('alerts')
    .select('*, triggerer:profiles(full_name, address)')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as AlertRow[]
}

export async function getAlert(alertId: string): Promise<AlertRow | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('alerts')
    .select('*, triggerer:profiles(full_name, address)')
    .eq('id', alertId)
    .maybeSingle()
  if (error) throw toAppError(error)
  return data as unknown as AlertRow | null
}

export async function listAlertRecipients(alertId: string): Promise<AlertRecipientRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('alert_recipients')
    .select('*, recipient:profiles(full_name)')
    .eq('alert_id', alertId)
    .order('created_at', { ascending: true })
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as AlertRecipientRow[]
}

/** Marca la alerta como vista por el usuario actual. */
export async function markSeen(recipientRowId: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('alert_recipients')
    .update({ seen_at: new Date().toISOString() })
    .eq('id', recipientRowId)
  if (error) throw toAppError(error)
}

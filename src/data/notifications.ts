import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'
import type { AppNotification } from './types'

/**
 * Pide a la Edge Function `trigger-alert` que envíe los Web Push de la alerta
 * a los destinatarios (`alert_recipients` → `push_subscriptions`).
 *
 * Nunca lanza: un fallo al notificar no debe romper la UI de la alarma.
 * El registro de éxitos/fallos por destinatario vive en `notification_jobs`.
 */
export async function dispatchAlertPush(alertId: string): Promise<void> {
  if (!alertId) return
  try {
    const supabase = requireSupabase()
    const { error } = await supabase.functions.invoke('trigger-alert', {
      body: { alert_id: alertId },
    })
    if (error) throw error
  } catch (error) {
    console.warn('No se pudieron enviar las notificaciones:', toAppError(error).message)
  }
}

/** Últimas notificaciones de la campanita del usuario (RLS: sólo las propias). */
export async function listMyNotifications(limit = 30): Promise<AppNotification[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toAppError(error)
  return (data ?? []) as AppNotification[]
}

/** Marca una notificación propia como leída. */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) throw toAppError(error)
}

/** Marca todas las notificaciones propias como leídas. */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) throw toAppError(error)
}

/**
 * Broadcast del administrador: crea una notificación para cada usuario
 * (`admin_broadcast_notifications`). Devuelve la cantidad de destinatarios.
 */
export function broadcastToAll(title: string, body: string | null): Promise<number> {
  return rpc<number>('admin_broadcast_notifications', {
    p_title: title,
    p_body: body,
  })
}

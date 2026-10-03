import { requireSupabase } from '../lib/supabase'
import { toAppError } from './client'

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

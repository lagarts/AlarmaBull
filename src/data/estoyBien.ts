import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'

export type CheckinStatus = 'disabled' | 'pending' | 'grace' | 'alert' | 'confirmed'

export type CheckinAlertStatus = 'grace' | 'open' | 'resolved' | 'canceled'

export interface CheckinAlert {
  id: string
  status: CheckinAlertStatus
  due_at: string | null
  grace_ends_at: string | null
  opened_at: string | null
  resolved_at: string | null
}

/** Estado del ciclo de hoy, tal como lo devuelve `estoy_bien_get_state`. */
export interface CheckinState {
  enabled: boolean
  status: CheckinStatus
  consented_at: string | null
  cycle_date: string
  reminder_time: string
  grace_minutes: number
  timezone: string
  due_at?: string | null
  grace_ends_at?: string | null
  confirmed_at: string | null
  alert: CheckinAlert | null
  push_enabled: boolean
  contacts_total: number
  contacts_accepted: number
}

export type CheckinContactStatus = 'pending' | 'accepted' | 'declined'

export interface CheckinContact {
  id: string
  full_name: string
  phone: string
  email: string | null
  relationship: string | null
  notify_channel: 'sms' | 'email'
  status: CheckinContactStatus
  /** Cuenta que aceptó el link: si existe, el aviso entra por la app. */
  account_id: string | null
  invite_token: string
  invited_at: string
  consent_at: string | null
  created_at: string
}

export interface CheckinContactInput {
  id?: string | null
  full_name: string
  phone: string
  email?: string | null
  relationship?: string | null
  notify_channel: 'sms' | 'email'
}

export interface CheckinSettingsInput {
  enabled: boolean
  reminder_time: string
  grace_minutes: number
  timezone: string
  consent?: boolean
}

export interface CheckinHistoryEntry {
  cycle_date: string
  confirmed_at: string | null
  alert_status: CheckinAlertStatus | null
  opened_at: string | null
  resolved_at: string | null
}

/** Estado del módulo para el usuario de la sesión. */
export function getCheckinState(): Promise<CheckinState> {
  return rpc<CheckinState>('estoy_bien_get_state')
}

/** Confirma "estoy bien" hoy: idempotente y cierra alertas abiertas. */
export function confirmCheckin(): Promise<CheckinState> {
  return rpc<CheckinState>('estoy_bien_confirm')
}

/** Activa/desactiva y guarda horario, gracia y zona horaria. */
export function saveCheckinSettings(input: CheckinSettingsInput): Promise<CheckinState> {
  return rpc<CheckinState>('estoy_bien_save_settings', {
    p_enabled: input.enabled,
    p_reminder_time: input.reminder_time,
    p_grace_minutes: input.grace_minutes,
    p_timezone: input.timezone,
    p_consent: input.consent ?? false,
  })
}

/** Contactos personales propios (RLS: sólo los del usuario). */
export async function listCheckinContacts(): Promise<CheckinContact[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('estoy_bien_contacts')
    .select(
      'id, full_name, phone, email, relationship, notify_channel, status, account_id, invite_token, invited_at, consent_at, created_at',
    )
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return (data ?? []) as CheckinContact[]
}

/** Alta o edición de un contacto (validado en el servidor). */
export function saveCheckinContact(input: CheckinContactInput): Promise<string> {
  return rpc<string>('estoy_bien_save_contact', {
    p_id: input.id ?? null,
    p_full_name: input.full_name,
    p_phone: input.phone,
    p_email: input.email ?? null,
    p_relationship: input.relationship ?? null,
    p_notify_channel: input.notify_channel,
  })
}

export function deleteCheckinContact(id: string): Promise<void> {
  return rpc<void>('estoy_bien_delete_contact', { p_id: id })
}

/** Genera un link de invitación nuevo (invalida el anterior). */
export function rotateCheckinInvite(id: string): Promise<string> {
  return rpc<string>('estoy_bien_rotate_invite', { p_id: id })
}

/**
 * Respuesta del contacto por el link público (sólo con token).
 * Aceptar exige sesión en la app: así el aviso de alerta le llega a esa
 * cuenta (campanita + push). Rechazar se puede hacer sin cuenta.
 */
export function respondToCheckinInvite(
  token: string,
  accept: boolean,
): Promise<{ ok: boolean; status: string }> {
  return rpc<{ ok: boolean; status: string }>('estoy_bien_contact_respond', {
    p_token: token,
    p_accept: accept,
  })
}

/** Historial: confirmaciones y alertas de los últimos días. */
export async function listCheckinHistory(limit = 30): Promise<CheckinHistoryEntry[]> {
  const supabase = requireSupabase()
  const [checks, alerts] = await Promise.all([
    supabase
      .from('estoy_bien_checks')
      .select('cycle_date, confirmed_at')
      .order('cycle_date', { ascending: false })
      .limit(limit),
    supabase
      .from('estoy_bien_alerts')
      .select('cycle_date, status, opened_at, resolved_at')
      .order('cycle_date', { ascending: false })
      .limit(limit),
  ])
  if (checks.error) throw toAppError(checks.error)
  if (alerts.error) throw toAppError(alerts.error)

  const byDate = new Map<string, CheckinHistoryEntry>()
  for (const row of checks.data ?? []) {
    byDate.set(row.cycle_date, {
      cycle_date: row.cycle_date,
      confirmed_at: row.confirmed_at,
      alert_status: null,
      opened_at: null,
      resolved_at: null,
    })
  }
  for (const row of alerts.data ?? []) {
    const current = byDate.get(row.cycle_date)
    const entry: CheckinHistoryEntry = current ?? {
      cycle_date: row.cycle_date,
      confirmed_at: null,
      alert_status: null,
      opened_at: null,
      resolved_at: null,
    }
    entry.alert_status = row.status as CheckinAlertStatus
    entry.opened_at = row.opened_at
    entry.resolved_at = row.resolved_at
    byDate.set(row.cycle_date, entry)
  }

  return [...byDate.values()].sort((a, b) => b.cycle_date.localeCompare(a.cycle_date))
}

/** Alertas en gracia/abiertas de todo el sistema (panel admin). */
export interface AdminCheckinAlert {
  alert_id: string
  user_id: string
  full_name: string | null
  email: string | null
  cycle_date: string
  status: CheckinAlertStatus
  opened_at: string | null
}

export function listAdminCheckinAlerts(limit = 50): Promise<AdminCheckinAlert[]> {
  return rpc<AdminCheckinAlert[]>('admin_checkin_alerts', { p_limit: limit })
}

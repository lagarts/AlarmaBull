import { rpc } from './client'
import type { AdminMetrics, AdminPaymentRow, AdminUserRow } from './types'

export function getAdminMetrics(): Promise<AdminMetrics> {
  return rpc<AdminMetrics>('admin_metrics')
}

export function listAdminUsers(limit = 50, offset = 0): Promise<AdminUserRow[]> {
  return rpc<AdminUserRow[]>('admin_users', { p_limit: limit, p_offset: offset })
}

export function listAdminPayments(limit = 50): Promise<AdminPaymentRow[]> {
  return rpc<AdminPaymentRow[]>('admin_payment_events', { p_limit: limit })
}

export function setPlanPrice(planId: string, priceArs: number): Promise<void> {
  return rpc<void>('admin_set_plan_price', { p_plan_id: planId, p_price_ars: priceArs })
}

export function setPlan(planId: string, trialDays: number, active: boolean): Promise<void> {
  return rpc<void>('admin_set_plan', { p_plan_id: planId, p_trial_days: trialDays, p_active: active })
}

export function setUserSuspended(userId: string, suspended: boolean, reason: string | null): Promise<void> {
  return rpc<void>('admin_set_user_suspended', {
    p_user_id: userId,
    p_suspended: suspended,
    p_reason: reason,
  })
}

/** Suscripción gratis para siempre (sin cobro ni vencimiento). */
export function setSubscriptionFree(userId: string): Promise<void> {
  return rpc<void>('admin_set_subscription_free', { p_user_id: userId })
}

/** Elimina el usuario de raíz (perfil, comunidad, alertas, suscripción). */
export function deleteUser(userId: string): Promise<void> {
  return rpc<void>('admin_delete_user', { p_user_id: userId })
}

export interface EmergencyContactInput {
  serviceType: string
  phoneNumber: string
  label?: string | null
  province?: string | null
  locality?: string | null
  sourceUrl?: string | null
}

/** Alta/edición por clave natural (país + zona + tipo). Devuelve el id. */
export function upsertEmergencyContact(input: EmergencyContactInput): Promise<string> {
  return rpc<string>('admin_upsert_emergency_contact', {
    p_service_type: input.serviceType,
    p_phone_number: input.phoneNumber,
    p_label: input.label ?? null,
    p_province: input.province ?? null,
    p_locality: input.locality ?? null,
    p_source_url: input.sourceUrl ?? null,
  })
}

export function setEmergencyContactActive(id: string, active: boolean): Promise<void> {
  return rpc<void>('admin_set_emergency_contact_active', { p_id: id, p_active: active })
}

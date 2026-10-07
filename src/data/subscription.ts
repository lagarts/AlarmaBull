import { requireSupabase } from '../lib/supabase'
import { rpc, toAppError } from './client'
import type { AdminPaymentRow, MySubscription, PlanInfo } from './types'

export function getMySubscription(): Promise<MySubscription | null> {
  return rpc<MySubscription | null>('get_my_subscription')
}

export async function listActivePlans(): Promise<PlanInfo[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('id, name, price_ars, trial_days, features')
    .eq('active', true)
    .order('price_ars', { ascending: true })
  if (error) throw toAppError(error)
  return (data ?? []) as PlanInfo[]
}

/** Todos los planes, incluidos los inactivos (sólo el admin los ve). */
export async function listAllPlans(): Promise<PlanInfo[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('id, name, price_ars, trial_days, features, active')
    .order('created_at', { ascending: true })
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as PlanInfo[]
}

export async function listMyPayments(limit = 20): Promise<AdminPaymentRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('payment_events')
    .select(
      'id, provider, provider_payment_id, event_type, amount_ars, status, provider_event_id, created_at, user_subscription_id',
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as AdminPaymentRow[]
}

export interface CheckoutSession {
  init_point: string
  preapproval_id: string
  environment: string
}

export interface CancelSubscriptionResult {
  canceled: boolean
  cancel_at_period_end: boolean
}

/** Crea la suscripción en Mercado Pago vía Edge Function. */
export async function startCheckout(): Promise<CheckoutSession> {
  return invokeMercadoPagoFunction<CheckoutSession>(
    'No pudimos iniciar el pago. Intentá de nuevo en unos segundos.',
  )
}

/** Cancela el débito automático de la suscripción (FASE 16). */
export async function cancelMySubscription(): Promise<CancelSubscriptionResult> {
  return invokeMercadoPagoFunction<CancelSubscriptionResult>(
    'No pudimos cancelar la suscripción. Intentá de nuevo en unos segundos.',
    { action: 'cancel' },
  )
}

async function invokeMercadoPagoFunction<T>(
  fallback: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.functions.invoke(
    'mercadopago-create',
    body ? { body } : undefined,
  )
  if (error) {
    const context = (error as { context?: Response }).context
    const message = context ? await readErrorMessage(context) : null
    throw new Error(message || fallback)
  }
  return data as T
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: string; error?: string }
    return body.message || body.error || null
  } catch {
    return null
  }
}

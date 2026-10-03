import { rpc } from '../data/client'

export type PushStatus = 'unsupported' | 'default' | 'granted' | 'denied'

const base64ToUint8 = (value: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const output = new Uint8Array(buffer)
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getPushStatus(): PushStatus {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission as PushStatus
}

function vapidPublicKey(): string {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  if (!key) {
    throw new Error('Falta configurar la clave VAPID (VITE_VAPID_PUBLIC_KEY) en el servidor.')
  }
  return key
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) {
    throw new Error('Este navegador no admite notificaciones push.')
  }
  const scope = import.meta.env.BASE_URL || '/'
  const existing = await navigator.serviceWorker.getRegistration(scope)
  if (existing) return existing
  try {
    return await navigator.serviceWorker.register(`${scope}sw.js`, { scope })
  } catch {
    throw new Error('Las notificaciones push están disponibles en la versión publicada.')
  }
}

/** Registro existente sin intentar instalar el SW (nunca lanza). */
async function findRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  const scope = import.meta.env.BASE_URL || '/'
  try {
    return (await navigator.serviceWorker.getRegistration(scope)) ?? null
  } catch {
    return null
  }
}

/** Activa las notificaciones push para este dispositivo. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones denegado. Activalo en la configuración del navegador.')
  }

  const registration = await getRegistration()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8(vapidPublicKey()),
  })

  const payload = subscription.toJSON()
  await rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_subscription: payload as unknown as Record<string, unknown>,
    p_user_agent: navigator.userAgent,
  })
}

/** Desactiva las notificaciones push de este dispositivo. */
export async function disablePush(): Promise<void> {
  const registration = await findRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await rpc('revoke_push_subscription', { p_endpoint: endpoint })
}

/** Estado actual de la suscripción push de este dispositivo. */
export async function hasActivePush(): Promise<boolean> {
  const registration = await findRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return Boolean(subscription)
}

/** Dispara una notificación local (pruebas sin servidor). */
export function notifyLocal(title: string, body: string): void {
  if (getPushStatus() === 'granted') {
    new Notification(title, { body, icon: '/icons/icon-192.png' })
  }
}

/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

const DEFAULT_URL = '/inicio'

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/functions\//, /^\/webhooks\//],
  }),
)

interface PushPayload {
  title?: unknown
  body?: unknown
  url?: unknown
  tag?: unknown
}

function readPayload(data: PushMessageData | null): PushPayload {
  if (!data) return {}
  try {
    const parsed: unknown = data.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as PushPayload
  } catch {
    // No era JSON: se intenta usar el texto plano como cuerpo.
  }
  try {
    const text = data.text().trim()
    return text ? { body: text } : {}
  } catch {
    return {}
  }
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return DEFAULT_URL
  try {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin) return DEFAULT_URL
    return `${url.pathname}${url.search}${url.hash}` || DEFAULT_URL
  } catch {
    return DEFAULT_URL
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event.data)
  const title =
    typeof payload.title === 'string' && payload.title.trim() ? payload.title : '¡Alerta vecinal!'
  const body = typeof payload.body === 'string' ? payload.body : ''
  const url = safeUrl(payload.url)
  const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : undefined
  const options: NotificationOptions = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-maskable-512.png',
    data: { url },
  }
  if (tag) options.tag = tag
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  const raw: unknown = event.notification.data
  const data = raw && typeof raw === 'object' ? (raw as { url?: unknown }) : {}
  const target = safeUrl(data.url)
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if (safeUrl(client.url) === target) {
          await client.focus()
          return
        }
      }
      const opened = await self.clients.openWindow(target)
      if (opened) await opened.focus()
    })(),
  )
})

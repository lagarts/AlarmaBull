import { registerSW } from 'virtual:pwa-register'

export function registerPwa(): void {
  if (!import.meta.env.PROD) return
  registerSW({
    immediate: true,
    onRegisterError(error: unknown) {
      console.warn('No se pudo registrar el service worker:', error)
    },
  })
}

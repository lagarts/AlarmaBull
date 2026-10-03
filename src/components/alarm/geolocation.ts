export type Coords = { latitude: number; longitude: number }

/**
 * Pide la posición actual con un timeout corto.
 * Devuelve null si no hay soporte, permiso o si tarda demasiado: nunca bloquea la alerta.
 */
export function getCurrentCoords(timeoutMs = 4000): Promise<Coords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

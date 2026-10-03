import { formatDateTime } from '../../lib/datetime'

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
  { unit: 'second', ms: 1_000 },
]

const MAX_RELATIVE_MS = 7 * 86_400_000

/** "Hace 5 minutos" / "en 2 horas"; más viejo que una semana se muestra fecha completa. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  if (abs >= MAX_RELATIVE_MS) return formatDateTime(date)

  const formatter = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })
  for (const { unit, ms } of UNITS) {
    if (abs >= ms) return formatter.format(Math.round(diff / ms), unit)
  }
  return 'hace un momento'
}

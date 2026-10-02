const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires'
const DEFAULT_LOCALE = 'es-AR'

function toDate(value: string | Date): Date | null {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? null : date
}

export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

export function formatDateTime(
  value: string | Date | null | undefined,
  options: { timeZone?: string; locale?: string } = {},
): string {
  if (!value) return '—'
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timeZone ?? getUserTimeZone(),
  }).format(date)
}

export function formatDate(
  value: string | Date | null | undefined,
  options: { timeZone?: string; locale?: string } = {},
): string {
  if (!value) return '—'
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    dateStyle: 'long',
    timeZone: options.timeZone ?? getUserTimeZone(),
  }).format(date)
}

export function getDaysLeft(
  target: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!target) return null
  const date = toDate(target)
  if (!date) return null
  const ms = date.getTime() - now.getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export function formatAmountArs(amount: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

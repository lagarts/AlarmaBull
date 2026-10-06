import type { AlertSeverity } from '../../data/types'

/** Pill ámbar que sólo aparece en los avisos de precaución. */
export function AlertSeverityPill({ severity }: { severity?: AlertSeverity }) {
  if (severity !== 'precaucion') return null

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
      Precaución
    </span>
  )
}

export function severityLabel(severity?: AlertSeverity): string {
  return severity === 'precaucion' ? 'Precaución' : 'Alerta vecinal'
}

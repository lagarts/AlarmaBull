import type { AlertStatus } from '../../data/types'

const styles: Record<AlertStatus, { label: string; className: string }> = {
  active: { label: 'Activa', className: 'bg-red-100 text-red-700' },
  resolved: { label: 'Resuelta', className: 'bg-green-100 text-green-800' },
  canceled: { label: 'Cancelada', className: 'bg-gray-200 text-gray-700' },
}

export function alertStatusLabel(status: AlertStatus): string {
  return styles[status].label
}

export function AlertStatusPill({ status }: { status: AlertStatus }) {
  const style = styles[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  )
}

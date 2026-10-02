export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'canceled'
  | 'none'

const labels: Record<SubscriptionStatus, string> = {
  trial: 'Prueba',
  active: 'Suscripción activa',
  past_due: 'Pago pendiente',
  expired: 'Suscripción vencida',
  canceled: 'Cancelada',
  none: 'Sin suscripción',
}

const tones: Record<SubscriptionStatus, string> = {
  trial: 'bg-navy-100 text-navy-800',
  active: 'bg-green-100 text-green-800',
  past_due: 'bg-orange-100 text-orange-800',
  expired: 'bg-red-100 text-red-800',
  canceled: 'bg-gray-200 text-gray-700',
  none: 'bg-gray-100 text-gray-600',
}

export function StatusBadge({
  status,
  className = '',
}: {
  status: SubscriptionStatus
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tones[status]} ${className}`}
    >
      {labels[status]}
    </span>
  )
}

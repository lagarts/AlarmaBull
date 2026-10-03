import { Link } from 'react-router-dom'
import { StatusBadge } from '../ui/StatusBadge'
import { formatDate, getDaysLeft } from '../../lib/datetime'
import type { MySubscription } from '../../data/types'

export function SubscriptionChip({ subscription }: { subscription: MySubscription }) {
  const { status } = subscription
  let detail: string

  if (status === 'trial') {
    const days = subscription.trial_days_left ?? getDaysLeft(subscription.trial_ends_at)
    detail =
      days === null ? 'Prueba' : `Prueba · te quedan ${days} ${days === 1 ? 'día' : 'días'}`
  } else if (status === 'active') {
    detail = subscription.current_period_end
      ? `Activa · próximo cobro ${formatDate(subscription.current_period_end)}`
      : 'Activa'
  } else if (status === 'none') {
    detail = 'Sin suscripción'
  } else {
    detail = 'Suscripción vencida'
  }

  const needsPlan = status !== 'active' && status !== 'trial'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <StatusBadge status={status} />
      <span className="text-sm text-navy-600">{detail}</span>
      {needsPlan && (
        <Link
          to="/suscripcion"
          className="text-sm font-semibold text-av-blue underline underline-offset-2"
        >
          Ver planes
        </Link>
      )}
    </div>
  )
}

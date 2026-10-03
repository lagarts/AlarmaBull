import type { MySubscription } from '../../data/types'
import { formatDate, getDaysLeft } from '../../lib/datetime'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { Notice } from '../ui/Feedback'
import { StatusBadge } from '../ui/StatusBadge'

type CurrentStatusCardProps = {
  subscription: MySubscription | null
  checkoutPending: boolean
  onCheckout: () => void
}

const renewCopy: Record<string, string> = {
  none: 'Todavía no tenés una suscripción. Suscribite para alertar a tus vecinos cuando lo necesites.',
  expired: 'Tu suscripción venció. Renová para volver a alertar a los vecinos de tu comunidad.',
  past_due: 'Hay un pago pendiente de acreditación. Si el pago se rechaza, la suscripción se vence.',
  canceled: 'Tu suscripción fue cancelada. Renová para volver a recibir alertas.',
}

function trialDetail(subscription: MySubscription): string {
  const ends = formatDate(subscription.trial_ends_at)
  const days = subscription.trial_days_left ?? getDaysLeft(subscription.trial_ends_at)
  if (days === null) return 'Tu prueba está activa.'
  if (days === 0) return `Tu prueba termina el ${ends} · Hoy`
  return `Tu prueba termina el ${ends} · te quedan ${days} ${days === 1 ? 'día' : 'días'}`
}

function activeDetail(subscription: MySubscription): string {
  if (!subscription.current_period_end) return 'Tu suscripción está activa.'
  return `Próximo cobro ${formatDate(subscription.current_period_end)}`
}

export function CurrentStatusCard({
  subscription,
  checkoutPending,
  onCheckout,
}: CurrentStatusCardProps) {
  const status = subscription?.status ?? 'none'
  const needsRenew = Boolean(renewCopy[status])
  const ctaLabel = status === 'none' ? 'Suscribirme' : 'Renovar'

  let detail = ''
  if (subscription && status === 'trial') detail = trialDetail(subscription)
  if (subscription && status === 'active') detail = activeDetail(subscription)

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Estado actual</h2>
          <StatusBadge status={status} />
        </div>

        {detail && <p className="text-sm text-navy-600">{detail}</p>}

        {subscription?.cancel_at_period_end && status === 'active' && (
          <Notice tone="warning">Se cancela al finalizar el período.</Notice>
        )}

        {needsRenew && (
          <Notice tone="warning">
            <p>{renewCopy[status]}</p>
            <div className="mt-3">
              <Button size="sm" loading={checkoutPending} onClick={onCheckout}>
                {ctaLabel}
              </Button>
            </div>
          </Notice>
        )}
      </CardBody>
    </Card>
  )
}

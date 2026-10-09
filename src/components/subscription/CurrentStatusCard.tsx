import { useState } from 'react'
import type { MySubscription } from '../../data/types'
import { formatDate, getDaysLeft } from '../../lib/datetime'
import { ConfirmDialog } from '../alarm/ConfirmDialog'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { Notice } from '../ui/Feedback'
import { StatusBadge } from '../ui/StatusBadge'

type CurrentStatusCardProps = {
  subscription: MySubscription | null
  checkoutPending: boolean
  onCheckout: () => void
  cancelPending?: boolean
  cancelError?: string | null
  onCancel?: () => void
}

const renewCopy: Record<string, string> = {
  none: 'Todavía no tenés una suscripción. Suscribite para alertar a tus vecinos cuando lo necesites.',
  expired: 'Tu suscripción venció. Renová para volver a alertar a los vecinos de tu grupo.',
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

function formatPrice(price: number | null | undefined): string {
  if (!price || price <= 0) return 'el importe del plan'
  return `$ ${price.toLocaleString('es-AR')}`
}

export function CurrentStatusCard({
  subscription,
  checkoutPending,
  onCheckout,
  cancelPending = false,
  cancelError = null,
  onCancel,
}: CurrentStatusCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const status = subscription?.status ?? 'none'
  const needsRenew = Boolean(renewCopy[status])
  const ctaLabel = status === 'none' ? 'Suscribirme' : 'Renovar'
  const canCancel =
    status === 'active' &&
    subscription?.provider === 'mercadopago' &&
    !subscription?.cancel_at_period_end &&
    Boolean(onCancel)

  let detail = ''
  if (subscription && status === 'trial') detail = trialDetail(subscription)
  if (subscription && status === 'active') detail = activeDetail(subscription)

  const cancelMessage = subscription?.current_period_end
    ? `Vas a dejar de pagar con débito automático. Tu suscripción sigue activa hasta el ${formatDate(
        subscription.current_period_end,
      )} y después se cancela.`
    : 'Vas a dejar de pagar con débito automático. Tu suscripción se cancela enseguida.'

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Estado actual</h2>
          <StatusBadge status={status} />
        </div>

        {detail && <p className="text-sm text-navy-600">{detail}</p>}

        {subscription &&
          status === 'active' &&
          subscription.provider === 'mercadopago' &&
          !subscription.cancel_at_period_end && (
          <p className="text-sm text-navy-600">
            Débito automático: Mercado Pago debita{' '}
            <span className="font-semibold text-navy-900">
              {formatPrice(subscription.plan?.price_ars)}
            </span>{' '}
            todos los meses.
          </p>
        )}

        {subscription?.cancel_at_period_end && status === 'active' && (
          <Notice tone="warning">Se cancela al finalizar el período.</Notice>
        )}

        {cancelError && <Notice tone="danger">{cancelError}</Notice>}

        {canCancel && (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            Cancelar suscripción
          </Button>
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

      <ConfirmDialog
        open={confirmOpen}
        title="Cancelar la suscripción"
        message={cancelMessage}
        confirmLabel="Sí, cancelar"
        cancelLabel="Volver"
        pending={cancelPending}
        onConfirm={() => {
          setConfirmOpen(false)
          onCancel?.()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  cancelMySubscription,
  listActivePlans,
  listMyPayments,
  startCheckout,
} from '../data'
import type { AdminPaymentRow, PlanInfo } from '../data/types'
import { useAction, useAsync } from '../hooks/useAsync'
import { useSubscription } from '../hooks/useCommunity'
import { CurrentStatusCard } from '../components/subscription/CurrentStatusCard'
import { PaymentHistoryCard } from '../components/subscription/PaymentHistoryCard'
import { PlanCard } from '../components/subscription/PlanCard'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'

export function SubscriptionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [resultado] = useState<string | null>(() => searchParams.get('resultado'))
  const subscriptionQuery = useSubscription()
  const plansQuery = useAsync<PlanInfo[]>(() => listActivePlans(), [])
  const paymentsQuery = useAsync<AdminPaymentRow[]>(() => listMyPayments(), [])
  const checkout = useAction(async () => startCheckout())
  const cancel = useAction(async () => cancelMySubscription())

  // Al volver del checkout de Mercado Pago (?resultado=exito|fallo|pendiente)
  // el parámetro se consume una sola vez y se limpia de la URL.
  useEffect(() => {
    if (searchParams.toString()) setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Con "exito" la webhook activa la suscripción en pocos segundos: se recarga
  // una vez automáticamente y, si hace falta, queda el botón manual.
  useEffect(() => {
    if (resultado !== 'exito') return
    const timer = window.setTimeout(() => subscriptionQuery.reload(), 5000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado])

  const reloadAll = () => {
    subscriptionQuery.reload()
    plansQuery.reload()
    paymentsQuery.reload()
  }

  const loading = subscriptionQuery.loading || plansQuery.loading || paymentsQuery.loading
  const error = subscriptionQuery.error ?? plansQuery.error ?? paymentsQuery.error

  if (loading) return <Spinner label="Cargando tu suscripción…" />
  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Suscripción" />
        <ErrorState
          title="No pudimos cargar tu suscripción"
          description={error}
          onRetry={reloadAll}
        />
      </div>
    )
  }

  const subscription = subscriptionQuery.data
  const status = subscription?.status ?? 'none'
  const plans = plansQuery.data ?? []
  const plansToShow = subscription?.plan ? [subscription.plan] : plans
  const payments = paymentsQuery.data ?? []
  const ctaLabel = status === 'none' ? 'Suscribirme' : 'Renovar'

  const handleCheckout = async () => {
    const session = await checkout.run()
    if (session?.init_point) window.location.assign(session.init_point)
  }

  const handleCancel = async () => {
    const result = await cancel.run()
    if (result) subscriptionQuery.reload()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Suscripción"
        subtitle="Tu estado de pago, tu plan y el historial de cobros."
      />

      {resultado === 'exito' && (
        <Notice tone="success">
          <p>
            Mercado Pago recibió tu pago. La suscripción se activa apenas confirmemos el cobro; si
            sigue igual, tocá “Actualizar estado”.
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={reloadAll}>
              Actualizar estado
            </Button>
          </div>
        </Notice>
      )}

      {resultado === 'pendiente' && (
        <Notice tone="warning">
          Tu pago está pendiente de acreditación. Te lo confirmamos apenas Mercado Pago lo acredite.
        </Notice>
      )}

      {resultado === 'fallo' && (
        <Notice tone="danger">
          El pago no se completó. Podés intentarlo de nuevo cuando quieras.
        </Notice>
      )}

      <CurrentStatusCard
        subscription={subscription}
        checkoutPending={checkout.pending}
        onCheckout={() => void handleCheckout()}
        cancelPending={cancel.pending}
        cancelError={cancel.error}
        onCancel={() => void handleCancel()}
      />

      {plansToShow.length === 0 ? (
        <EmptyState
          title="Todavía no hay planes disponibles"
          description="Pronto vas a poder ver las opciones de suscripción."
        />
      ) : (
        plansToShow.map((plan) => <PlanCard key={plan.id} plan={plan} />)
      )}

      <Card>
        <CardBody className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-navy-900">Acciones</h2>
            <p className="mt-1 text-sm text-navy-600">
              {status === 'active'
                ? 'La suscripción se renueva sola: Mercado Pago debita el importe todos los meses.'
                : 'El pago se realiza de forma segura con Mercado Pago.'}
            </p>
          </div>

          {checkout.error && <Notice tone="danger">{checkout.error}</Notice>}

          {status !== 'active' && (
            <Button
              className="w-full sm:w-auto"
              loading={checkout.pending}
              onClick={() => void handleCheckout()}
            >
              {ctaLabel}
            </Button>
          )}
        </CardBody>
      </Card>

      <PaymentHistoryCard payments={payments} />
    </div>
  )
}

import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useAsync } from '../hooks/useAsync'
import { getAlert, listAlertRecipients, markSeen } from '../data'
import type { AlertRecipientRow, AlertRow } from '../data/types'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Spinner } from '../components/ui/Feedback'
import { AlertStatusPill, alertStatusLabel } from '../components/alarm/AlertStatusPill'
import { formatDateTime } from '../lib/datetime'

const linkButtonClass =
  'inline-flex items-center justify-center rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-800'

const DELIVERY_LABELS: Record<AlertRecipientRow['delivery_status'], string> = {
  pending: 'Pendiente',
  sending: 'Enviando',
  sent: 'Enviada',
  skipped: 'Omitida',
  failed: 'Falló',
}

function deliveryLabel(status: AlertRecipientRow['delivery_status']): string {
  return DELIVERY_LABELS[status] ?? status
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-navy-900">{value}</dd>
    </div>
  )
}

function BlockedAlertState({ description }: { description?: string | null }) {
  return (
    <EmptyState
      title="No podés ver esta alerta"
      description={description ?? 'La alerta no existe o fue eliminada.'}
      action={
        <Link to="/alertas" className={linkButtonClass}>
          Ver historial de alertas
        </Link>
      }
    />
  )
}

export function AlertDetailPage() {
  const { alertId } = useParams()
  const { user } = useAuth()

  const alertState = useAsync<AlertRow | null>(
    () => (alertId ? getAlert(alertId) : Promise.resolve(null)),
    [alertId],
  )
  const recipientsState = useAsync<AlertRecipientRow[] | null>(
    () => (alertId ? listAlertRecipients(alertId) : Promise.resolve(null)),
    [alertId],
  )

  const { data: recipients, setData: setRecipients } = recipientsState

  // El destinatario que nunca vio la alerta la marca como vista al entrar.
  useEffect(() => {
    if (!user || !recipients) return
    const mine = recipients.find(
      (row) => row.recipient_user_id === user.id && row.seen_at === null,
    )
    if (!mine) return

    markSeen(mine.id)
      .then(() => {
        const seenAt = new Date().toISOString()
        setRecipients(
          recipients.map((row) => (row.id === mine.id ? { ...row, seen_at: seenAt } : row)),
        )
      })
      .catch(() => undefined)
  }, [user, recipients, setRecipients])

  if (alertState.loading) return <Spinner label="Cargando alerta…" />

  const alert = alertState.data
  if (!alertId || alertState.error || !alert) {
    return (
      <div className="mx-auto max-w-lg">
        <BlockedAlertState description={alertState.error} />
      </div>
    )
  }

  const location =
    alert.location_latitude !== null && alert.location_longitude !== null
      ? `${alert.location_latitude.toFixed(5)}, ${alert.location_longitude.toFixed(5)}`
      : 'Sin ubicación'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Detalle de alerta"
        subtitle={formatDateTime(alert.created_at)}
        actions={<AlertStatusPill status={alert.status} />}
      />

      <Card>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Fecha y hora" value={formatDateTime(alert.created_at)} />
            <DetailField label="Emisor" value={alert.triggerer?.full_name ?? 'Vecino'} />
            <DetailField label="Estado" value={alertStatusLabel(alert.status)} />
            <DetailField label="Ubicación" value={location} />
            {alert.resolved_at && (
              <DetailField label="Resuelta el" value={formatDateTime(alert.resolved_at)} />
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-base font-bold text-navy-900">Destinatarios</h2>

          <div className="mt-3">
            {recipientsState.loading ? (
              <Spinner label="Cargando destinatarios…" />
            ) : recipientsState.error ? (
              <ErrorState description={recipientsState.error} onRetry={recipientsState.reload} />
            ) : !recipients || recipients.length === 0 ? (
              <EmptyState title="Esta alerta no tiene destinatarios registrados" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Vecino
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Entrega
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        Visto
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {recipients.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3 font-medium text-navy-900">
                          {row.recipient?.full_name ?? 'Vecino'}
                        </td>
                        <td className="py-2.5 pr-3 text-navy-600">
                          {deliveryLabel(row.delivery_status)}
                        </td>
                        <td className="py-2.5 text-navy-600">
                          {row.seen_at ? formatDateTime(row.seen_at) : 'No visto'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

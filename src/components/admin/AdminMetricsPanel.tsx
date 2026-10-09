import { getAdminMetrics } from '../../data'
import type { AdminMetrics } from '../../data/types'
import { useAsync } from '../../hooks/useAsync'
import { formatAmountArs } from '../../lib/datetime'
import { Card, CardBody } from '../ui/Card'
import { ErrorState, Spinner } from '../ui/Feedback'

function metricValue(metrics: AdminMetrics, key: string): number | null {
  const value: unknown = metrics[key]
  return typeof value === 'number' ? value : null
}

function countLabel(metrics: AdminMetrics, key: string): string {
  const value = metricValue(metrics, key)
  return value === null ? '—' : value.toLocaleString('es-AR')
}

function revenueLabel(metrics: AdminMetrics): string {
  const value = metricValue(metrics, 'revenue_month_ars')
  return value === null ? '—' : formatAmountArs(value)
}

export function AdminMetricsPanel() {
  const { data, loading, error, reload } = useAsync<AdminMetrics>(() => getAdminMetrics(), [])

  const items = data
    ? [
        { label: 'Usuarios totales', value: countLabel(data, 'users_total') },
        { label: 'Usuarios suspendidos', value: countLabel(data, 'users_suspended') },
        { label: 'Grupos', value: countLabel(data, 'communities_total') },
        { label: 'Integrantes activos', value: countLabel(data, 'members_active') },
        { label: 'Alertas (30 días)', value: countLabel(data, 'alerts_last_30d') },
        { label: 'Suscripciones en prueba', value: countLabel(data, 'subscriptions_trial') },
        { label: 'Suscripciones activas', value: countLabel(data, 'subscriptions_active') },
        { label: 'Pago vencido', value: countLabel(data, 'subscriptions_past_due') },
        { label: 'Suscripciones vencidas', value: countLabel(data, 'subscriptions_expired') },
        { label: 'Ingresos del mes', value: revenueLabel(data) },
        { label: 'Estoy Bien activos', value: countLabel(data, 'checkin_enabled') },
        { label: 'Confirmaron hoy', value: countLabel(data, 'checkin_confirmed_today') },
        { label: 'Alertas Estoy Bien', value: countLabel(data, 'checkin_alerts_open') },
        { label: 'Push fallidos (Estoy Bien)', value: countLabel(data, 'checkin_push_failed') },
        {
          label: 'Contactos pendientes',
          value: countLabel(data, 'checkin_contacts_pending'),
        },
      ]
    : []

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Métricas</h2>
          {!loading && !error && (
            <button
              type="button"
              onClick={reload}
              className="text-xs font-semibold text-av-blue hover:underline"
            >
              Actualizar
            </button>
          )}
        </div>

        {loading ? (
          <Spinner label="Cargando métricas…" />
        ) : error ? (
          <div className="mt-3">
            <ErrorState description={error} onRetry={reload} />
          </div>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-navy-100 bg-navy-50 px-3 py-2.5"
              >
                <dt className="text-xs font-semibold text-navy-600">{item.label}</dt>
                <dd className="mt-1 text-lg font-bold text-navy-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  )
}

import { Link } from 'react-router-dom'
import { listAdminCheckinAlerts } from '../../data/estoyBien'
import type { AdminCheckinAlert } from '../../data/estoyBien'
import { useAsync } from '../../hooks/useAsync'
import { formatDateTime } from '../../lib/datetime'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Spinner } from '../ui/Feedback'

export function AdminCheckinPanel() {
  const { data, loading, error, reload } = useAsync<AdminCheckinAlert[]>(
    () => listAdminCheckinAlerts(50),
    [],
  )

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Estoy Bien: alertas abiertas</h2>
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

        <div className="mt-3">
          {loading ? (
            <Spinner label="Cargando alertas…" />
          ) : error ? (
            <ErrorState description={error} onRetry={reload} />
          ) : !data || data.length === 0 ? (
            <EmptyState
              title="Sin alertas abiertas"
              description="Ningún usuario está en gracia ni con alerta abierta."
            />
          ) : (
            <ul className="divide-y divide-navy-100">
              {data.map((alert) => (
                <li
                  key={alert.alert_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-navy-900">
                      {alert.full_name ?? 'Sin nombre'}
                    </p>
                    <p className="break-all text-xs text-navy-500">{alert.email ?? '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-navy-700">
                      {alert.status === 'grace' ? 'En gracia' : 'Alerta abierta'}
                    </p>
                    <p className="text-xs text-navy-500">
                      {formatDateTime(alert.opened_at ?? `${alert.cycle_date}T12:00:00`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-3 text-xs text-navy-500">
          El módulo se administra desde{' '}
          <Link to="/estoy-bien/configuracion" className="font-semibold underline underline-offset-2">
            Estoy Bien
          </Link>
          .
        </p>
      </CardBody>
    </Card>
  )
}

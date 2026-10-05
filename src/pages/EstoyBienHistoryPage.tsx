import { Link } from 'react-router-dom'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Spinner } from '../components/ui/Feedback'
import { useAsync } from '../hooks/useAsync'
import { listCheckinHistory } from '../data/estoyBien'
import type { CheckinHistoryEntry } from '../data/estoyBien'
import { formatDate, formatDateTime } from '../lib/datetime'

function entryBadge(entry: CheckinHistoryEntry): { label: string; tone: string } {
  if (entry.confirmed_at) return { label: 'Confirmado', tone: 'bg-green-100 text-green-800' }
  if (entry.alert_status === 'open') return { label: 'Alerta', tone: 'bg-red-100 text-red-800' }
  if (entry.alert_status === 'grace') return { label: 'Sin confirmar', tone: 'bg-orange-100 text-orange-800' }
  if (entry.alert_status === 'resolved') {
    return { label: 'Alerta resuelta', tone: 'bg-navy-100 text-navy-700' }
  }
  if (entry.alert_status === 'canceled') {
    return { label: 'Cancelada', tone: 'bg-navy-100 text-navy-700' }
  }
  return { label: 'Sin datos', tone: 'bg-navy-100 text-navy-700' }
}

export function EstoyBienHistoryPage() {
  const history = useAsync(() => listCheckinHistory(30), [])
  const items = history.data

  return (
    <div>
      <PageHeader
        title="Historial"
        subtitle="Tus últimas confirmaciones y alertas."
        actions={
          <Link to="/estoy-bien" className="text-sm font-semibold text-av-blue hover:underline">
            Volver
          </Link>
        }
      />

      <Card>
        <CardBody>
          {history.loading ? (
            <Spinner label="Cargando historial…" />
          ) : history.error ? (
            <ErrorState description={history.error} onRetry={history.reload} />
          ) : !items || items.length === 0 ? (
            <EmptyState
              title="Todavía no hay historial"
              description="Cuando confirmes tu primer día va a aparecer acá."
            />
          ) : (
            <ul className="divide-y divide-navy-100">
              {items.map((entry) => {
                const badge = entryBadge(entry)
                return (
                  <li key={entry.cycle_date} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-navy-900">
                        {formatDate(`${entry.cycle_date}T12:00:00`)}
                      </p>
                      <p className="text-xs text-navy-500">
                        {entry.confirmed_at
                          ? `Confirmado ${formatDateTime(entry.confirmed_at)}`
                          : entry.opened_at
                            ? `Alerta ${formatDateTime(entry.opened_at)}`
                            : 'Sin confirmación'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${badge.tone}`}
                    >
                      {badge.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

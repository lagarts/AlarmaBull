import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Spinner } from '../components/ui/Feedback'
import { useAsync } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { listAlerts } from '../data'
import type { AlertRow } from '../data/types'
import { AlertListItem } from '../components/alarm/AlertListItem'
import { NoCommunityState } from '../components/alarm/NoCommunityState'
import { useAlertsRealtime } from '../components/alarm/useAlertsRealtime'

export function AlertsHistoryPage() {
  const communityState = useMyCommunity()
  const community = communityState.data

  const alertsState = useAsync<AlertRow[] | null>(
    () => (community ? listAlerts(community.community_id, 50) : Promise.resolve(null)),
    [community?.community_id],
  )

  useAlertsRealtime(community?.community_id, alertsState.reload)

  if (communityState.loading) return <Spinner label="Cargando tu comunidad…" />
  if (communityState.error) {
    return <ErrorState description={communityState.error} onRetry={communityState.reload} />
  }
  if (!community) return <NoCommunityState />

  const alerts = alertsState.data

  return (
    <div>
      <PageHeader title="Historial de alertas" subtitle={community.name} />

      {alertsState.loading ? (
        <Spinner label="Cargando alertas…" />
      ) : alertsState.error ? (
        <ErrorState description={alertsState.error} onRetry={alertsState.reload} />
      ) : !alerts || alerts.length === 0 ? (
        <EmptyState title="Todavía no hubo alertas en tu comunidad" />
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-navy-100">
              {alerts.map((alert) => (
                <AlertListItem key={alert.id} alert={alert} />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

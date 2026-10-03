import { Link } from 'react-router-dom'
import { ArrowRightIcon } from '../icons'
import { formatDateTime } from '../../lib/datetime'
import type { AlertRow } from '../../data/types'
import { AlertStatusPill } from './AlertStatusPill'
import { relativeTime } from './relativeTime'

export function AlertListItem({
  alert,
  relative = false,
}: {
  alert: AlertRow
  relative?: boolean
}) {
  const time = relative ? relativeTime(alert.created_at) : formatDateTime(alert.created_at)

  return (
    <li>
      <Link
        to={`/alertas/${alert.id}`}
        className="flex items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-navy-50"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-navy-900">
            {alert.triggerer?.full_name ?? 'Vecino'}
          </p>
          <p className="text-xs text-navy-600">{time}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AlertStatusPill status={alert.status} />
          <ArrowRightIcon className="h-4 w-4 text-navy-400" />
        </div>
      </Link>
    </li>
  )
}

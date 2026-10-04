import { Link } from 'react-router-dom'
import { NotificationsBell } from '../notifications/NotificationsBell'
import { ShieldIcon } from '../icons'

type Tone = 'dark' | 'light'

/**
 * Acciones del encabezado: campanita de notificaciones y, para el
 * administrador, el atajo al panel "Admin".
 */
export function HeaderActions({ isAdmin, tone = 'light' }: { isAdmin?: boolean; tone?: Tone }) {
  const linkClass =
    tone === 'dark'
      ? 'inline-flex h-10 items-center gap-2 rounded-xl bg-white/12 px-3 text-sm font-semibold text-white hover:bg-white/20'
      : 'inline-flex h-10 items-center gap-2 rounded-xl bg-navy-900 px-3 text-sm font-semibold text-white hover:bg-navy-800'

  return (
    <div className="flex items-center gap-2">
      <NotificationsBell tone={tone} />
      {isAdmin && (
        <Link to="/admin" className={linkClass}>
          <ShieldIcon className="h-4 w-4" />
          Admin
        </Link>
      )}
    </div>
  )
}

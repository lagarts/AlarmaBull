import { useEffect, useState } from 'react'
import { listMyNotifications, markAllNotificationsRead, markNotificationRead } from '../../data'
import type { AppNotification } from '../../data/types'
import { useAuth } from '../../context/AuthProvider'
import { useAction, useAsync } from '../../hooks/useAsync'
import { formatDateTime } from '../../lib/datetime'
import { requireSupabase } from '../../lib/supabase'
import { BellIcon } from '../icons'
import { Button } from '../ui/Button'

type Tone = 'dark' | 'light'

const toneClasses: Record<Tone, { button: string; panel: string; item: string; muted: string }> = {
  dark: {
    button: 'text-white hover:bg-white/10',
    panel: 'border-white/10 bg-navy-900 text-white',
    item: 'text-white hover:bg-white/8',
    muted: 'text-navy-200',
  },
  light: {
    button: 'text-navy-700 hover:bg-navy-50',
    panel: 'border-navy-100 bg-white text-navy-900',
    item: 'text-navy-900 hover:bg-navy-50',
    muted: 'text-navy-500',
  },
}

export function NotificationsBell({ tone = 'light' }: { tone?: Tone }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const query = useAsync<AppNotification[]>(() => listMyNotifications(), [])

  const readAction = useAction(async (id: string) => {
    await markNotificationRead(id)
    return true
  })
  const readAllAction = useAction(async () => {
    await markAllNotificationsRead()
    return true
  })

  // Realtime: la campanita se actualiza con la pantalla abierta.
  const reload = query.reload
  useEffect(() => {
    if (!user?.id) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => reload(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, reload])

  const items = query.data ?? []
  const unread = items.filter((item) => !item.read_at).length
  const toneStyle = toneClasses[tone]

  const handleRead = (item: AppNotification) => {
    if (item.read_at) return
    void readAction.run(item.id).then((ok) => {
      if (ok) query.reload()
    })
  }

  const handleReadAll = () => {
    void readAllAction.run().then((ok) => {
      if (ok) query.reload()
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
        aria-expanded={open}
        className={`relative grid h-10 w-10 place-items-center rounded-xl transition-colors ${toneStyle.button}`}
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-av-red px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar notificaciones"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notificaciones"
            className={`absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border shadow-card ${toneStyle.panel}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-inherit px-4 py-3">
              <p className="text-sm font-bold">Notificaciones</p>
              <Button
                size="sm"
                variant={tone === 'dark' ? 'secondary' : 'ghost'}
                onClick={handleReadAll}
                disabled={unread === 0 || readAllAction.pending}
              >
                Marcar todo leído
              </Button>
            </div>

            <ul className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <li className={`px-4 py-6 text-sm ${toneStyle.muted}`}>Todavía no hay notificaciones.</li>
              ) : (
                items.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-inherit last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleRead(item)}
                      className={`w-full px-4 py-3 text-left transition-colors ${toneStyle.item}`}
                    >
                      <span className="flex items-start gap-2">
                        {!item.read_at && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-av-red" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{item.title}</span>
                          {item.body && (
                            <span className={`mt-0.5 block text-xs ${toneStyle.muted}`}>{item.body}</span>
                          )}
                          <span className={`mt-1 block text-[11px] ${toneStyle.muted}`}>
                            {formatDateTime(item.created_at)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

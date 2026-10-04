import { useState } from 'react'
import { deleteUser, listAdminUsers, setSubscriptionFree, setUserSuspended } from '../../data'
import type { AdminUserRow } from '../../data/types'
import { useAuth } from '../../context/AuthProvider'
import { useAction, useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/datetime'
import { subscriptionStatusLabel } from '../subscription/labels'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../ui/Feedback'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { SuspendUserDialog, type SuspendTarget } from './SuspendUserDialog'

function displayName(user: AdminUserRow): string {
  return user.full_name?.trim() || user.email || 'Sin nombre'
}

type DialogTarget = { kind: 'free' | 'delete'; user: AdminUserRow }

export function AdminUsersPanel() {
  const { user } = useAuth()
  const usersQuery = useAsync<AdminUserRow[]>(() => listAdminUsers(), [])
  const [target, setTarget] = useState<SuspendTarget | null>(null)
  const [dialog, setDialog] = useState<DialogTarget | null>(null)

  const suspendAction = useAction(async (userId: string, suspended: boolean, reason: string | null) => {
    await setUserSuspended(userId, suspended, reason)
    return true
  })

  const freeAction = useAction(async (userId: string) => {
    await setSubscriptionFree(userId)
    return true
  })

  const deleteAction = useAction(async (userId: string) => {
    await deleteUser(userId)
    return true
  })

  const users = usersQuery.data ?? []
  const myUserId = user?.id ?? null

  const handleConfirmSuspend = async (reason: string | null) => {
    if (!target) return
    const ok = await suspendAction.run(target.user.user_id, target.suspended, reason)
    if (ok) {
      setTarget(null)
      usersQuery.reload()
    }
  }

  const handleConfirmDialog = async () => {
    if (!dialog) return
    const action = dialog.kind === 'free' ? freeAction : deleteAction
    const ok = await action.run(dialog.user.user_id)
    if (ok) {
      setDialog(null)
      usersQuery.reload()
    }
  }

  const actionButtons = (row: AdminUserRow) => {
    const isMe = myUserId === row.user_id
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={row.suspended ? 'outline' : 'danger'}
          disabled={isMe}
          title={isMe ? 'No podés suspender tu propia cuenta' : undefined}
          onClick={() => {
            suspendAction.clearError()
            setTarget({ user: row, suspended: !row.suspended })
          }}
        >
          {row.suspended ? 'Reactivar' : 'Suspender'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            freeAction.clearError()
            setDialog({ kind: 'free', user: row })
          }}
        >
          Dar gratis
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isMe}
          title={isMe ? 'No podés eliminar tu propia cuenta' : undefined}
          onClick={() => {
            deleteAction.clearError()
            setDialog({ kind: 'delete', user: row })
          }}
        >
          Eliminar
        </Button>
      </div>
    )
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Usuarios</h2>
          <span className="text-xs font-semibold text-navy-600">
            {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
          </span>
        </div>

        {suspendAction.error && (
          <div className="mt-3">
            <Notice tone="danger">{suspendAction.error}</Notice>
          </div>
        )}

        {usersQuery.loading ? (
          <Spinner label="Cargando usuarios…" />
        ) : usersQuery.error ? (
          <div className="mt-3">
            <ErrorState description={usersQuery.error} onRetry={usersQuery.reload} />
          </div>
        ) : users.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hay usuarios registrados" />
          </div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="hidden w-full text-left text-sm sm:table">
                <thead>
                  <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Nombre
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Email
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Suscripción
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Alta
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {users.map((row) => (
                    <tr key={row.user_id}>
                      <td className="py-2.5 pr-3 font-medium text-navy-900">
                        {displayName(row)}
                        {row.suspended && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                            Suspendido
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-navy-600">{row.email ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-navy-600">
                        {subscriptionStatusLabel(row.subscription_status)}
                      </td>
                      <td className="py-2.5 pr-3 text-navy-600">{formatDate(row.created_at)}</td>
                      <td className="py-2.5">{actionButtons(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-3 sm:hidden">
              {users.map((row) => (
                <li
                  key={row.user_id}
                  className="rounded-xl border border-navy-100 bg-navy-50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy-900">
                        {displayName(row)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-navy-600">{row.email ?? '—'}</p>
                    </div>
                    {row.suspended && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                        Suspendido
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-navy-600">
                    <span>{subscriptionStatusLabel(row.subscription_status)}</span>
                    <span>Alta: {formatDate(row.created_at)}</span>
                  </div>
                  <div className="mt-3">{actionButtons(row)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>

      {target && (
        <SuspendUserDialog
          target={target}
          pending={suspendAction.pending}
          error={suspendAction.error}
          onConfirm={(reason) => void handleConfirmSuspend(reason)}
          onCancel={() => {
            suspendAction.clearError()
            setTarget(null)
          }}
        />
      )}

      {dialog && (
        <ConfirmActionDialog
          title={dialog.kind === 'free' ? 'Dar suscripción gratis' : 'Eliminar usuario'}
          description={
            dialog.kind === 'free'
              ? `${displayName(dialog.user)} va a tener la suscripción gratis para siempre, sin cobro ni vencimiento.`
              : `${displayName(dialog.user)} se va a eliminar definitivamente junto con sus datos y su suscripción. Esta acción no se puede deshacer.`
          }
          confirmLabel={dialog.kind === 'free' ? 'Dar gratis' : 'Eliminar'}
          tone={dialog.kind === 'free' ? 'primary' : 'danger'}
          pending={dialog.kind === 'free' ? freeAction.pending : deleteAction.pending}
          error={dialog.kind === 'free' ? freeAction.error : deleteAction.error}
          onConfirm={() => void handleConfirmDialog()}
          onCancel={() => {
            freeAction.clearError()
            deleteAction.clearError()
            setDialog(null)
          }}
        />
      )}
    </Card>
  )
}

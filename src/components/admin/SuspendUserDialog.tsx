import { useState, type FormEvent } from 'react'
import type { AdminUserRow } from '../../data/types'
import { hintClass, inputClass, labelClass } from '../community/fields'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Feedback'

export type SuspendTarget = {
  user: AdminUserRow
  suspended: boolean
}

export function SuspendUserDialog({
  target,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  target: SuspendTarget
  pending: boolean
  error: string | null
  onConfirm: (reason: string | null) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const name = target.user.full_name?.trim() || target.user.email || 'este usuario'
  const suspending = target.suspended

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onConfirm(suspending && reason.trim() ? reason.trim() : null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={suspending ? 'Suspender usuario' : 'Reactivar usuario'}
        className="w-full max-w-md rounded-card border border-navy-100 bg-white p-5 shadow-card"
      >
        <h2 className="text-base font-bold text-navy-900">
          {suspending ? 'Suspender usuario' : 'Reactivar usuario'}
        </h2>
        <p className="mt-2 text-sm text-navy-600">
          {suspending
            ? `¿Suspender a ${name}? Va a perder el acceso hasta que lo reactives.`
            : `¿Reactivar a ${name}? Va a recuperar el acceso a la aplicación.`}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {suspending && (
            <div>
              <label className={labelClass} htmlFor="suspend-reason">
                Motivo (opcional)
              </label>
              <input
                id="suspend-reason"
                type="text"
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
                className={inputClass}
                placeholder="Ej.: cuenta compartida"
              />
              <p className={hintClass}>Se guarda en el registro de auditoría.</p>
            </div>
          )}

          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={suspending ? 'danger' : 'primary'}
              loading={pending}
            >
              {suspending ? 'Suspender' : 'Reactivar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

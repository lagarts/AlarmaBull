import type { FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Feedback'

export type ConfirmTone = 'danger' | 'primary'

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  tone = 'primary',
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  tone?: ConfirmTone
  pending: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onConfirm()
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
        aria-label={title}
        className="w-full max-w-md rounded-card border border-navy-100 bg-white p-5 shadow-card"
      >
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
        <p className="mt-2 text-sm text-navy-600">{description}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

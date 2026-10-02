import type { ReactNode } from 'react'
import { AlertTriangleIcon } from '../icons'

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-navy-600" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-navy-200 border-t-navy-700" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-card border border-dashed border-navy-200 bg-white px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-navy-900">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-navy-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Algo salió mal',
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-card border border-av-red/30 bg-white px-6 py-6 text-center"
    >
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-av-red/10 text-av-red">
        <AlertTriangleIcon className="h-5 w-5" />
      </div>
      <h2 className="mt-3 text-base font-semibold text-navy-900">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-navy-600">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children: ReactNode
}) {
  const tones = {
    info: 'border-navy-200 bg-navy-50 text-navy-800',
    warning: 'border-av-orange/30 bg-orange-50 text-orange-900',
    danger: 'border-av-red/30 bg-red-50 text-red-900',
    success: 'border-av-green/30 bg-green-50 text-green-900',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  )
}

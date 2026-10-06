import { useEffect, useId, useRef } from 'react'
import { Button } from '../ui/Button'

export const PRECAUTION_MESSAGE_MAX = 200

type PrecautionDialogProps = {
  open: boolean
  value: string
  pending?: boolean
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Diálogo para redactar un aviso de precaución con mensaje libre.
 * El texto vive en el padre: se limpia al abrir, así que no hace falta
 * setear estado dentro de un efecto.
 */
export function PrecautionDialog({
  open,
  value,
  pending = false,
  onChange,
  onConfirm,
  onCancel,
}: PrecautionDialogProps) {
  const titleId = useId()
  const inputId = useId()
  const cancelRef = useRef(onCancel)

  useEffect(() => {
    cancelRef.current = onCancel
  })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  const trimmed = value.trim()
  const valid = trimmed.length >= 3 && trimmed.length <= PRECAUTION_MESSAGE_MAX

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
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-card border border-navy-100 bg-white p-5 shadow-card"
      >
        <h2 id={titleId} className="text-base font-bold text-navy-900">
          Enviar aviso de precaución
        </h2>
        <p className="mt-2 text-sm text-navy-600">
          Todos los vecinos activos de tu comunidad reciben este mensaje en su notificación.
          No es una emergencia.
        </p>

        <label htmlFor={inputId} className="mt-4 block text-xs font-semibold text-navy-400">
          Mensaje
        </label>
        <textarea
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={PRECAUTION_MESSAGE_MAX}
          rows={3}
          placeholder="Ej: hay un auto rojo dando vuelta en la esquina"
          className="mt-1 w-full resize-none rounded-xl border border-navy-200 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-400 focus:border-av-blue focus:outline-none"
        />
        <div className="mt-1 flex justify-between text-xs text-navy-400">
          <span>Mínimo 3 caracteres</span>
          <span>
            {trimmed.length}/{PRECAUTION_MESSAGE_MAX}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="warning" onClick={onConfirm} disabled={!valid} loading={pending}>
            Enviar aviso
          </Button>
        </div>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { broadcastToAll } from '../../data'
import { useAction } from '../../hooks/useAsync'
import { hintClass, inputClass, labelClass } from '../community/fields'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { Notice } from '../ui/Feedback'

const MAX_TITLE = 120
const MAX_BODY = 500

/** Mensaje del administrador para la campanita de todos los usuarios. */
export function AdminBroadcastPanel() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [sentCount, setSentCount] = useState<number | null>(null)

  const broadcastAction = useAction(async (pTitle: string, pBody: string | null) => {
    return broadcastToAll(pTitle, pBody)
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSentCount(null)

    const cleanTitle = title.trim()
    const cleanBody = body.trim()

    if (cleanTitle.length === 0 || cleanTitle.length > MAX_TITLE) {
      setTitleError(`El título debe tener entre 1 y ${MAX_TITLE} caracteres.`)
      return
    }
    if (cleanBody.length > MAX_BODY) {
      setTitleError(`El mensaje no puede superar los ${MAX_BODY} caracteres.`)
      return
    }

    setTitleError(null)
    const count = await broadcastAction.run(cleanTitle, cleanBody ? cleanBody : null)
    if (typeof count === 'number') {
      setSentCount(count)
      setTitle('')
      setBody('')
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Mensaje a todos los usuarios</h2>
          <span className="text-xs font-semibold text-navy-600">Campanita</span>
        </div>

        <p className="mt-2 text-sm text-navy-600">
          El mensaje aparece en la campanita de todos los usuarios registrados.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className={labelClass} htmlFor="broadcast-title">
              Título
            </label>
            <input
              id="broadcast-title"
              type="text"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              placeholder="Ej.: Mantenimiento programado"
              aria-invalid={Boolean(titleError)}
            />
            <p className={hintClass}>{title.length}/{MAX_TITLE} caracteres.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="broadcast-body">
              Mensaje (opcional)
            </label>
            <textarea
              id="broadcast-body"
              value={body}
              maxLength={MAX_BODY}
              rows={3}
              onChange={(event) => setBody(event.target.value)}
              className={inputClass}
              placeholder="Ej.: El sábado a las 10 hs no van a llegar alertas durante 15 minutos."
            />
            <p className={hintClass}>{body.length}/{MAX_BODY} caracteres.</p>
          </div>

          {titleError && <Notice tone="danger">{titleError}</Notice>}
          {broadcastAction.error && <Notice tone="danger">{broadcastAction.error}</Notice>}
          {sentCount !== null && (
            <Notice tone="success">
              Mensaje enviado a {sentCount} {sentCount === 1 ? 'usuario' : 'usuarios'}.
            </Notice>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={broadcastAction.pending}>
              Enviar mensaje
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

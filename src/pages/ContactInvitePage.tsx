import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/layout/AuthLayout'
import { Button } from '../components/ui/Button'
import { Notice } from '../components/ui/Feedback'
import { useAction } from '../hooks/useAsync'
import { respondToCheckinInvite } from '../data/estoyBien'

/**
 * Página pública: el contacto responde la invitación con el link
 * que le mandó el usuario. No requiere cuenta.
 */
export function ContactInvitePage() {
  const [params] = useSearchParams()
  const token = (params.get('token') ?? '').trim().toLowerCase()
  const [result, setResult] = useState<'accepted' | 'declined' | null>(null)
  const invalid = !token

  const respond = useAction(async (accept: boolean) => {
    await respondToCheckinInvite(token, accept)
    setResult(accept ? 'accepted' : 'declined')
    return true
  })

  if (invalid) {
    return (
      <AuthLayout title="Invitación inválida" subtitle="Estoy Bien">
        <Notice tone="danger">
          El link no es válido. Pedile a la persona que te comparta uno nuevo.
        </Notice>
      </AuthLayout>
    )
  }

  if (result) {
    return (
      <AuthLayout title="Gracias por responder" subtitle="Estoy Bien">
        <Notice tone={result === 'accepted' ? 'success' : 'info'}>
          {result === 'accepted'
            ? 'Quedaste aceptado como contacto. Si tu persona no confirma a tiempo, vas a recibir el aviso.'
            : 'Quedaste marcado como que no querés recibir avisos. No vas a recibir notificaciones.'}
        </Notice>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Te invitaron a Estoy Bien"
      subtitle="Confirmación diaria de bienestar"
    >
      <div className="space-y-4">
        <p className="text-sm text-navy-600">
          Al aceptar, te convertís en contacto de emergencia de una persona. Si esa persona no
          confirma que está bien durante el día, vas a recibir un aviso para que puedas
          contactarla.
        </p>

        <Notice tone="info">
          Estoy Bien es una herramienta de uso preventivo y no reemplaza a los servicios de
          emergencia.
        </Notice>

        {respond.error && <Notice tone="danger">{respond.error}</Notice>}

        <div className="flex flex-col gap-2">
          <Button
            loading={respond.pending}
            onClick={() => {
              void respond.run(true)
            }}
          >
            Acepto ser contacto
          </Button>
          <Button
            variant="outline"
            disabled={respond.pending}
            onClick={() => {
              void respond.run(false)
            }}
          >
            No quiero recibir avisos
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

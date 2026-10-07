import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/layout/AuthLayout'
import { Button } from '../components/ui/Button'
import { Notice, Spinner } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'
import { useAction } from '../hooks/useAsync'
import { respondToCheckinInvite } from '../data/estoyBien'

/**
 * Página del link de invitación. Rechazar se puede hacer sin cuenta
 * (sólo con el token); para ACEPTAR y recibir el aviso por la app hace
 * falta sesión: si no la hay, se lleva a /acceder y vuelve con el
 * redirect a esta misma URL.
 */
export function ContactInvitePage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const token = (params.get('token') ?? '').trim().toLowerCase()
  const [result, setResult] = useState<'accepted' | 'declined' | null>(null)
  const invalid = !token

  const respond = useAction(async (accept: boolean) => {
    await respondToCheckinInvite(token, accept)
    setResult(accept ? 'accepted' : 'declined')
    return true
  })

  function accept() {
    if (!user) {
      const back = `${location.pathname}${location.search}`
      navigate(`/acceder?redirect=${encodeURIComponent(back)}`)
      return
    }
    void respond.run(true)
  }

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
            ? 'Quedaste aceptado como contacto. El aviso te va a llegar en la app (campanita y notificación) si tu persona no confirma a tiempo.'
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
          confirma que está bien durante el día, vas a recibir el aviso en la app para que puedas
          contactarla.
        </p>

        <Notice tone="info">
          Estoy Bien es una herramienta de uso preventivo y no reemplaza a los servicios de
          emergencia.
        </Notice>

        {loading ? (
          <Spinner label="Cargando." />
        ) : (
          <Notice tone={user ? 'success' : 'info'}>
            {user
              ? `Vas a recibir los avisos en la cuenta ${user.email ?? ''}.`
              : 'Para recibir el aviso en la app necesitás una cuenta: en el próximo paso podés entrar con la tuya o crear una (es gratis).'}
          </Notice>
        )}

        {respond.error && <Notice tone="danger">{respond.error}</Notice>}

        <div className="flex flex-col gap-2">
          <Button loading={respond.pending} disabled={loading} onClick={accept}>
            {user ? 'Acepto ser contacto' : 'Entrar o crear cuenta para aceptar'}
          </Button>
          <Button
            variant="outline"
            disabled={respond.pending || loading}
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

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'
import { APP_NAME } from '../config/env'
import { resendConfirmation } from '../data/profile'
import { useAction, useAsync } from '../hooks/useAsync'
import {
  disablePush,
  enablePush,
  getPushStatus,
  hasActivePush,
  isPushSupported,
  type PushStatus,
} from '../lib/push'
import { requireSupabase } from '../lib/supabase'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className="text-sm font-semibold text-navy-900">{value}</dd>
    </div>
  )
}

function permissionLabel(status: PushStatus): string {
  if (status === 'granted') return 'Concedido'
  if (status === 'denied') return 'Bloqueado'
  return 'Sin pedir permiso'
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [pushFeedback, setPushFeedback] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  const push = useAsync(async () => {
    const status = getPushStatus()
    const active = status === 'unsupported' ? false : await hasActivePush()
    return { status, active }
  }, [])

  const enable = useAction(async () => {
    setPushFeedback(null)
    await enablePush()
    setPushFeedback('Activamos las notificaciones en este dispositivo.')
    push.reload()
    return true
  })

  const disable = useAction(async () => {
    setPushFeedback(null)
    await disablePush()
    setPushFeedback('Desactivamos las notificaciones en este dispositivo.')
    push.reload()
    return true
  })

  const signOut = useAction(async () => {
    const { error } = await requireSupabase().auth.signOut()
    if (error) throw error
    navigate('/acceder', { replace: true })
    return true
  })

  const resend = useAction(async (mail: string) => {
    setResent(false)
    await resendConfirmation(mail)
    setResent(true)
    return true
  })

  let pushBody: ReactNode
  if (push.loading) {
    pushBody = <Spinner label="Cargando notificaciones…" />
  } else if (!isPushSupported()) {
    pushBody = <Notice tone="info">Este navegador no admite notificaciones push.</Notice>
  } else if (!push.data) {
    pushBody = (
      <ErrorState
        title="No pudimos leer el estado de las notificaciones"
        description={push.error ?? undefined}
        onRetry={push.reload}
      />
    )
  } else {
    pushBody = (
      <div className="space-y-3">
        <dl className="divide-y divide-navy-100">
          <InfoRow
            label="Permiso del navegador"
            value={permissionLabel(push.data.status)}
          />
          <InfoRow
            label="Notificaciones en este dispositivo"
            value={push.data.active ? 'Activadas' : 'Desactivadas'}
          />
        </dl>
        {push.data.status === 'denied' && (
          <Notice tone="warning">
            Las notificaciones están bloqueadas para este sitio. Activalas desde la
            configuración del navegador.
          </Notice>
        )}
        {pushFeedback && <Notice tone="success">{pushFeedback}</Notice>}
        {enable.error && <Notice tone="danger">{enable.error}</Notice>}
        {disable.error && <Notice tone="danger">{disable.error}</Notice>}
        <div className="flex flex-wrap gap-2">
          {!push.data.active && push.data.status !== 'denied' && (
            <Button loading={enable.pending} onClick={() => void enable.run()}>
              Activar notificaciones
            </Button>
          )}
          {push.data.active && (
            <Button
              variant="outline"
              loading={disable.pending}
              onClick={() => void disable.run()}
            >
              Desactivar
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Configuración"
        subtitle="Notificaciones, cuenta y datos de la app."
      />
      <div className="space-y-5">
        <Card>
          <CardBody>
            <h2 className="text-base font-bold text-navy-900">Notificaciones push</h2>
            <p className="mt-1 text-sm text-navy-600">
              Recibí las alertas de tu grupo aunque la app esté cerrada.
            </p>
            <div className="mt-3">{pushBody}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-base font-bold text-navy-900">Cuenta</h2>
            {user?.email && (
              <p className="mt-1 break-all text-sm text-navy-600">{user.email}</p>
            )}

            {user && !user.email_confirmed_at && (
              <div className="mt-3 space-y-3">
                <Notice tone="warning">
                  Tu email todavía no está confirmado. Revisá tu correo para activar la
                  cuenta.
                </Notice>
                {resent && (
                  <Notice tone="success">
                    Te enviamos otro email de confirmación. Revisá tu correo (y spam).
                  </Notice>
                )}
                {resend.error && <Notice tone="danger">{resend.error}</Notice>}
                <Button
                  variant="outline"
                  loading={resend.pending}
                  onClick={() => {
                    if (user.email) void resend.run(user.email)
                  }}
                >
                  Reenviar confirmación de email
                </Button>
              </div>
            )}

            {signOut.error && (
              <div className="mt-3">
                <Notice tone="danger">{signOut.error}</Notice>
              </div>
            )}

            <div className="mt-4">
              <Button variant="danger" loading={signOut.pending} onClick={() => void signOut.run()}>
                Cerrar sesión
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-base font-bold text-navy-900">Acerca de</h2>
            <p className="mt-2 text-sm font-semibold text-navy-800">{APP_NAME}</p>
            <p className="mt-1 text-sm text-navy-600">
              Los datos de tu grupo son privados: sólo los integrantes pueden verlos.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

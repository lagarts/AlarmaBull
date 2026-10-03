import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'
import { AppError, errorMessage } from '../data/client'
import { changePassword, getMyProfile, updateMyProfile } from '../data/profile'
import { useAction, useAsync } from '../hooks/useAsync'

const PHONE_PATTERN = /^[0-9+() -]{6,20}$/
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 120
const MIN_PASSWORD_LENGTH = 8

const inputClass =
  'w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-navy-400 focus:outline-none'
const labelClass = 'mb-1.5 block text-sm font-medium text-navy-700'
const fieldErrorClass = 'mt-1 text-xs font-semibold text-av-red'
const hintClass = 'mt-1 text-xs text-navy-400'

function passwordErrorMessage(cause: unknown): string {
  const source = cause as { code?: unknown; message?: unknown } | null
  const code = typeof source?.code === 'string' ? source.code : ''
  const message = typeof source?.message === 'string' ? source.message : ''
  const haystack = `${code} ${message}`.toLowerCase()

  if (code === 'same_password' || haystack.includes('should be different')) {
    return 'La nueva contraseña debe ser distinta de la anterior.'
  }
  if (code === 'weak_password' || haystack.includes('password should be at least')) {
    const match = message.match(/at least (\d+) characters/i)
    return match
      ? `La contraseña debe tener al menos ${match[1]} caracteres`
      : 'Revisá la contraseña ingresada'
  }
  return errorMessage(cause)
}

export function ProfileSettingsPage() {
  const navigate = useNavigate()
  const { profile: contextProfile, refreshProfile } = useAuth()
  const { data, loading, error, reload } = useAsync(getMyProfile, [])
  const profile = data ?? contextProfile

  const [profileErrors, setProfileErrors] = useState<{ fullName?: string; phone?: string }>({})
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savedProfile, setSavedProfile] = useState(false)
  const [savedPassword, setSavedPassword] = useState(false)

  const save = useAction(async (fullName: string, phone: string) => {
    await updateMyProfile(fullName, phone)
    return true
  })

  const changePw = useAction(async (value: string) => {
    try {
      await changePassword(value)
    } catch (cause) {
      throw new AppError(passwordErrorMessage(cause))
    }
    return true
  })

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const fullName = String(values.get('fullName') ?? '').trim()
    const phone = String(values.get('phone') ?? '').trim()
    const next: { fullName?: string; phone?: string } = {}

    if (fullName.length < MIN_NAME_LENGTH || fullName.length > MAX_NAME_LENGTH) {
      next.fullName = `El nombre debe tener entre ${MIN_NAME_LENGTH} y ${MAX_NAME_LENGTH} caracteres.`
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
      next.phone =
        'Ingresá un teléfono válido: de 6 a 20 caracteres, con números, espacios, +, ( o ).'
    }

    setProfileErrors(next)
    setSavedProfile(false)
    if (Object.keys(next).length > 0) return

    const ok = await save.run(fullName, phone)
    if (ok) {
      setSavedProfile(true)
      void refreshProfile()
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const value = String(new FormData(form).get('password') ?? '')
    setSavedPassword(false)

    if (value.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }
    setPasswordError(null)

    const ok = await changePw.run(value)
    if (ok) {
      setSavedPassword(true)
      form.reset()
    }
  }

  let body: ReactNode
  if (loading && !profile) {
    body = <Spinner label="Cargando perfil…" />
  } else if (!profile) {
    body = error ? (
      <ErrorState title="No pudimos cargar tu perfil" description={error} onRetry={reload} />
    ) : (
      <EmptyState
        title="No encontramos tu perfil"
        description="No pudimos cargar tus datos. Intentá de nuevo en unos segundos."
        action={<Button onClick={reload}>Reintentar</Button>}
      />
    )
  } else {
    body = (
      <div className="space-y-5">
        <Card>
          <CardBody>
            <h2 className="text-base font-bold text-navy-900">Datos personales</h2>
            {savedProfile && (
              <div className="mt-3">
                <Notice tone="success">Guardamos tus datos correctamente.</Notice>
              </div>
            )}
            <form onSubmit={handleProfileSubmit} noValidate className="mt-4 space-y-4">
              <div>
                <label className={labelClass} htmlFor="profile-name">
                  Nombre completo
                </label>
                <input
                  id="profile-name"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  defaultValue={profile.full_name ?? ''}
                  className={inputClass}
                  aria-invalid={Boolean(profileErrors.fullName)}
                />
                {profileErrors.fullName && (
                  <p className={fieldErrorClass}>{profileErrors.fullName}</p>
                )}
              </div>

              <div>
                <label className={labelClass} htmlFor="profile-phone">
                  Teléfono
                </label>
                <input
                  id="profile-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={profile.phone ?? ''}
                  className={inputClass}
                  aria-invalid={Boolean(profileErrors.phone)}
                />
                {profileErrors.phone && (
                  <p className={fieldErrorClass}>{profileErrors.phone}</p>
                )}
                <p className={hintClass}>Opcional. Sólo números, espacios, +, ( y ).</p>
              </div>

              {save.error && <Notice tone="danger">{save.error}</Notice>}

              <Button type="submit" className="w-full" loading={save.pending}>
                Guardar cambios
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-base font-bold text-navy-900">Cambiar contraseña</h2>
            {savedPassword && (
              <div className="mt-3">
                <Notice tone="success">Actualizamos tu contraseña.</Notice>
              </div>
            )}
            <form onSubmit={handlePasswordSubmit} noValidate className="mt-4 space-y-4">
              <div>
                <label className={labelClass} htmlFor="profile-password">
                  Nueva contraseña
                </label>
                <input
                  id="profile-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  aria-invalid={Boolean(passwordError)}
                />
                {passwordError ? (
                  <p className={fieldErrorClass}>{passwordError}</p>
                ) : (
                  <p className={hintClass}>Mínimo {MIN_PASSWORD_LENGTH} caracteres.</p>
                )}
              </div>

              {changePw.error && <Notice tone="danger">{changePw.error}</Notice>}

              <Button type="submit" className="w-full" loading={changePw.pending}>
                Actualizar contraseña
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Editar perfil"
        subtitle="Actualizá tu nombre, tu teléfono y tu contraseña."
        actions={
          <Button variant="outline" onClick={() => navigate('/perfil')}>
            Volver
          </Button>
        }
      />
      {body}
    </div>
  )
}

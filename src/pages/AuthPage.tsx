import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/layout/AuthLayout'
import { Button } from '../components/ui/Button'
import { Notice } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'
import { AppError, errorMessage } from '../data/client'
import { resendConfirmation } from '../data/profile'
import { useAction } from '../hooks/useAsync'
import { requireSupabase } from '../lib/supabase'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s]+$/
const MIN_PASSWORD_LENGTH = 8
const MIN_NAME_LENGTH = 2

const inputClass =
  'w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-navy-400 focus:outline-none'
const labelClass = 'mb-1.5 block text-sm font-medium text-navy-700'
const fieldErrorClass = 'mt-1 text-xs font-semibold text-av-red'

type Mode = 'login' | 'signup'
type FieldErrors = { email?: string; password?: string; fullName?: string }

function authErrorMessage(cause: unknown): string {
  const source = cause as { code?: unknown; message?: unknown } | null
  const code = typeof source?.code === 'string' ? source.code : ''
  const message = typeof source?.message === 'string' ? source.message : ''
  const haystack = `${code} ${message}`.toLowerCase()

  if (haystack.includes('invalid login credentials')) return 'Email o contraseña incorrectos'
  if (
    code === 'user_already_exists' ||
    haystack.includes('user already registered') ||
    haystack.includes('already been registered')
  ) {
    return 'Ese email ya está registrado'
  }
  if (code === 'weak_password' || haystack.includes('password should be at least')) {
    const match = message.match(/at least (\d+) characters/i)
    return match
      ? `La contraseña debe tener al menos ${match[1]} caracteres`
      : 'Revisá la contraseña ingresada'
  }
  if (code === 'email_not_confirmed' || haystack.includes('email not confirmed')) {
    return 'Tu email todavía no está confirmado. Revisá tu correo para activar la cuenta.'
  }
  if (haystack.includes('rate limit') || haystack.includes('too many request')) {
    return 'Demasiados intentos. Esperá unos minutos y volvé a intentar.'
  }
  return errorMessage(cause)
}

/** Destino después de entrar: sólo rutas internas (nada de //host). */
function safeRedirect(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/inicio'
}

export function AuthPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirectTo = safeRedirect(params.get('redirect'))

  const [mode, setMode] = useState<Mode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [resent, setResent] = useState(false)

  const login = useAction(async (mail: string, pass: string) => {
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: mail,
      password: pass,
    })
    if (error) throw new AppError(authErrorMessage(error))
    navigate(redirectTo, { replace: true })
    return true
  })

  const signup = useAction(async (mail: string, pass: string, name: string) => {
    const { data, error } = await requireSupabase().auth.signUp({
      email: mail,
      password: pass,
      options: { data: { full_name: name } },
    })
    if (error) throw new AppError(authErrorMessage(error))
    if (!data.session) {
      setResent(false)
      setPendingEmail(mail)
      setConfirmationSent(true)
      return true
    }
    navigate(redirectTo, { replace: true })
    return true
  })

  const resend = useAction(async (mail: string) => {
    setResent(false)
    await resendConfirmation(mail)
    setResent(true)
    return true
  })

  const actionError = mode === 'login' ? login.error : signup.error
  const actionPending = mode === 'login' ? login.pending : signup.pending

  function switchMode(next: Mode) {
    setMode(next)
    setFieldErrors({})
    login.clearError()
    signup.clearError()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const mail = email.trim()
    const next: FieldErrors = {}

    if (!EMAIL_PATTERN.test(mail)) next.email = 'Ingresá un email válido.'
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
    }
    if (mode === 'signup' && fullName.trim().length < MIN_NAME_LENGTH) {
      next.fullName = `Ingresá tu nombre (mínimo ${MIN_NAME_LENGTH} caracteres).`
    }

    setFieldErrors(next)
    if (Object.keys(next).length > 0) return

    if (mode === 'login') {
      void login.run(mail, password)
    } else {
      void signup.run(mail, password, fullName.trim())
    }
  }

  if (user) return <Navigate to={redirectTo} replace />

  if (confirmationSent) {
    return (
      <AuthLayout
        title="Revisá tu email"
        subtitle="Te enviamos un link para activar tu cuenta."
        footer={
          <p className="text-xs text-navy-400">
            Al crear tu cuenta empezás 7 días de prueba gratis
          </p>
        }
      >
        <div className="space-y-4">
          <Notice tone="success">
            Confirmá tu cuenta desde el correo que enviamos a{' '}
            <span className="font-semibold">{pendingEmail}</span>. Si no lo ves, revisá el spam.
          </Notice>
          {resent && (
            <Notice tone="success">Te reenviamos el email de confirmación.</Notice>
          )}
          {resend.error && <Notice tone="danger">{resend.error}</Notice>}
          <Button
            variant="outline"
            className="w-full"
            loading={resend.pending}
            onClick={() => void resend.run(pendingEmail)}
          >
            Reenviar email de confirmación
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setConfirmationSent(false)
              switchMode('login')
            }}
          >
            Volver a iniciar sesión
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
      subtitle={
        mode === 'login'
          ? 'Ingresá con tu email y contraseña.'
          : 'Completá tus datos para crear tu cuenta.'
      }
      footer={
        <p className="text-xs text-navy-400">
          Al crear tu cuenta empezás 7 días de prueba gratis
        </p>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-navy-100 p-1">
        <button
          type="button"
          aria-pressed={mode === 'login'}
          onClick={() => switchMode('login')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            mode === 'login' ? 'bg-white text-navy-900 shadow-soft' : 'text-navy-600'
          }`}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          aria-pressed={mode === 'signup'}
          onClick={() => switchMode('signup')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            mode === 'signup' ? 'bg-white text-navy-900 shadow-soft' : 'text-navy-600'
          }`}
        >
          Crear cuenta
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {mode === 'signup' && (
          <div>
            <label className={labelClass} htmlFor="auth-name">
              Nombre completo
            </label>
            <input
              id="auth-name"
              name="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.fullName)}
            />
            {fieldErrors.fullName && <p className={fieldErrorClass}>{fieldErrors.fullName}</p>}
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && <p className={fieldErrorClass}>{fieldErrors.email}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label className={labelClass} htmlFor="auth-password">
              Contraseña
            </label>
            {mode === 'login' && (
              <Link
                to="/recuperar"
                className="mb-1.5 text-xs font-medium text-av-blue hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            )}
          </div>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fieldErrors.password)}
          />
          {fieldErrors.password ? (
            <p className={fieldErrorClass}>{fieldErrors.password}</p>
          ) : (
            mode === 'signup' && (
              <p className="mt-1 text-xs text-navy-400">
                Mínimo {MIN_PASSWORD_LENGTH} caracteres.
              </p>
            )
          )}
        </div>

        {actionError && <Notice tone="danger">{actionError}</Notice>}

        <Button type="submit" className="w-full" loading={actionPending}>
          {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </Button>
      </form>
    </AuthLayout>
  )
}

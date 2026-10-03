import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/layout/AuthLayout'
import { Button } from '../components/ui/Button'
import { Notice } from '../components/ui/Feedback'
import { appUrl } from '../config/env'
import { AppError, errorMessage } from '../data/client'
import { useAction } from '../hooks/useAsync'
import { requireSupabase } from '../lib/supabase'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s]+$/

const inputClass =
  'w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-navy-400 focus:outline-none'
const labelClass = 'mb-1.5 block text-sm font-medium text-navy-700'
const fieldErrorClass = 'mt-1 text-xs font-semibold text-av-red'

function recoverErrorMessage(cause: unknown): string {
  const source = cause as { message?: unknown } | null
  const message = typeof source?.message === 'string' ? source.message.toLowerCase() : ''
  if (message.includes('rate limit') || message.includes('too many request')) {
    return 'Demasiados intentos. Esperá unos minutos y volvé a intentar.'
  }
  return errorMessage(cause)
}

export function RecoverPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const recover = useAction(async (value: string) => {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(value, {
      redirectTo: `${appUrl}/configuracion`,
    })
    if (error) throw new AppError(recoverErrorMessage(error))
    return true
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim()
    if (!EMAIL_PATTERN.test(value)) {
      setFieldError('Ingresá un email válido.')
      return
    }
    setFieldError(null)
    const ok = await recover.run(value)
    if (ok) setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout
        title="Email enviado"
        subtitle="Restablecé tu contraseña desde tu correo."
      >
        <div className="space-y-4">
          <Notice tone="success">
            Te enviamos un link para restablecer tu contraseña. Revisá tu correo (y spam)
          </Notice>
          <Button className="w-full" onClick={() => navigate('/acceder', { replace: true })}>
            Volver a iniciar sesión
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Dejanos tu email y te mandamos un link para crear una nueva contraseña."
      footer={
        <Link to="/acceder" className="font-medium text-av-blue hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="recover-email">
            Email
          </label>
          <input
            id="recover-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fieldError)}
          />
          {fieldError && <p className={fieldErrorClass}>{fieldError}</p>}
        </div>

        {recover.error && <Notice tone="danger">{recover.error}</Notice>}

        <Button type="submit" className="w-full" loading={recover.pending}>
          Enviar link de recuperación
        </Button>
      </form>
    </AuthLayout>
  )
}

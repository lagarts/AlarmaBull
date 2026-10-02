import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { Spinner } from '../components/ui/Feedback'
import { LogoMark } from '../components/icons'
import { APP_NAME } from '../config/env'

function SetupNotice() {
  return (
    <div className="grid min-h-dvh place-items-center bg-av-surface px-4">
      <div className="max-w-md rounded-card border border-navy-100 bg-white p-8 text-center shadow-card">
        <LogoMark className="mx-auto h-12 w-12 text-navy-900" />
        <h1 className="mt-4 text-lg font-bold text-navy-900">Configuración pendiente</h1>
        <p className="mt-2 text-sm leading-relaxed text-navy-600">
          Falta conectar Supabase. Copiá <code className="font-mono text-navy-800">.env.example</code>{' '}
          a <code className="font-mono text-navy-800">.env</code> y completá{' '}
          <code className="font-mono text-navy-800">VITE_SUPABASE_URL</code> y{' '}
          <code className="font-mono text-navy-800">VITE_SUPABASE_ANON_KEY</code>, luego
          reiniciá el servidor de desarrollo.
        </p>
        <p className="mt-3 text-xs text-navy-400">{APP_NAME}</p>
      </div>
    </div>
  )
}

export function RequireAuth() {
  const { loading, configured, user } = useAuth()

  if (!configured) return <SetupNotice />
  if (loading) return <Spinner label="Verificando sesión…" />
  if (!user) return <Navigate to="/acceder" replace />
  return <Outlet />
}

export function PublicOnly() {
  const { loading, configured, user } = useAuth()

  if (loading) return <Spinner label="Verificando sesión…" />
  if (configured && user) return <Navigate to="/inicio" replace />
  return <Outlet />
}

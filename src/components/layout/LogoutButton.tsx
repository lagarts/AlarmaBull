import { useNavigate } from 'react-router-dom'
import { useAction } from '../../hooks/useAsync'
import { requireSupabase } from '../../lib/supabase'
import { Button } from '../ui/Button'

/** Cierra la sesión y vuelve a la pantalla de acceso. */
export function LogoutButton({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const navigate = useNavigate()

  const signOut = useAction(async () => {
    const { error } = await requireSupabase().auth.signOut()
    if (error) throw error
    navigate('/acceder', { replace: true })
    return true
  })

  const errorClass = tone === 'dark' ? 'text-red-300' : 'text-av-red'

  return (
    <div className="w-full">
      {signOut.error && <p className={`mb-2 text-xs font-semibold ${errorClass}`}>{signOut.error}</p>}
      <Button
        variant="secondary"
        className="w-full"
        loading={signOut.pending}
        onClick={() => void signOut.run()}
      >
        Cerrar sesión
      </Button>
    </div>
  )
}

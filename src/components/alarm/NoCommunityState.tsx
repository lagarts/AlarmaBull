import { Link } from 'react-router-dom'
import { EmptyState } from '../ui/Feedback'

const primaryClass =
  'inline-flex items-center justify-center rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-800'
const outlineClass =
  'inline-flex items-center justify-center rounded-xl border border-navy-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50'

export function NoCommunityState() {
  return (
    <EmptyState
      title="Todavía no tenés una comunidad"
      description="Creá una comunidad vecinal o unite a una existente con un código de invitación para empezar a recibir alertas."
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/comunidad/crear" className={primaryClass}>
            Crear comunidad
          </Link>
          <Link to="/comunidad/unirse" className={outlineClass}>
            Unirse con código
          </Link>
        </div>
      }
    />
  )
}

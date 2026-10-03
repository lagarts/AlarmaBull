import { Link } from 'react-router-dom'
import { Notice } from '../ui/Feedback'
import { linkButtonPrimaryClass } from './fields'

export function AlreadyMemberNotice({ name }: { name: string }) {
  return (
    <Notice tone="warning">
      <p className="font-semibold">Ya pertenecés a una comunidad: {name}.</p>
      <p className="mt-1 text-xs">
        Una persona puede pertenecer a una sola comunidad. Si querés cambiar de comunidad,
        pedile a un administrador que te quite el acceso actual.
      </p>
      <Link to="/inicio" className={`mt-3 ${linkButtonPrimaryClass}`}>
        Ir al inicio
      </Link>
    </Notice>
  )
}

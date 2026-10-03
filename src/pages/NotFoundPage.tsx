import { Link } from 'react-router-dom'
import { Card, CardBody } from '../components/ui/Card'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <Card>
        <CardBody>
          <p className="text-4xl font-black text-av-red">404</p>
          <h1 className="mt-3 text-xl font-bold text-navy-900">Página no encontrada</h1>
          <p className="mt-2 text-sm text-navy-600">
            La dirección solicitada no existe o fue movida.
          </p>
          <Link
            to="/inicio"
            className="mt-6 inline-block rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-700"
          >
            Volver al inicio
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}

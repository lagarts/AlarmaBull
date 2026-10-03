import type { PlanInfo } from '../../data/types'
import { CheckIcon } from '../icons'
import { Card, CardBody } from '../ui/Card'
import { Notice } from '../ui/Feedback'

const GENERIC_FEATURES = [
  'Alertas a los vecinos de tu comunidad',
  'Contactos de emergencia',
  'Notificaciones push',
]

export function PlanCard({ plan }: { plan: PlanInfo }) {
  const features = plan.features.length > 0 ? plan.features : GENERIC_FEATURES
  const hasPrice = plan.price_ars > 0

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">Plan</p>
            <h2 className="mt-0.5 text-base font-bold text-navy-900">{plan.name}</h2>
          </div>
          {plan.trial_days > 0 && (
            <span className="inline-flex items-center rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold text-navy-800">
              Prueba de {plan.trial_days} {plan.trial_days === 1 ? 'día' : 'días'}
            </span>
          )}
        </div>

        {hasPrice ? (
          <p className="text-2xl font-bold text-navy-900">
            $ {plan.price_ars.toLocaleString('es-AR')}
            <span className="ml-1 text-sm font-medium text-navy-600">/ mes</span>
          </p>
        ) : (
          <Notice tone="warning">
            El precio del plan todavía no fue configurado por el administrador.
          </Notice>
        )}

        <ul className="space-y-2">
          {features.map((feature, index) => (
            <li key={`${index}-${feature}`} className="flex items-start gap-2 text-sm text-navy-700">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-av-green" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

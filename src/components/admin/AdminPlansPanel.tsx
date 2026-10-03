import { useState, type FormEvent } from 'react'
import { listAllPlans, setPlan, setPlanPrice } from '../../data'
import type { PlanInfo } from '../../data/types'
import { useAction, useAsync } from '../../hooks/useAsync'
import { hintClass, inputClass, labelClass } from '../community/fields'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../ui/Feedback'

const MAX_TRIAL_DAYS = 60

function PlanEditor({ plan, onChanged }: { plan: PlanInfo; onChanged: () => void }) {
  const [priceError, setPriceError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [priceSaved, setPriceSaved] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const priceAction = useAction(async (planId: string, priceArs: number) => {
    await setPlanPrice(planId, priceArs)
    return true
  })

  const settingsAction = useAction(async (planId: string, trialDays: number, active: boolean) => {
    await setPlan(planId, trialDays, active)
    return true
  })

  const handlePriceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = String(new FormData(event.currentTarget).get('price') ?? '').trim()
    const price = Number(raw)

    setPriceSaved(false)
    if (raw === '' || !Number.isFinite(price) || price < 0) {
      setPriceError('Ingresá un importe en pesos igual o mayor a 0.')
      return
    }

    setPriceError(null)
    const ok = await priceAction.run(plan.id, price)
    if (ok) {
      setPriceSaved(true)
      onChanged()
    }
  }

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const trialDays = Number(String(values.get('trialDays') ?? '').trim())
    const active = values.get('active') === 'on'

    setSettingsSaved(false)
    if (
      String(values.get('trialDays') ?? '').trim() === '' ||
      !Number.isInteger(trialDays) ||
      trialDays < 0 ||
      trialDays > MAX_TRIAL_DAYS
    ) {
      setSettingsError(`Los días de prueba deben ser un número entre 0 y ${MAX_TRIAL_DAYS}.`)
      return
    }

    setSettingsError(null)
    const ok = await settingsAction.run(plan.id, trialDays, active)
    if (ok) {
      setSettingsSaved(true)
      onChanged()
    }
  }

  const noPrice = plan.price_ars <= 0

  return (
    <li className="rounded-xl border border-navy-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-navy-900">{plan.name}</h3>
          <p className="mt-0.5 text-xs text-navy-600">
            {noPrice ? (
              <span className="font-semibold text-av-orange">Sin precio configurado</span>
            ) : (
              <>
                Precio actual:{' '}
                <span className="font-semibold text-navy-900">
                  $ {plan.price_ars.toLocaleString('es-AR')} / mes
                </span>
              </>
            )}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            plan.trial_days > 0 ? 'bg-navy-100 text-navy-800' : 'bg-gray-200 text-gray-700'
          }`}
        >
          Prueba de {plan.trial_days} {plan.trial_days === 1 ? 'día' : 'días'}
        </span>
      </div>

      <form onSubmit={handlePriceSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <label className={labelClass} htmlFor={`price-${plan.id}`}>
            Precio en pesos
          </label>
          <input
            id={`price-${plan.id}`}
            name="price"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={plan.price_ars}
            className={inputClass}
            aria-invalid={Boolean(priceError)}
          />
        </div>
        <Button type="submit" size="sm" loading={priceAction.pending}>
          Guardar precio
        </Button>
      </form>
      {priceError && <p className="mt-1.5 text-xs font-semibold text-av-red">{priceError}</p>}
      {priceSaved && (
        <p className="mt-1.5 text-xs font-semibold text-av-green">Precio actualizado.</p>
      )}
      {priceAction.error && (
        <div className="mt-2">
          <Notice tone="danger">{priceAction.error}</Notice>
        </div>
      )}

      <form onSubmit={handleSettingsSubmit} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <label className={labelClass} htmlFor={`trial-${plan.id}`}>
              Días de prueba
            </label>
            <input
              id={`trial-${plan.id}`}
              name="trialDays"
              type="number"
              min={0}
              max={MAX_TRIAL_DAYS}
              step={1}
              inputMode="numeric"
              defaultValue={plan.trial_days}
              className={inputClass}
              aria-invalid={Boolean(settingsError)}
            />
            <p className={hintClass}>Entre 0 y {MAX_TRIAL_DAYS} días.</p>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <input
              name="active"
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-navy-200 accent-navy-900"
            />
            Plan activo (visible para nuevas suscripciones)
          </label>
          <p className={hintClass}>
            Si lo desactivás, el plan deja de estar disponible para altas nuevas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" variant="outline" loading={settingsAction.pending}>
            Guardar ajustes
          </Button>
          {settingsSaved && (
            <span className="text-xs font-semibold text-av-green">Ajustes actualizados.</span>
          )}
        </div>

        {settingsError && (
          <p className="text-xs font-semibold text-av-red">{settingsError}</p>
        )}
        {settingsAction.error && <Notice tone="danger">{settingsAction.error}</Notice>}
      </form>
    </li>
  )
}

export function AdminPlansPanel() {
  const plansQuery = useAsync<PlanInfo[]>(() => listAllPlans(), [])
  const plans = plansQuery.data ?? []

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-navy-900">Precios y plan</h2>
          <span className="text-xs font-semibold text-navy-600">
            {plans.length} {plans.length === 1 ? 'plan' : 'planes'}
          </span>
        </div>

        <div className="mt-3">
          <Notice tone="info">El precio se aplica a las nuevas suscripciones.</Notice>
        </div>

        {plansQuery.loading ? (
          <Spinner label="Cargando planes…" />
        ) : plansQuery.error ? (
          <div className="mt-3">
            <ErrorState description={plansQuery.error} onRetry={plansQuery.reload} />
          </div>
        ) : plans.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No hay planes activos" description="Cargá un plan para empezar." />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {plans.map((plan) => (
              <PlanEditor key={plan.id} plan={plan} onChanged={plansQuery.reload} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

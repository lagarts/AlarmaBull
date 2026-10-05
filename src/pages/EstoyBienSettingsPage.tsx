import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { ClockIcon, HeartCheckIcon } from '../components/icons'
import { useAction, useAsync } from '../hooks/useAsync'
import { getCheckinState, saveCheckinSettings } from '../data/estoyBien'
import type { CheckinState } from '../data/estoyBien'
import { getUserTimeZone } from '../lib/datetime'
import {
  enablePush,
  getPushStatus,
  hasActivePush,
  isPushSupported,
  type PushStatus,
} from '../lib/push'

const TIME_ZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Montevideo',
  'America/Santiago',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
  'Europe/Madrid',
  'America/New_York',
]

function pushLabel(status: PushStatus): string {
  if (status === 'granted') return 'Concedido'
  if (status === 'denied') return 'Bloqueado'
  return 'Sin pedir permiso'
}

/**
 * El formulario se monta recién con el estado cargado: así sus campos
 * arrancan con los valores del servidor sin efectos de sincronización.
 */
function SettingsForm({
  initial,
  onSaved,
}: {
  initial: CheckinState
  onSaved: (next: CheckinState) => void
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [consent, setConsent] = useState(Boolean(initial.consented_at))
  const [reminderTime, setReminderTime] = useState(initial.reminder_time || '20:00')
  const [graceMinutes, setGraceMinutes] = useState(String(initial.grace_minutes ?? 60))
  const [timezone, setTimezone] = useState(initial.timezone || 'America/Argentina/Buenos_Aires')
  const [saved, setSaved] = useState(false)

  const push = useAsync(async () => {
    const status = getPushStatus()
    const active = status === 'unsupported' ? false : await hasActivePush()
    return { status, active }
  }, [])

  const save = useAction(async () => {
    const minutes = Number(graceMinutes)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      throw new Error('La gracia debe estar entre 0 y 1440 minutos')
    }
    const next = await saveCheckinSettings({
      enabled,
      reminder_time: reminderTime,
      grace_minutes: minutes,
      timezone,
      consent,
    })
    setSaved(true)
    onSaved(next)
    return next
  })

  const pushAction = useAction(async () => {
    await enablePush()
    push.reload()
    return true
  })

  const needsConsent = enabled && !initial.consented_at

  return (
    <div className="space-y-5">
      {saved && <Notice tone="success">Guardamos tu configuración.</Notice>}
      {save.error && <Notice tone="danger">{save.error}</Notice>}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-green-100 text-green-800">
              <HeartCheckIcon className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-base font-bold text-navy-900">Uso preventivo</h2>
              <p className="mt-1 text-sm text-navy-600">
                Estoy Bien te pide confirmar cada día que estás bien. Si no lo hacés dentro del
                período de gracia, se avisa a tus contactos personales. Es una herramienta de uso
                preventivo y no reemplaza a los servicios de emergencia.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-1 h-4 w-4 accent-navy-900"
            />
            <span className="text-sm font-semibold text-navy-900">
              Activar Estoy Bien
              <span className="block text-xs font-normal text-navy-600">
                {enabled ? 'Activo ahora.' : 'Pausado: no se envían recordatorios ni avisos.'}
              </span>
            </span>
          </label>

          {needsConsent && (
            <label className="flex items-start gap-3 rounded-xl border border-av-orange/30 bg-orange-50 px-4 py-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-4 w-4 accent-navy-900"
              />
              <span className="text-sm text-orange-900">
                Acepto el uso preventivo de Estoy Bien y que, si no confirmo a tiempo, se avise a
                mis contactos personales.
              </span>
            </label>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-base font-bold text-navy-900">Horario</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-navy-800">Hora del recordatorio</span>
              <input
                type="time"
                value={reminderTime}
                onChange={(event) => setReminderTime(event.target.value)}
                className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-navy-800">
                Período de gracia (minutos)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                value={graceMinutes}
                onChange={(event) => setGraceMinutes(event.target.value)}
                className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
              />
              <span className="mt-1 block text-xs text-navy-500">
                De 0 a 1440 minutos (24 horas).
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-navy-800">Zona horaria</span>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
            >
              {!TIME_ZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-navy-500">
              Tu navegador detecta {getUserTimeZone()}.
            </span>
          </label>

          <div className="flex items-center gap-2 text-sm text-navy-600">
            <ClockIcon className="h-4 w-4" />
            El recordatorio sería a las {reminderTime} ({timezone}).
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-base font-bold text-navy-900">Notificaciones push</h2>
          <p className="text-sm text-navy-600">
            Activá las notificaciones para ver el recordatorio aunque la app esté cerrada.
          </p>

          {!isPushSupported() ? (
            <Notice tone="info">Este navegador no admite notificaciones push.</Notice>
          ) : (
            <>
              <dl className="divide-y divide-navy-100">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-sm text-navy-600">Permiso del navegador</dt>
                  <dd className="text-sm font-semibold text-navy-900">
                    {push.data ? pushLabel(push.data.status) : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-sm text-navy-600">En este dispositivo</dt>
                  <dd className="text-sm font-semibold text-navy-900">
                    {push.data?.active ? 'Activadas' : 'Sin activar'}
                  </dd>
                </div>
              </dl>

              {push.error && <Notice tone="danger">{push.error}</Notice>}

              {pushAction.error && <Notice tone="danger">{pushAction.error}</Notice>}
              {push.data && !push.data.active && push.data.status !== 'denied' && (
                <Button
                  variant="outline"
                  loading={pushAction.pending}
                  onClick={() => void pushAction.run()}
                >
                  Activar notificaciones
                </Button>
              )}
              {push.data?.status === 'denied' && (
                <Notice tone="warning">
                  Las notificaciones están bloqueadas para este sitio. Activalas desde la
                  configuración del navegador.
                </Notice>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          loading={save.pending}
          onClick={() => {
            setSaved(false)
            void save.run()
          }}
        >
          Guardar
        </Button>
        <Link
          to="/estoy-bien"
          className="inline-flex items-center justify-center rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
        >
          Cancelar
        </Link>
      </div>
    </div>
  )
}

export function EstoyBienSettingsPage() {
  const state = useAsync(() => getCheckinState(), [])

  if (state.loading) return <Spinner label="Cargando configuración…" />
  if (state.error || !state.data) {
    return <ErrorState description={state.error ?? undefined} onRetry={state.reload} />
  }

  return (
    <div>
      <PageHeader
        title="Configurar Estoy Bien"
        subtitle="Horario, gracia, zona horaria y notificaciones."
        actions={
          <Link to="/estoy-bien" className="text-sm font-semibold text-av-blue hover:underline">
            Volver
          </Link>
        }
      />
      <SettingsForm initial={state.data} onSaved={(next) => state.setData(next)} />
    </div>
  )
}

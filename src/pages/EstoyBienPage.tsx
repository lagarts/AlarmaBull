import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  HeartCheckIcon,
  PhoneIcon,
  ShareIcon,
} from '../components/icons'
import { useAction, useAsync } from '../hooks/useAsync'
import { confirmCheckin, getCheckinState, listCheckinContacts } from '../data/estoyBien'
import type { CheckinContact, CheckinState } from '../data/estoyBien'
import { formatDateTime } from '../lib/datetime'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className="text-sm font-semibold text-navy-900">{value}</dd>
    </div>
  )
}

function statusNotice(state: CheckinState) {
  if (state.status === 'confirmed') {
    return (
      <Notice tone="success" title="Confirmaste hoy">
        {state.confirmed_at
          ? `Registrado a las ${formatDateTime(state.confirmed_at, { timeZone: state.timezone })}.`
          : 'Tu confirmación quedó registrada.'}
      </Notice>
    )
  }
  if (state.status === 'grace') {
    return (
      <Notice tone="warning" title="Estás en período de gracia">
        Todavía no confirmaste. Podés hacerlo hasta las{' '}
        <strong>{formatDateTime(state.grace_ends_at, { timeZone: state.timezone })}</strong>.
      </Notice>
    )
  }
  if (state.status === 'alert') {
    return (
      <Notice tone="danger" title="Alerta abierta">
        No hubo confirmación y se avisó a tus contactos. Si estás bien, confirmalo ahora.
      </Notice>
    )
  }
  return (
    <Notice tone="info" title={`Recordatorio a las ${state.reminder_time}`}>
      Cada día te vamos a pedir que confirmes que estás bien. Si no lo hacés, se avisa a tus
      contactos.
    </Notice>
  )
}

function ContactActions({ contacts, timezone }: { contacts: CheckinContact[]; timezone: string }) {
  const [shared, setShared] = useState<string | null>(null)

  const share = async (contact: CheckinContact) => {
    const text = `Hola ${contact.full_name}, te contacto por Estoy Bien: cada día confirmo que estoy bien y, si un día no lo hago, se avisa a mis contactos.`
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      setShared(contact.id)
    } catch {
      setShared(null)
    }
  }

  return (
    <div className="space-y-3">
      {contacts.map((contact) => {
        const digits = contact.phone.replace(/[^0-9]/g, '')
        return (
          <div
            key={contact.id}
            className="rounded-xl border border-navy-100 bg-navy-50 px-4 py-3"
          >
            <p className="text-sm font-semibold text-navy-900">{contact.full_name}</p>
            {contact.relationship && (
              <p className="text-xs text-navy-600">{contact.relationship}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
              >
                <PhoneIcon className="h-4 w-4" />
                Llamar
              </a>
              <a
                href={`https://wa.me/${digits}?text=${encodeURIComponent(
                  `Hola ${contact.full_name}, te escribo por Estoy Bien.`,
                )}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
              >
                WhatsApp
              </a>
              <button
                type="button"
                onClick={() => void share(contact)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
              >
                <ShareIcon className="h-4 w-4" />
                Compartir
              </button>
            </div>
            {shared === contact.id && (
              <p className="mt-2 text-xs text-green-700">Mensaje copiado.</p>
            )}
          </div>
        )
      })}
      <p className="text-xs text-navy-500">
        Zona horaria: {timezone}. Los avisos por SMS o email se envían cuando haya un proveedor
        configurado.
      </p>
    </div>
  )
}

export function EstoyBienPage() {
  const state = useAsync(() => getCheckinState(), [])
  const [done, setDone] = useState(false)

  const contacts = useAsync<CheckinContact[] | null>(
    () =>
      state.data && (state.data.status === 'grace' || state.data.status === 'alert')
        ? listCheckinContacts()
        : Promise.resolve(null),
    [state.data?.status],
  )

  const confirm = useAction(async () => {
    const next = await confirmCheckin()
    state.setData(next)
    setDone(true)
    return next
  })

  if (state.loading) return <Spinner label="Cargando Estoy Bien…" />
  if (state.error || !state.data) {
    return <ErrorState description={state.error ?? undefined} onRetry={state.reload} />
  }

  const data = state.data

  if (!data.enabled) {
    return (
      <div>
        <PageHeader title="Estoy Bien" subtitle="Confirmación diaria de bienestar." />
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-green-100 text-green-800">
                <HeartCheckIcon className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-base font-bold text-navy-900">
                  Confirmá cada día que estás bien
                </h2>
                <p className="mt-1 text-sm text-navy-600">
                  Todos los días a la hora que elijas te pedimos que confirmes con un toque. Si no
                  lo hacés dentro del período de gracia, se avisa a tus contactos personales.
                </p>
              </div>
            </div>

            <Notice tone="info">
              Estoy Bien es una herramienta de uso preventivo: no reemplaza a los servicios de
              emergencia.
            </Notice>

            <Link
              to="/estoy-bien/configuracion"
              className="flex w-full items-center justify-center rounded-xl bg-navy-900 px-4 py-3 text-sm font-semibold text-white hover:bg-navy-800"
            >
              Configurar y activar
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  const needsContacts = data.status === 'grace' || data.status === 'alert'
  const accepted = (contacts.data ?? []).filter((contact) => contact.status === 'accepted')

  return (
    <div>
      <PageHeader
        title="Estoy Bien"
        subtitle="Confirmación diaria de bienestar."
        actions={
          <Link
            to="/estoy-bien/configuracion"
            className="text-sm font-semibold text-av-blue hover:underline"
          >
            Configuración
          </Link>
        }
      />

      <div className="space-y-5">
        {statusNotice(data)}

        {done && data.status !== 'confirmed' && (
          <Notice tone="success">Listo, registramos tu confirmación.</Notice>
        )}
        {confirm.error && <Notice tone="danger">{confirm.error}</Notice>}

        <Card>
          <CardBody className="space-y-4">
            <button
              type="button"
              onClick={() => {
                setDone(false)
                void confirm.run()
              }}
              disabled={data.status === 'confirmed' || confirm.pending}
              className="flex w-full items-center justify-center gap-3 rounded-3xl bg-green-600 px-6 py-6 text-lg font-black tracking-wide text-white shadow-card transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-navy-200 disabled:text-navy-600"
            >
              {data.status === 'confirmed' ? (
                <>
                  <CheckIcon className="h-7 w-7" />
                  HOY YA CONFIRMASTE
                </>
              ) : (
                <>
                  <HeartCheckIcon className="h-7 w-7" />
                  ESTOY BIEN HOY
                </>
              )}
            </button>

            <dl className="divide-y divide-navy-100">
              <InfoRow
                label="Próximo recordatorio"
                value={
                  data.due_at
                    ? formatDateTime(data.due_at, { timeZone: data.timezone })
                    : data.reminder_time
                }
              />
              <InfoRow
                label="Período de gracia"
                value={`${data.grace_minutes} minutos${
                  data.grace_ends_at && data.status === 'grace'
                    ? ` · hasta ${formatDateTime(data.grace_ends_at, { timeZone: data.timezone })}`
                    : ''
                }`}
              />
              <InfoRow label="Contactos aceptados" value={`${data.contacts_accepted}`} />
              <InfoRow
                label="Notificaciones push"
                value={data.push_enabled ? 'Activadas' : 'Sin activar'}
              />
            </dl>

            {!data.push_enabled && (
              <Notice tone="warning">
                Sin notificaciones push en este dispositivo podrías no ver el recordatorio.{' '}
                <Link
                  to="/estoy-bien/configuracion"
                  className="font-semibold underline underline-offset-2"
                >
                  Activar push
                </Link>
              </Notice>
            )}
          </CardBody>
        </Card>

        {needsContacts && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-base font-bold text-navy-900">Tus contactos</h2>
              {contacts.loading ? (
                <Spinner label="Cargando contactos…" />
              ) : contacts.error ? (
                <ErrorState description={contacts.error} onRetry={contacts.reload} />
              ) : accepted.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-navy-600">
                    Todavía no tenés contactos aceptados. Agregá a alguien de confianza para que
                    reciba el aviso.
                  </p>
                  <Link
                    to="/estoy-bien/contactos"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-av-blue hover:underline"
                  >
                    Agregar contactos
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <ContactActions contacts={accepted} timezone={data.timezone} />
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody>
            <nav className="divide-y divide-navy-100">
              <Link
                to="/estoy-bien/contactos"
                className="flex items-center justify-between gap-3 py-3 text-sm font-semibold text-navy-800 hover:text-av-blue"
              >
                <span className="flex items-center gap-2">
                  <PhoneIcon className="h-4 w-4 text-navy-400" />
                  Contactos personales
                </span>
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link
                to="/estoy-bien/historial"
                className="flex items-center justify-between gap-3 py-3 text-sm font-semibold text-navy-800 hover:text-av-blue"
              >
                <span className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-navy-400" />
                  Historial de confirmaciones
                </span>
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </nav>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

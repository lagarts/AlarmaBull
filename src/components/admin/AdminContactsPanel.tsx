import { useState, type FormEvent } from 'react'
import {
  setEmergencyContactActive,
  upsertEmergencyContact,
  type EmergencyContactInput,
} from '../../data'
import type { ServiceType } from '../../data/types'
import { useAction, useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/datetime'
import { hintClass, inputClass, labelClass } from '../community/fields'
import { Button } from '../ui/Button'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../ui/Feedback'
import {
  listAllEmergencyContacts,
  type AdminEmergencyContact,
} from './emergencyContactsAdmin'

const PHONE_PATTERN = /^[0-9+() -]{3,20}$/

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'police', label: 'Policía' },
  { value: 'fire', label: 'Bomberos' },
  { value: 'ambulance', label: 'Ambulancia' },
]

const serviceLabels: Record<string, string> = {
  police: 'Policía',
  fire: 'Bomberos',
  ambulance: 'Ambulancia',
}

function serviceLabel(type: string): string {
  return serviceLabels[type] ?? type
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function locationLine(contact: AdminEmergencyContact): string {
  const parts = [contact.province, contact.locality].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Todo el país'
}

export function AdminContactsPanel() {
  const contactsQuery = useAsync<AdminEmergencyContact[]>(() => listAllEmergencyContacts(), [])
  const [fieldErrors, setFieldErrors] = useState<{ phoneNumber?: string; sourceUrl?: string }>({})
  const [saved, setSaved] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const saveAction = useAction(async (input: EmergencyContactInput) => {
    await upsertEmergencyContact(input)
    return true
  })

  const toggleAction = useAction(async (id: string, active: boolean) => {
    await setEmergencyContactActive(id, active)
    return true
  })

  const contacts = contactsQuery.data ?? []
  const actionError = saveAction.error ?? toggleAction.error

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)

    const serviceType = String(values.get('serviceType') ?? '')
    const phoneNumber = String(values.get('phoneNumber') ?? '').trim()
    const label = String(values.get('label') ?? '').trim()
    const province = String(values.get('province') ?? '').trim()
    const locality = String(values.get('locality') ?? '').trim()
    const sourceUrl = String(values.get('sourceUrl') ?? '').trim()

    const next: { phoneNumber?: string; sourceUrl?: string } = {}
    if (!PHONE_PATTERN.test(phoneNumber)) {
      next.phoneNumber =
        'Ingresá un número válido: de 3 a 20 caracteres con números, espacios, +, ( y ).'
    }
    if (sourceUrl && !isHttpUrl(sourceUrl)) {
      next.sourceUrl = 'Ingresá un link válido que empiece con https://'
    }

    setFieldErrors(next)
    setSaved(false)
    if (Object.keys(next).length > 0) return

    const ok = await saveAction.run({
      serviceType,
      phoneNumber,
      label: label || null,
      province: province || null,
      locality: locality || null,
      sourceUrl: sourceUrl || null,
    })

    if (ok) {
      form.reset()
      setSaved(true)
      contactsQuery.reload()
    }
  }

  const handleToggle = async (contact: AdminEmergencyContact) => {
    if (busyId) return
    setBusyId(contact.id)
    const ok = await toggleAction.run(contact.id, !contact.active)
    setBusyId(null)
    if (ok) contactsQuery.reload()
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-navy-900">Contactos de emergencia</h2>
          <p className="mt-1 text-sm text-navy-600">
            Cargá únicamente números oficiales y su fuente. Los contactos que se muestran salen
            tal como están guardados en la base.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="contact-service">
                Servicio
              </label>
              <select id="contact-service" name="serviceType" className={inputClass}>
                {SERVICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="contact-phone">
                Número
              </label>
              <input
                id="contact-phone"
                name="phoneNumber"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.phoneNumber)}
                placeholder="Sólo números, espacios, +, ( y )"
              />
              {fieldErrors.phoneNumber && (
                <p className="mt-1.5 text-xs font-semibold text-av-red">
                  {fieldErrors.phoneNumber}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="contact-label">
                Etiqueta
              </label>
              <input
                id="contact-label"
                name="label"
                type="text"
                maxLength={120}
                className={inputClass}
                placeholder="Ej.: Comisaría de turno"
              />
              <p className={hintClass}>Opcional.</p>
            </div>

            <div>
              <label className={labelClass} htmlFor="contact-province">
                Provincia
              </label>
              <input
                id="contact-province"
                name="province"
                type="text"
                maxLength={120}
                className={inputClass}
              />
              <p className={hintClass}>Opcional. Vacío aplica a todo el país.</p>
            </div>

            <div>
              <label className={labelClass} htmlFor="contact-locality">
                Localidad
              </label>
              <input
                id="contact-locality"
                name="locality"
                type="text"
                maxLength={120}
                className={inputClass}
              />
              <p className={hintClass}>Opcional.</p>
            </div>

            <div>
              <label className={labelClass} htmlFor="contact-source">
                Link de la fuente
              </label>
              <input
                id="contact-source"
                name="sourceUrl"
                type="url"
                inputMode="url"
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.sourceUrl)}
                placeholder="https://…"
              />
              {fieldErrors.sourceUrl ? (
                <p className="mt-1.5 text-xs font-semibold text-av-red">
                  {fieldErrors.sourceUrl}
                </p>
              ) : (
                <p className={hintClass}>Sitio oficial de donde salió el número.</p>
              )}
            </div>
          </div>

          {saved && <Notice tone="success">Guardamos el contacto.</Notice>}
          {actionError && <Notice tone="danger">{actionError}</Notice>}

          <Button type="submit" loading={saveAction.pending}>
            Guardar contacto
          </Button>
        </form>

        <div className="border-t border-navy-100 pt-4">
          <h3 className="text-sm font-bold text-navy-900">Contactos cargados</h3>

          {contactsQuery.loading ? (
            <Spinner label="Cargando contactos…" />
          ) : contactsQuery.error ? (
            <div className="mt-3">
              <ErrorState description={contactsQuery.error} onRetry={contactsQuery.reload} />
            </div>
          ) : contacts.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Todavía no hay contactos cargados"
                description="Usá el formulario para cargar los números oficiales."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-navy-100 bg-navy-50 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-navy-900">
                        {serviceLabel(contact.service_type)}
                      </span>
                      <a
                        href={`tel:${contact.phone_number}`}
                        className="text-sm font-bold text-av-blue hover:underline"
                      >
                        {contact.phone_number}
                      </a>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          contact.active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {contact.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-navy-600">
                      {[contact.label, locationLine(contact)].filter(Boolean).join(' · ')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-600">
                      {contact.source_url && (
                        <a
                          href={contact.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-av-blue hover:underline"
                        >
                          Ver fuente
                        </a>
                      )}
                      <span>
                        Verificado: {contact.verified_at ? formatDate(contact.verified_at) : 'sin verificar'}
                      </span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={contact.active ? 'outline' : 'secondary'}
                    loading={toggleAction.pending && busyId === contact.id}
                    onClick={() => void handleToggle(contact)}
                  >
                    {contact.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

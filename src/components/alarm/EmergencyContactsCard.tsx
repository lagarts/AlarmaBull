import { useAsync } from '../../hooks/useAsync'
import { listEmergencyContacts } from '../../data'
import type { EmergencyContact } from '../../data/types'
import { Card, CardBody } from '../ui/Card'
import { EmptyState, ErrorState, Spinner } from '../ui/Feedback'
import { PhoneIcon } from '../icons'

const SERVICE_LABELS: Record<string, string | undefined> = {
  police: 'Policía',
  fire: 'Bomberos',
  ambulance: 'Ambulancia',
  civil_defense: 'Defensa Civil',
  gendarmerie: 'Gendarmería',
  other: 'Otro',
}

function serviceLabel(contact: EmergencyContact): string {
  return SERVICE_LABELS[contact.service_type] ?? 'Otro'
}

export function EmergencyContactsCard() {
  const state = useAsync<EmergencyContact[]>(() => listEmergencyContacts(), [])
  const contacts = state.data

  return (
    <Card>
      <CardBody>
        <h2 className="text-base font-bold text-navy-900">Contactos de emergencia</h2>
        <p className="mt-1 text-sm text-navy-600">Números oficiales para tu zona.</p>

        <div className="mt-3">
          {state.loading ? (
            <Spinner label="Cargando números…" />
          ) : state.error ? (
            <ErrorState description={state.error} onRetry={state.reload} />
          ) : !contacts || contacts.length === 0 ? (
            <EmptyState title="Todavía no hay números de emergencia cargados para tu zona." />
          ) : (
            <ul className="divide-y divide-navy-100">
              {contacts.map((contact) => {
                const place = [contact.locality, contact.province].filter(Boolean).join(' · ')
                return (
                  <li key={contact.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                        <PhoneIcon className="h-4 w-4 shrink-0 text-av-red" />
                        {serviceLabel(contact)}
                      </p>
                      <p className="truncate text-sm text-navy-800">{contact.phone_number}</p>
                      {contact.label && (
                        <p className="truncate text-xs text-navy-600">{contact.label}</p>
                      )}
                      {place && <p className="truncate text-xs text-navy-600">{place}</p>}
                      {contact.source_url && (
                        <a
                          href={contact.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-xs text-av-blue underline underline-offset-2"
                        >
                          Fuente
                        </a>
                      )}
                    </div>
                    <a
                      href={`tel:${contact.phone_number}`}
                      className="inline-flex shrink-0 items-center justify-center rounded-xl border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
                    >
                      Llamar
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

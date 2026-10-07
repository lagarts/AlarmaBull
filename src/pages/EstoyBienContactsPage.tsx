import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { LinkIcon, PhoneIcon, PlusIcon, TrashIcon } from '../components/icons'
import { ConfirmDialog } from '../components/alarm/ConfirmDialog'
import { useAction, useAsync } from '../hooks/useAsync'
import {
  deleteCheckinContact,
  listCheckinContacts,
  rotateCheckinInvite,
  saveCheckinContact,
} from '../data/estoyBien'
import type { CheckinContact, CheckinContactStatus } from '../data/estoyBien'

const STATUS_LABELS: Record<CheckinContactStatus, string> = {
  pending: 'Pendiente de aceptar',
  accepted: 'Aceptado',
  declined: 'Rechazado',
}

const STATUS_TONES: Record<CheckinContactStatus, string> = {
  pending: 'bg-orange-100 text-orange-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-navy-100 text-navy-700',
}

type FormState = {
  id: string | null
  full_name: string
  phone: string
  email: string
  relationship: string
  notify_channel: 'sms' | 'email'
}

const EMPTY_FORM: FormState = {
  id: null,
  full_name: '',
  phone: '',
  email: '',
  relationship: '',
  notify_channel: 'sms',
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/contacto/aceptar?token=${token}`
}

export function EstoyBienContactsPage() {
  const contacts = useAsync(() => listCheckinContacts(), [])
  const [form, setForm] = useState<FormState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<CheckinContact | null>(null)

  const save = useAction(async (value: FormState) => {
    await saveCheckinContact({
      id: value.id,
      full_name: value.full_name,
      phone: value.phone,
      email: value.email.trim() ? value.email.trim() : null,
      relationship: value.relationship.trim() ? value.relationship.trim() : null,
      notify_channel: value.notify_channel,
    })
    setForm(null)
    setNotice(value.id ? 'Contacto actualizado.' : 'Contacto agregado.')
    contacts.reload()
    return true
  })

  const remove = useAction(async (id: string) => {
    await deleteCheckinContact(id)
    setToDelete(null)
    setNotice('Contacto eliminado.')
    contacts.reload()
    return true
  })

  const rotate = useAction(async (id: string) => {
    await rotateCheckinInvite(id)
    setNotice('Link nuevo generado: el anterior dejó de funcionar.')
    contacts.reload()
    return true
  })

  const copyLink = async (contact: CheckinContact) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(contact.invite_token))
      setCopied(contact.id)
    } catch {
      setCopied(null)
    }
  }

  const shareLink = async (contact: CheckinContact) => {
    const url = inviteUrl(contact.invite_token)
    const text = `${contact.full_name}, aceptá ser mi contacto de Estoy Bien: ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ text, url })
        return
      }
      await navigator.clipboard.writeText(text)
      setCopied(contact.id)
    } catch {
      setCopied(null)
    }
  }

  const items = contacts.data

  return (
    <div>
      <PageHeader
        title="Contactos personales"
        subtitle="Las personas que reciben un aviso si no confirmás a tiempo."
        actions={
          <Link to="/estoy-bien" className="text-sm font-semibold text-av-blue hover:underline">
            Volver
          </Link>
        }
      />

      <div className="space-y-5">
        <Notice tone="info">
          Estos contactos no son los números oficiales de emergencia. Los que aceptaron el link
          con una cuenta reciben el aviso en la app; los demás quedan registrados como
          pendientes hasta que haya un proveedor de SMS/email configurado.
        </Notice>

        {notice && <Notice tone="success">{notice}</Notice>}
        {save.error && <Notice tone="danger">{save.error}</Notice>}
        {remove.error && <Notice tone="danger">{remove.error}</Notice>}
        {rotate.error && <Notice tone="danger">{rotate.error}</Notice>}

        {form && (
          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-base font-bold text-navy-900">
                {form.id ? 'Editar contacto' : 'Nuevo contacto'}
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold text-navy-800">Nombre y apellido</span>
                  <input
                    type="text"
                    value={form.full_name}
                    maxLength={120}
                    onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-navy-800">Teléfono</span>
                  <input
                    type="tel"
                    value={form.phone}
                    placeholder="1155551234"
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-navy-800">Email (opcional)</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-navy-800">
                    Vínculo (opcional)
                  </span>
                  <input
                    type="text"
                    value={form.relationship}
                    placeholder="Hermana, vecino…"
                    maxLength={60}
                    onChange={(event) => setForm({ ...form, relationship: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-navy-800">Avisar por</span>
                  <select
                    value={form.notify_channel}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        notify_channel: event.target.value === 'email' ? 'email' : 'sms',
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-navy-200 px-3 py-2.5 text-sm text-navy-900"
                  >
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button loading={save.pending} onClick={() => void save.run(form)}>
                  Guardar
                </Button>
                <Button variant="outline" onClick={() => setForm(null)} disabled={save.pending}>
                  Cancelar
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-navy-900">
                {items ? `${items.length} ${items.length === 1 ? 'contacto' : 'contactos'}` : 'Contactos'}
              </h2>
              {!form && (
                <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>
                  <PlusIcon className="h-4 w-4" />
                  Agregar
                </Button>
              )}
            </div>

            {contacts.loading ? (
              <Spinner label="Cargando contactos…" />
            ) : contacts.error ? (
              <ErrorState description={contacts.error} onRetry={contacts.reload} />
            ) : !items || items.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-navy-600">
                  Todavía no cargaste contactos. Agregá a alguien de confianza para que reciba el
                  aviso si no confirmás a tiempo.
                </p>
                {!form && (
                  <Button onClick={() => setForm({ ...EMPTY_FORM })}>
                    <PlusIcon className="h-4 w-4" />
                    Agregar contacto
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((contact) => (
                  <li key={contact.id} className="rounded-xl border border-navy-100 bg-navy-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-navy-900">{contact.full_name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-navy-600">
                          <PhoneIcon className="h-3.5 w-3.5" />
                          {contact.phone}
                          {contact.email ? ` · ${contact.email}` : ''}
                        </p>
                        {contact.relationship && (
                          <p className="text-xs text-navy-500">{contact.relationship}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {contact.account_id && (
                          <span className="rounded-full bg-av-blue/10 px-3 py-1 text-xs font-semibold text-av-blue">
                            Avisa en la app
                          </span>
                        )}
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONES[contact.status]}`}
                        >
                          {STATUS_LABELS[contact.status]}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyLink(contact)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
                      >
                        <LinkIcon className="h-4 w-4" />
                        Copiar link
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareLink(contact)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
                      >
                        Compartir
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: contact.id,
                            full_name: contact.full_name,
                            phone: contact.phone,
                            email: contact.email ?? '',
                            relationship: contact.relationship ?? '',
                            notify_channel: contact.notify_channel,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void rotate.run(contact.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 shadow-sm hover:bg-navy-50"
                      >
                        Regenerar link
                      </button>
                      <button
                        type="button"
                        onClick={() => setToDelete(contact)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-av-red shadow-sm hover:bg-red-50"
                      >
                        <TrashIcon className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>

                    {copied === contact.id && (
                      <p className="mt-2 text-xs text-green-700">Link copiado al portapapeles.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Eliminar contacto"
        message={`Se eliminará ${toDelete?.full_name ?? ''} y su link de invitación deja de funcionar.`}
        confirmLabel="Eliminar"
        pending={remove.pending}
        onConfirm={() => {
          if (toDelete) void remove.run(toDelete.id)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

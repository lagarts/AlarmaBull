import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leaveCommunity } from '../data'
import { getCheckinState } from '../data/estoyBien'
import type { CheckinState } from '../data/estoyBien'
import type { MyCommunity } from '../data/types'
import { useAction, useAsync } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { ConfirmDialog } from '../components/alarm/ConfirmDialog'
import { MembershipBadge, RoleBadge } from '../components/community/badges'
import {
  hintClass,
  linkButtonOutlineClass,
  linkButtonPrimaryClass,
} from '../components/community/fields'
import { ArrowRightIcon, HeartCheckIcon, UsersIcon } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'

const checkinInfo: Record<CheckinState['status'], { label: string; className: string }> = {
  disabled: { label: 'Apagado', className: 'bg-navy-100 text-navy-600' },
  pending: { label: 'Recordatorio diario', className: 'bg-navy-100 text-navy-700' },
  grace: { label: 'En gracia', className: 'bg-av-orange/10 text-av-orange' },
  alert: { label: 'Alerta abierta', className: 'bg-av-red/10 text-av-red' },
  confirmed: { label: 'Confirmado hoy', className: 'bg-av-green/10 text-av-green' },
}

export function GroupsPage() {
  const communityQuery = useMyCommunity()
  const community = communityQuery.data
  const checkinQuery = useAsync<CheckinState>(() => getCheckinState(), [])
  const checkin = checkinQuery.data

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [justLeft, setJustLeft] = useState(false)
  const leaveAction = useAction(async () => {
    await leaveCommunity()
    return true
  })

  const handleLeave = async () => {
    const ok = await leaveAction.run()
    setConfirmOpen(false)
    if (ok) {
      setJustLeft(true)
      communityQuery.reload()
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Grupos"
        subtitle="El grupo de tus vecinos y el de Estoy Bien, en un solo lugar."
      />

      {justLeft && !community && (
        <Notice tone="success">Saliste del grupo. Ya no formás parte de él.</Notice>
      )}

      {leaveAction.error && <Notice tone="danger">{leaveAction.error}</Notice>}

      {communityQuery.loading && <Spinner />}

      {!communityQuery.loading && communityQuery.error && (
        <ErrorState description={communityQuery.error} onRetry={communityQuery.reload} />
      )}

      {!communityQuery.loading && !communityQuery.error && !community && (
        <EmptyState
          title="No estás en ningún grupo de vecinos"
          description="Creá un grupo vecinal o unite a uno existente con un código de invitación para recibir alertas de tus vecinos."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/comunidad/crear" className={linkButtonPrimaryClass}>
                Crear grupo
              </Link>
              <Link to="/comunidad/unirse" className={linkButtonOutlineClass}>
                Unirse con código
              </Link>
            </div>
          }
        />
      )}

      {community && (
        <NeighboursGroupCard community={community} onLeave={() => setConfirmOpen(true)} />
      )}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-av-green/10 text-av-green">
              <HeartCheckIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-navy-400">
                Grupo de Estoy Bien
              </p>
              <h2 className="mt-0.5 text-lg font-bold text-navy-900">
                Personas que cuidan de vos
              </h2>

              {checkinQuery.loading && <p className={hintClass}>Cargando el estado…</p>}

              {checkinQuery.error && (
                <p className={hintClass}>No pudimos cargar el estado de Estoy Bien.</p>
              )}

              {checkin && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${checkinInfo[checkin.status].className}`}
                    >
                      {checkinInfo[checkin.status].label}
                    </span>
                    <span className="text-xs text-navy-600">
                      {checkin.contacts_total === 0
                        ? 'Sin contactos todavía'
                        : `${checkin.contacts_total} ${
                            checkin.contacts_total === 1 ? 'contacto' : 'contactos'
                          }${
                            checkin.contacts_accepted > 0
                              ? ` · ${checkin.contacts_accepted} en la app`
                              : ''
                          }`}
                    </span>
                  </div>
                  {checkin.contacts_total === 0 && (
                    <p className={hintClass}>
                      Agregá a las personas que quieren saber de vos: si un día no confirmás,
                      se les avisa.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to="/estoy-bien/contactos" className={linkButtonPrimaryClass}>
              Ver grupo
            </Link>
            <Link to="/estoy-bien" className={`${linkButtonOutlineClass} gap-1`}>
              Ir a Estoy Bien
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Eliminar grupo"
        message="Vas a salir de este grupo. Tus vecinos siguen dentro y a vos deja de aparecerte. Si sos el último integrante, el grupo se elimina para todos. ¿Continuar?"
        confirmLabel="Salir del grupo"
        pending={leaveAction.pending}
        onConfirm={() => void handleLeave()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

function NeighboursGroupCard({
  community,
  onLeave,
}: {
  community: MyCommunity
  onLeave: () => void
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-100 text-navy-700">
            <UsersIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-navy-400">
              Grupo de vecinos
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-navy-900">{community.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RoleBadge role={community.my_role} />
              <MembershipBadge status={community.my_status} />
              <span className="text-xs text-navy-600">
                {community.member_count}{' '}
                {community.member_count === 1 ? 'integrante' : 'integrantes'}
              </span>
            </div>
          </div>
        </div>

        {community.my_status === 'pending' && (
          <Notice tone="warning">
            Estás pendiente de aprobación: un administrador tiene que autorizarte para ver al
            resto de los vecinos.
          </Notice>
        )}

        <div className="flex flex-wrap gap-2">
          <Link to="/integrantes" className={linkButtonPrimaryClass}>
            Ver integrantes
          </Link>
          {community.my_role === 'admin' && (
            <Link to="/invitaciones" className={linkButtonOutlineClass}>
              Invitaciones
            </Link>
          )}
          <Button variant="danger" size="sm" onClick={onLeave}>
            Eliminar grupo
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

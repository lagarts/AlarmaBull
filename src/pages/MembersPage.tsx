import { useState } from 'react'
import { Link } from 'react-router-dom'
import { approveMember, listMembers, removeMember } from '../data'
import type { CommunityMember, MyCommunity } from '../data/types'
import { useAction, useAsync } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { formatDate } from '../lib/datetime'
import { MemberAvatar } from '../components/community/MemberAvatar'
import { MembershipBadge, RoleBadge } from '../components/community/badges'
import { hintClass, linkButtonPrimaryClass } from '../components/community/fields'
import { PhoneIcon } from '../components/icons'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'

function displayName(member: CommunityMember): string {
  return member.profile?.full_name?.trim() || 'Vecino'
}

export function MembersPage() {
  const communityQuery = useMyCommunity()
  const community = communityQuery.data
  const loading = communityQuery.loading
  const error = communityQuery.error

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Integrantes"
        subtitle={
          community
            ? `${community.member_count} ${
                community.member_count === 1 ? 'integrante' : 'integrantes'
              } en el grupo`
            : 'Vecinos de tu grupo, roles y estados.'
        }
      />

      {loading && <Spinner />}

      {!loading && error && <ErrorState description={error} onRetry={communityQuery.reload} />}

      {!loading && !error && !community && (
        <EmptyState
          title="Todavía no estás en un grupo"
          description="Unite a un grupo vecinal para ver el listado de integrantes."
          action={
            <Link to="/comunidad/unirse" className={linkButtonPrimaryClass}>
              Unirse a un grupo
            </Link>
          }
        />
      )}

      {community && (
        <MembersPanel community={community} onCommunityChanged={communityQuery.reload} />
      )}
    </div>
  )
}

function MembersPanel({
  community,
  onCommunityChanged,
}: {
  community: MyCommunity
  onCommunityChanged: () => void
}) {
  const communityId = community.community_id
  const membersQuery = useAsync<CommunityMember[]>(() => listMembers(communityId), [communityId])
  const approveAction = useAction(async (memberId: string) => {
    await approveMember(memberId)
    return true
  })
  const removeAction = useAction(async (memberId: string) => {
    await removeMember(memberId)
    return true
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  const members = membersQuery.data ?? []
  const isAdmin = community.my_role === 'admin'
  const isPendingViewer = community.my_status === 'pending'
  const activeMembers = members.filter((member) => member.membership_status === 'active')
  const pendingMembers = members.filter((member) => member.membership_status === 'pending')
  const myRow = members.find((member) => member.id === community.my_member_id) ?? null
  const visibleMembers = isPendingViewer ? (myRow ? [myRow] : []) : activeMembers
  const activeAdminCount = activeMembers.filter((member) => member.role === 'admin').length
  const actionError = approveAction.error ?? removeAction.error

  const refresh = () => {
    membersQuery.reload()
    onCommunityChanged()
  }

  const handleApprove = async (member: CommunityMember) => {
    if (busyId) return
    setBusyId(member.id)
    const ok = await approveAction.run(member.id)
    setBusyId(null)
    if (ok) refresh()
  }

  const handleRemove = async (member: CommunityMember, confirmMessage: string) => {
    if (busyId) return
    if (!window.confirm(confirmMessage)) return
    setBusyId(member.id)
    const ok = await removeAction.run(member.id)
    setBusyId(null)
    if (ok) refresh()
  }

  const canRemove = (member: CommunityMember) => {
    if (member.id !== community.my_member_id) return true
    return activeAdminCount > 1
  }

  if (membersQuery.loading) return <Spinner />

  if (membersQuery.error) {
    return <ErrorState description={membersQuery.error} onRetry={membersQuery.reload} />
  }

  return (
    <div className="space-y-4">
      {isPendingViewer && (
        <Notice tone="warning">
          Estás pendiente de aprobación. Un administrador tiene que autorizarte para ver al resto
          de los vecinos.
        </Notice>
      )}

      {actionError && <Notice tone="danger">{actionError}</Notice>}

      {isAdmin && !isPendingViewer && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-navy-900">Solicitudes pendientes</h2>
              <span className="inline-flex items-center rounded-full bg-av-orange/10 px-3 py-1 text-xs font-bold text-av-orange">
                {community.pending_count}
              </span>
            </div>

            {pendingMembers.length === 0 ? (
              <p className={`${hintClass} mt-3`}>No hay solicitudes pendientes por ahora.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pendingMembers.map((member) => {
                  const name = displayName(member)
                  return (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-navy-100 bg-navy-50 p-3"
                    >
                      <MemberAvatar name={name} role={member.role} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-navy-900">{name}</p>
                        <p className="mt-0.5 text-xs text-navy-600">
                          Ingresó el {formatDate(member.joined_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          loading={approveAction.pending && busyId === member.id}
                          onClick={() => void handleApprove(member)}
                        >
                          Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={removeAction.pending && busyId === member.id}
                          onClick={() =>
                            void handleRemove(
                              member,
                              `¿Rechazar la solicitud de ${name}? Se le quitará el acceso.`,
                            )
                          }
                        >
                          Rechazar
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 px-4 py-3">
          <h2 className="text-sm font-bold text-navy-900">
            {isPendingViewer ? 'Tu integración' : 'Integrantes activos'}
          </h2>
          <span className="text-xs font-semibold text-navy-600">
            {community.member_count} en total
          </span>
        </div>

        {visibleMembers.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Sin integrantes"
              description="Todavía no hay vecinos activos en el grupo."
            />
          </div>
        ) : (
          <ul className="divide-y divide-navy-100">
            {visibleMembers.map((member) => {
              const name = displayName(member)
              const phone = member.profile?.phone?.trim() || null
              const isMe = member.id === community.my_member_id
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <MemberAvatar name={name} role={member.role} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-navy-900">{name}</span>
                      {isMe && <span className="text-xs text-navy-400">(vos)</span>}
                      <RoleBadge role={member.role} />
                      <MembershipBadge status={member.membership_status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-600">
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="inline-flex items-center gap-1 font-medium hover:text-av-blue"
                        >
                          <PhoneIcon className="h-3.5 w-3.5" />
                          {phone}
                        </a>
                      )}
                      <span>Ingresó el {formatDate(member.joined_at)}</span>
                    </div>
                  </div>

                  {isAdmin &&
                    member.membership_status === 'active' &&
                    canRemove(member) && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={removeAction.pending && busyId === member.id}
                        onClick={() =>
                          void handleRemove(
                            member,
                            `Se le quitará el acceso a ${name}. ¿Continuar?`,
                          )
                        }
                      >
                        Quitar del grupo
                      </Button>
                    )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

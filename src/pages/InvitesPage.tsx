import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { appUrl } from '../config/env'
import { generateInvite, listInvites, revokeInvites } from '../data'
import type { InviteRow, MyCommunity } from '../data/types'
import { useAction, useAsync } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { formatDateTime } from '../lib/datetime'
import { InviteStateBadge, type InviteState } from '../components/community/badges'
import { inputClass, labelClass, linkButtonPrimaryClass } from '../components/community/fields'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'

const DURATIONS = [
  { label: '1 día', seconds: 86_400 },
  { label: '7 días', seconds: 604_800 },
  { label: '30 días', seconds: 2_592_000 },
]

const MAX_USES_OPTIONS = [1, 10, 25, 100]

function inviteState(invite: InviteRow): InviteState {
  if (invite.revoked_at) return 'revocada'
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return 'vencida'
  return 'activa'
}

export function InvitesPage() {
  const communityQuery = useMyCommunity()
  const community = communityQuery.data
  const loading = communityQuery.loading
  const error = communityQuery.error

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Invitaciones"
        subtitle="Códigos de invitación para sumar vecinos a la comunidad."
      />

      {loading && <Spinner />}

      {!loading && error && <ErrorState description={error} onRetry={communityQuery.reload} />}

      {!loading && !error && !community && (
        <EmptyState
          title="Todavía no estás en una comunidad"
          description="Unite a una comunidad para generar códigos de invitación."
          action={
            <Link to="/comunidad/unirse" className={linkButtonPrimaryClass}>
              Unirse a una comunidad
            </Link>
          }
        />
      )}

      {community && <InvitesPanel community={community} />}
    </div>
  )
}

function InvitesPanel({ community }: { community: MyCommunity }) {
  const communityId = community.community_id
  const invitesQuery = useAsync<InviteRow[]>(() => listInvites(communityId), [communityId])
  const generateAction = useAction(generateInvite)
  const revokeAction = useAction(revokeInvites)

  const [ttlSeconds, setTtlSeconds] = useState(604_800)
  const [maxUses, setMaxUses] = useState(10)
  const [token, setToken] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [revokedNotice, setRevokedNotice] = useState<string | null>(null)

  const isAdmin = community.my_role === 'admin'
  const invites = invitesQuery.data ?? []
  const link = token ? `${appUrl}/comunidad/unirse?codigo=${encodeURIComponent(token)}` : null

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAdmin) return
    const created = await generateAction.run(communityId, ttlSeconds, maxUses)
    if (created) {
      setToken(created)
      setCopyState('idle')
      invitesQuery.reload()
    }
  }

  const handleCopy = async () => {
    if (!link) return
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const handleRevokeAll = async () => {
    if (revokeAction.pending) return
    const confirmed = window.confirm(
      '¿Revocar todos los códigos de invitación? Los códigos vigentes van a dejar de funcionar.',
    )
    if (!confirmed) return
    const revoked = await revokeAction.run(communityId)
    if (typeof revoked === 'number') {
      setRevokedNotice(
        revoked > 0
          ? `Se revocaron ${revoked} códigos de invitación.`
          : 'No había códigos vigentes para revocar.',
      )
      invitesQuery.reload()
    }
  }

  if (invitesQuery.loading) return <Spinner />

  if (invitesQuery.error) {
    return <ErrorState description={invitesQuery.error} onRetry={invitesQuery.reload} />
  }

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <Notice tone="info">Sólo el administrador de la comunidad puede generar invitaciones.</Notice>
      )}

      {isAdmin && (
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-navy-900">Generar código</h2>
            <form onSubmit={handleGenerate} className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="invite-ttl">
                  Duración
                </label>
                <select
                  id="invite-ttl"
                  className={inputClass}
                  value={ttlSeconds}
                  onChange={(event) => setTtlSeconds(Number(event.target.value))}
                >
                  {DURATIONS.map((duration) => (
                    <option key={duration.seconds} value={duration.seconds}>
                      {duration.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="invite-uses">
                  Usos máximos
                </label>
                <select
                  id="invite-uses"
                  className={inputClass}
                  value={maxUses}
                  onChange={(event) => setMaxUses(Number(event.target.value))}
                >
                  {MAX_USES_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option} {option === 1 ? 'uso' : 'usos'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={generateAction.pending}>
                  Generar código
                </Button>
              </div>
            </form>

            {generateAction.error && (
              <div className="mt-3">
                <Notice tone="danger">{generateAction.error}</Notice>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {link && (
        <Card className="border-av-green/40">
          <CardBody>
            <p className="text-xs font-bold uppercase tracking-wide text-av-green">
              Código de invitación nuevo
            </p>
            <p className="mt-2 select-all break-all rounded-xl bg-navy-50 px-3 py-2 font-mono text-sm text-navy-800">
              {link}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={copyState === 'copied' ? 'secondary' : 'primary'}
                onClick={() => void handleCopy()}
              >
                {copyState === 'copied' ? 'Copiado' : 'Copiar link'}
              </Button>
            </div>
            {copyState === 'failed' && (
              <p className="mt-2 text-xs font-semibold text-av-red">
                No pudimos copiar el link. Seleccioná el texto y copialo a mano.
              </p>
            )}
            <div className="mt-3">
              <Notice tone="warning">Este código se muestra una sola vez. Guardalo ahora.</Notice>
            </div>
          </CardBody>
        </Card>
      )}

      {revokedNotice && <Notice tone="success">{revokedNotice}</Notice>}
      {revokeAction.error && <Notice tone="danger">{revokeAction.error}</Notice>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 px-4 py-3">
          <h2 className="text-sm font-bold text-navy-900">Códigos generados</h2>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              loading={revokeAction.pending}
              onClick={() => void handleRevokeAll()}
            >
              Revocar todos
            </Button>
          )}
        </div>

        {invites.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Todavía no hay códigos"
              description="Generá el primer código para empezar a invitar vecinos."
            />
          </div>
        ) : (
          <ul className="divide-y divide-navy-100">
            {invites.map((invite) => {
              const state = inviteState(invite)
              return (
                <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <InviteStateBadge state={state} />
                      <span className="text-xs font-semibold text-navy-700">
                        {invite.use_count} / {invite.max_uses} usos
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
                      <span>Creado: {formatDateTime(invite.created_at)}</span>
                      <span>
                        Vence:{' '}
                        {invite.expires_at ? formatDateTime(invite.expires_at) : 'Sin vencimiento'}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

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
  { label: 'Sin vencimiento', seconds: 0 },
  { label: '1 día', seconds: 86_400 },
  { label: '7 días', seconds: 604_800 },
  { label: '30 días', seconds: 2_592_000 },
]

const MAX_USES_OPTIONS = [
  { value: 1, label: '1 uso' },
  { value: 10, label: '10 usos' },
  { value: 25, label: '25 usos' },
  { value: 100, label: '100 usos' },
  { value: 0, label: 'Ilimitados' },
]

function inviteLink(token: string): string {
  return `${appUrl}/comunidad/unirse?codigo=${encodeURIComponent(token)}`
}

async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function usesLabel(invite: InviteRow): string {
  if (invite.max_uses === null) return `${invite.use_count} usos · sin límite`
  return `${invite.use_count} / ${invite.max_uses} usos`
}

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
        subtitle="Códigos de invitación para sumar vecinos al grupo."
      />

      {loading && <Spinner />}

      {!loading && error && <ErrorState description={error} onRetry={communityQuery.reload} />}

      {!loading && !error && !community && (
        <EmptyState
          title="Todavía no estás en un grupo"
          description="Unite a un grupo para generar códigos de invitación."
          action={
            <Link to="/comunidad/unirse" className={linkButtonPrimaryClass}>
              Unirse a un grupo
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

  const [ttlSeconds, setTtlSeconds] = useState(0)
  const [maxUses, setMaxUses] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const [revokedNotice, setRevokedNotice] = useState<string | null>(null)

  const isAdmin = community.my_role === 'admin'
  const invites = invitesQuery.data ?? []
  const link = token ? inviteLink(token) : null

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAdmin) return
    const created = await generateAction.run(communityId, ttlSeconds || null, maxUses || null)
    if (created) {
      setToken(created)
      setCopyState('idle')
      invitesQuery.reload()
    }
  }

  const handleCopy = async () => {
    if (!link) return
    setCopyState((await copyText(link)) ? 'copied' : 'failed')
  }

  const handleCopyRow = async (invite: InviteRow) => {
    if (!invite.token) return
    const ok = await copyText(inviteLink(invite.token))
    setCopiedId(ok ? invite.id : null)
    setCopyFailedId(ok ? null : invite.id)
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
        <Notice tone="info">Sólo el administrador del grupo puede generar invitaciones.</Notice>
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
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={generateAction.pending}>
                  Generar código
                </Button>
                <p className="mt-2 text-xs text-navy-400">
                  El link queda siempre en la lista de abajo para copiarlo cuando quieras.
                </p>
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
              <Notice tone="info">
                El link también queda guardado en la lista de abajo: volvé cuando quieras a
                copiarlo.
              </Notice>
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
                <li key={invite.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <InviteStateBadge state={state} />
                    <span className="text-xs font-semibold text-navy-700">
                      {usesLabel(invite)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
                    <span>Creado: {formatDateTime(invite.created_at)}</span>
                    <span>
                      Vence:{' '}
                      {invite.expires_at ? formatDateTime(invite.expires_at) : 'Sin vencimiento'}
                    </span>
                  </div>

                  {invite.token ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 select-all break-all rounded-xl bg-navy-50 px-3 py-2 font-mono text-xs text-navy-800">
                        {inviteLink(invite.token)}
                      </p>
                      <Button
                        size="sm"
                        variant={copiedId === invite.id ? 'secondary' : 'outline'}
                        onClick={() => void handleCopyRow(invite)}
                      >
                        {copiedId === invite.id ? 'Copiado' : 'Copiar link'}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-navy-600">
                      Código anterior: ya no se puede copiar. Generá uno nuevo.
                    </p>
                  )}

                  {copyFailedId === invite.id && (
                    <p className="mt-1 text-xs font-semibold text-av-red">
                      No pudimos copiar el link. Seleccioná el texto y copialo a mano.
                    </p>
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

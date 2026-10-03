import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { joinCommunity } from '../data'
import { useAction } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { AlreadyMemberNotice } from '../components/community/AlreadyMemberNotice'
import { hintClass, inputClass, labelClass } from '../components/community/fields'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'

const REDIRECT_DELAY_MS = 1200

export function JoinCommunityPage() {
  const [searchParams] = useSearchParams()
  const communityQuery = useMyCommunity()
  const joinAction = useAction(joinCommunity)
  const navigate = useNavigate()
  const [code, setCode] = useState(() => searchParams.get('codigo') ?? '')
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    if (!joined) return
    const timer = window.setTimeout(() => navigate('/inicio', { replace: true }), REDIRECT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [joined, navigate])

  const community = communityQuery.data
  const token = code.trim()
  const loading = communityQuery.loading
  const error = communityQuery.error

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || joined) return
    const memberId = await joinAction.run(token)
    if (memberId) setJoined(true)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Unirse a una comunidad"
        subtitle="Ingresá el código de invitación que te compartió un vecino."
      />

      {loading && <Spinner />}

      {!loading && error && <ErrorState description={error} onRetry={communityQuery.reload} />}

      {!loading && !error && joined && (
        <Notice tone="success">
          <p className="font-semibold">Te uniste a la comunidad</p>
          <p className="mt-1 text-xs">En un momento te llevamos al inicio.</p>
        </Notice>
      )}

      {!loading && !error && !joined && community && (
        <AlreadyMemberNotice name={community.name} />
      )}

      {!loading && !error && !joined && !community && (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <form onSubmit={handleSubmit} noValidate>
                <label className={labelClass} htmlFor="invite-code">
                  Código de invitación
                </label>
                <input
                  id="invite-code"
                  type="text"
                  className={`${inputClass} font-mono tracking-wide`}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    if (joinAction.error) joinAction.clearError()
                  }}
                  placeholder="Pegá el código acá"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className={hintClass}>
                  Pegalo tal cual como te llegó. Los links de invitación abren esta pantalla con el
                  código listo.
                </p>
                {joinAction.error && (
                  <div className="mt-3">
                    <Notice tone="danger">{joinAction.error}</Notice>
                  </div>
                )}
                <Button
                  type="submit"
                  className="mt-4 w-full sm:w-auto"
                  loading={joinAction.pending}
                  disabled={!token}
                >
                  Unirse
                </Button>
              </form>
            </CardBody>
          </Card>

          {token === '' && (
            <EmptyState
              title="Todavía no tenés código"
              description="Pedile a un vecino que te comparta el código de invitación."
            />
          )}
        </div>
      )}
    </div>
  )
}

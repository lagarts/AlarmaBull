import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createCommunity } from '../data'
import { useAction } from '../hooks/useAsync'
import { useMyCommunity } from '../hooks/useCommunity'
import { AlreadyMemberNotice } from '../components/community/AlreadyMemberNotice'
import {
  fieldErrorClass,
  hintClass,
  inputClass,
  labelClass,
  linkButtonPrimaryClass,
} from '../components/community/fields'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { ErrorState, Notice, Spinner } from '../components/ui/Feedback'

const MIN_LENGTH = 3
const MAX_LENGTH = 80

export function CreateCommunityPage() {
  const communityQuery = useMyCommunity()
  const createAction = useAction(createCommunity)
  const [name, setName] = useState('')
  const [createdName, setCreatedName] = useState<string | null>(null)

  const community = communityQuery.data
  const trimmed = name.trim()
  const isValid = trimmed.length >= MIN_LENGTH && trimmed.length <= MAX_LENGTH

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValid) return
    const communityId = await createAction.run(trimmed)
    if (communityId) {
      setCreatedName(trimmed)
      communityQuery.reload()
    }
  }

  const loading = communityQuery.loading
  const error = communityQuery.error

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Crear grupo"
        subtitle="Creá el grupo de tu barrio. Cada persona puede pertenecer a uno solo."
      />

      {loading && <Spinner />}

      {!loading && error && <ErrorState description={error} onRetry={communityQuery.reload} />}

      {!loading && !error && createdName !== null && (
        <Notice tone="success">
          <p>Grupo creado. Ya sos administrador: compartí un código de invitación.</p>
          <Link to="/invitaciones" className={`mt-3 ${linkButtonPrimaryClass}`}>
            Generar código de invitación
          </Link>
        </Notice>
      )}

      {!loading && !error && createdName === null && community && (
        <AlreadyMemberNotice name={community.name} />
      )}

      {!loading && !error && createdName === null && !community && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} noValidate>
              <label className={labelClass} htmlFor="community-name">
                Nombre del grupo
              </label>
              <input
                id="community-name"
                type="text"
                className={inputClass}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (createAction.error) createAction.clearError()
                }}
                placeholder="Ej: Barrio San Martín"
                minLength={MIN_LENGTH}
                maxLength={MAX_LENGTH}
                autoComplete="off"
              />
              <p className={`${hintClass} flex items-center justify-between gap-2`}>
                <span>
                  Ingresá un nombre de entre {MIN_LENGTH} y {MAX_LENGTH} caracteres.
                </span>
                <span className="font-semibold text-navy-700">
                  {trimmed.length}/{MAX_LENGTH}
                </span>
              </p>
              {name.length > 0 && !isValid && (
                <p className={fieldErrorClass}>
                  El nombre debe tener al menos {MIN_LENGTH} caracteres.
                </p>
              )}
              {createAction.error && (
                <div className="mt-3">
                  <Notice tone="danger">{createAction.error}</Notice>
                </div>
              )}
              <Button
                type="submit"
                className="mt-4 w-full sm:w-auto"
                loading={createAction.pending}
                disabled={!isValid}
              >
                Crear grupo
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

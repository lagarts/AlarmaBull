import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardBody, PageHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Notice, Spinner } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'
import { getMyProfile } from '../data/profile'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/datetime'

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className="text-right text-sm font-semibold text-navy-900">{value}</dd>
    </div>
  )
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, profile: contextProfile, isAdmin, suspended } = useAuth()
  const { data, loading, error, reload } = useAsync(getMyProfile, [])
  const profile = data ?? contextProfile

  let body: ReactNode
  if (profile) {
    body = (
      <div className="space-y-4">
        {suspended && (
          <Notice tone="danger" title="Cuenta suspendida">
            {profile.suspended_reason || 'Tu cuenta está suspendida.'}
          </Notice>
        )}
        <Card>
          <CardBody>
            <dl className="divide-y divide-navy-100">
              <ProfileRow
                label="Nombre"
                value={profile.full_name?.trim() || 'Sin completar'}
              />
              <ProfileRow label="Email" value={user?.email || 'Sin completar'} />
              <ProfileRow
                label="Teléfono"
                value={profile.phone?.trim() || 'Sin completar'}
              />
              <ProfileRow
                label="Dirección"
                value={profile.address?.trim() || 'Sin completar'}
              />
              <ProfileRow label="Rol" value={isAdmin ? 'Administrador' : 'Usuario'} />
              <ProfileRow
                label="Estado de la cuenta"
                value={suspended ? 'Suspendida' : 'Activa'}
              />
              <ProfileRow label="Fecha de alta" value={formatDate(profile.created_at)} />
            </dl>
          </CardBody>
        </Card>
      </div>
    )
  } else if (loading) {
    body = <Spinner label="Cargando perfil…" />
  } else if (error) {
    body = <ErrorState title="No pudimos cargar tu perfil" description={error} onRetry={reload} />
  } else {
    body = (
      <EmptyState
        title="No encontramos tu perfil"
        description="No pudimos cargar tus datos. Intentá de nuevo en unos segundos."
        action={<Button onClick={reload}>Reintentar</Button>}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Mi perfil"
        subtitle="Tus datos de contacto y el estado de tu cuenta."
        actions={
          profile ? (
            <Button onClick={() => navigate('/perfil/editar')}>Editar perfil</Button>
          ) : undefined
        }
      />
      {body}
    </div>
  )
}

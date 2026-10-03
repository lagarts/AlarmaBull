import { Link } from 'react-router-dom'
import { AdminContactsPanel } from '../components/admin/AdminContactsPanel'
import { AdminMetricsPanel } from '../components/admin/AdminMetricsPanel'
import { AdminPaymentsPanel } from '../components/admin/AdminPaymentsPanel'
import { AdminPlansPanel } from '../components/admin/AdminPlansPanel'
import { AdminUsersPanel } from '../components/admin/AdminUsersPanel'
import { PageHeader } from '../components/ui/Card'
import { Notice, Spinner } from '../components/ui/Feedback'
import { useAuth } from '../context/AuthProvider'

export function AdminPage() {
  const { isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div>
        <PageHeader title="Administración" />
        <Spinner label="Cargando panel…" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Administración"
        subtitle="Métricas, usuarios, precios, contactos de emergencia y eventos de pago."
      />

      {!isAdmin ? (
        <Notice tone="danger" title="Sin acceso">
          <p>No tenés acceso al panel de administración.</p>
          <p className="mt-2">
            <Link to="/inicio" className="font-semibold underline underline-offset-2">
              Volver al inicio
            </Link>
          </p>
        </Notice>
      ) : (
        <div className="space-y-5">
          <AdminMetricsPanel />
          <AdminUsersPanel />
          <AdminPlansPanel />
          <AdminContactsPanel />
          <AdminPaymentsPanel />
        </div>
      )}
    </div>
  )
}

import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { AppShell } from './components/layout/AppShell'
import { AuthLayout } from './components/layout/AuthLayout'
import { Notice } from './components/ui/Feedback'
import { PublicOnly, RequireAuth } from './routes/guards'
import { WelcomePage } from './pages/WelcomePage'
import {
  AdminPage,
  AlertDetailPage,
  AlertsHistoryPage,
  CreateCommunityPage,
  HomePage,
  InvitesPage,
  JoinCommunityPage,
  MembersPage,
  NotFoundPage,
  ProfilePage,
  ProfileSettingsPage,
  SettingsPage,
  SubscriptionPage,
} from './pages'

function authPlaceholder(title: string, phase: number, description: string) {
  const Component = () => (
    <AuthLayout
      title={title}
      subtitle={description}
      footer={
        <Link to="/" className="font-semibold text-av-blue hover:underline">
          Volver al inicio
        </Link>
      }
    >
      <Notice tone="info" title={`Fase ${phase} pendiente`}>
        Esta pantalla se implementa en la fase {phase}.
      </Notice>
    </AuthLayout>
  )
  Component.displayName = title
  return Component
}

const AuthRegisterPage = authPlaceholder(
  'Registro e inicio de sesión',
  3,
  'Creá tu cuenta o iniciá sesión con tu email.',
)

const RecoverPage = authPlaceholder(
  'Recuperación de contraseña',
  3,
  'Recibí un link para restablecer tu contraseña.',
)

function ShellWithAuth() {
  const { isAdmin } = useAuth()
  return <AppShell isAdmin={isAdmin} />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/acceder" element={<AuthRegisterPage />} />
            <Route path="/recuperar" element={<RecoverPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route element={<ShellWithAuth />}>
              <Route path="/inicio" element={<HomePage />} />
              <Route path="/alertas" element={<AlertsHistoryPage />} />
              <Route path="/alertas/:alertId" element={<AlertDetailPage />} />
              <Route path="/integrantes" element={<MembersPage />} />
              <Route path="/invitaciones" element={<InvitesPage />} />
              <Route path="/suscripcion" element={<SubscriptionPage />} />
              <Route path="/perfil" element={<ProfilePage />} />
              <Route path="/perfil/editar" element={<ProfileSettingsPage />} />
              <Route path="/configuracion" element={<SettingsPage />} />
              <Route path="/comunidad/crear" element={<CreateCommunityPage />} />
              <Route path="/comunidad/unirse" element={<JoinCommunityPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

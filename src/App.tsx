import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { AppShell } from './components/layout/AppShell'
import { LogoutButton } from './components/layout/LogoutButton'
import { NotificationsBell } from './components/notifications/NotificationsBell'
import { PublicOnly, RequireAuth } from './routes/guards'
import {
  AdminPage,
  AlertDetailPage,
  AlertsHistoryPage,
  AuthPage,
  ContactInvitePage,
  CreateCommunityPage,
  EstoyBienContactsPage,
  EstoyBienHistoryPage,
  EstoyBienPage,
  EstoyBienSettingsPage,
  HomePage,
  InvitesPage,
  JoinCommunityPage,
  MembersPage,
  NotFoundPage,
  ProfilePage,
  ProfileSettingsPage,
  RecoverPage,
  SettingsPage,
  SubscriptionPage,
} from './pages'

function ShellWithAuth() {
  const { isAdmin } = useAuth()
  return (
    <AppShell
      isAdmin={isAdmin}
      sidebarFooter={<LogoutButton tone="dark" />}
      headerRight={<NotificationsBell tone="light" />}
      topRight={<NotificationsBell tone="light" />}
    />
  )
}

/**
 * La app no tiene landing: la raíz lleva directo a la aplicación
 * (/acceder si no hay sesión, /inicio si la hay).
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Link público de contacto: se responde sin cuenta (token en la URL). */}
          <Route path="/contacto/aceptar" element={<ContactInvitePage />} />

          <Route element={<PublicOnly />}>
            <Route path="/" element={<Navigate to="/acceder" replace />} />
            <Route path="/acceder" element={<AuthPage />} />
            <Route path="/recuperar" element={<RecoverPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route element={<ShellWithAuth />}>
              <Route path="/inicio" element={<HomePage />} />
              <Route path="/alertas" element={<AlertsHistoryPage />} />
              <Route path="/alertas/:alertId" element={<AlertDetailPage />} />
              <Route path="/estoy-bien" element={<EstoyBienPage />} />
              <Route path="/estoy-bien/configuracion" element={<EstoyBienSettingsPage />} />
              <Route path="/estoy-bien/contactos" element={<EstoyBienContactsPage />} />
              <Route path="/estoy-bien/historial" element={<EstoyBienHistoryPage />} />
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

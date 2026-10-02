import { makePlaceholder } from './makePlaceholder'

export const AuthPage = makePlaceholder(
  'Registro e inicio de sesión',
  3,
  'Formularios de registro, inicio de sesión y verificación con Supabase Auth.',
)

export const RecoverPasswordPage = makePlaceholder(
  'Recuperación de contraseña',
  3,
  'Envío de email de recuperación y restablecimiento de contraseña.',
)

export const CreateCommunityPage = makePlaceholder(
  'Crear comunidad',
  4,
  'Nombre de la comunidad y generación del código de invitación.',
)

export const JoinCommunityPage = makePlaceholder(
  'Unirse a una comunidad',
  4,
  'Ingreso de código de invitación y solicitud de unión a la comunidad.',
)

export const HomePage = makePlaceholder(
  'Inicio · Botón de alarma',
  2,
  'Pantalla principal con estado de suscripción, botón ALERTA VECINAL y accesos de emergencia.',
)

export const AlertsHistoryPage = makePlaceholder(
  'Historial de alertas',
  6,
  'Listado de alertas de la comunidad con fecha, emisor y estado.',
)

export const AlertDetailPage = makePlaceholder(
  'Detalle de alerta',
  6,
  'Información completa de una alerta, destinatarios y estado de entrega.',
)

export const MembersPage = makePlaceholder(
  'Integrantes de la comunidad',
  4,
  'Listado de vecinos, roles y estado de cada integrante.',
)

export const InvitesPage = makePlaceholder(
  'Gestión de invitaciones',
  4,
  'Generación, expiración y revocación de códigos de invitación.',
)

export const SubscriptionPage = makePlaceholder(
  'Suscripción y pagos',
  5,
  'Precio en ARS, condiciones, fecha del próximo cobro e historial de pagos.',
)

export const ProfilePage = makePlaceholder(
  'Perfil y preferencias',
  3,
  'Datos del perfil, preferencias de notificaciones y ubicación.',
)

export const ProfileSettingsPage = makePlaceholder(
  'Configuración del perfil',
  3,
  'Edición de nombre, teléfono y contraseña.',
)

export const SettingsPage = makePlaceholder(
  'Configuración',
  2,
  'Ajustes generales de la aplicación y de la cuenta.',
)

export const AdminPage = makePlaceholder(
  'Panel de administración',
  12,
  'Métricas, usuarios, comunidades, precios, emergencias y eventos de pago.',
)

export const NotFoundPage = makePlaceholder(
  'Página no encontrada',
  1,
  'La dirección solicitada no existe o fue movida.',
)

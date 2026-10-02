import type { ComponentType } from 'react'
import {
  BellIcon,
  CardIcon,
  HomeIcon,
  SettingsIcon,
  ShieldIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
} from '../components/icons'

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  adminOnly?: boolean
  bottom?: boolean
}

export const navItems: NavItem[] = [
  { to: '/inicio', label: 'Inicio', icon: HomeIcon, bottom: true },
  { to: '/alertas', label: 'Alertas', icon: BellIcon, bottom: true },
  { to: '/integrantes', label: 'Integrantes', icon: UsersIcon, bottom: true },
  { to: '/invitaciones', label: 'Invitaciones', icon: TicketIcon },
  { to: '/suscripcion', label: 'Suscripción', icon: CardIcon, bottom: true },
  { to: '/perfil', label: 'Perfil', icon: UserIcon },
  { to: '/configuracion', label: 'Configuración', icon: SettingsIcon },
  { to: '/admin', label: 'Administración', icon: ShieldIcon, adminOnly: true },
]

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return navItems.filter((item) => !item.adminOnly || isAdmin)
}

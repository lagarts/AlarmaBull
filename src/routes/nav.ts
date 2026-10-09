import type { ComponentType } from 'react'
import {
  BellIcon,
  CardIcon,
  GroupsIcon,
  HeartCheckIcon,
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
  { to: '/estoy-bien', label: 'Estoy Bien', icon: HeartCheckIcon, bottom: true },
  { to: '/grupos', label: 'Grupos', icon: GroupsIcon },
  { to: '/integrantes', label: 'Integrantes', icon: UsersIcon, bottom: true },
  { to: '/invitaciones', label: 'Invitaciones', icon: TicketIcon },
  { to: '/suscripcion', label: 'Suscripción', icon: CardIcon, bottom: true },
  { to: '/perfil', label: 'Perfil', icon: UserIcon },
  { to: '/configuracion', label: 'Configuración', icon: SettingsIcon },
  { to: '/admin', label: 'Admin', icon: ShieldIcon, adminOnly: true },
]

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return navItems.filter((item) => !item.adminOnly || isAdmin)
}

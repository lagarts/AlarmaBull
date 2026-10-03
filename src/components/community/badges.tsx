import type { CommunityRole, MembershipStatus } from '../../data/types'

export type InviteState = 'activa' | 'vencida' | 'revocada'

export function RoleBadge({ role }: { role: CommunityRole }) {
  const isAdmin = role === 'admin'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        isAdmin ? 'bg-navy-900 text-white' : 'bg-navy-100 text-navy-700'
      }`}
    >
      {isAdmin ? 'Administrador' : 'Integrante'}
    </span>
  )
}

export function MembershipBadge({ status }: { status: MembershipStatus }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center rounded-full bg-av-orange/10 px-2.5 py-0.5 text-[11px] font-semibold text-av-orange">
        Pendiente
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-full bg-av-green/10 px-2.5 py-0.5 text-[11px] font-semibold text-av-green">
        Activo
      </span>
    )
  }
  return null
}

const inviteLabels: Record<InviteState, string> = {
  activa: 'Activa',
  vencida: 'Vencida',
  revocada: 'Revocada',
}

const inviteTones: Record<InviteState, string> = {
  activa: 'bg-av-green/10 text-av-green',
  vencida: 'bg-av-red/10 text-av-red',
  revocada: 'bg-navy-100 text-navy-600',
}

export function InviteStateBadge({ state }: { state: InviteState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${inviteTones[state]}`}
    >
      {inviteLabels[state]}
    </span>
  )
}

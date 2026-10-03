import type { CommunityRole } from '../../data/types'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'V'
  const first = parts[0].charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''
  return (first + last).toUpperCase()
}

export function MemberAvatar({ name, role }: { name: string; role: CommunityRole }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
        role === 'admin' ? 'bg-navy-900 text-white' : 'bg-navy-100 text-navy-700'
      }`}
    >
      {initialsOf(name)}
    </span>
  )
}

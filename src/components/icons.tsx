import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Base>
)

export const BellIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </Base>
)

export const UsersIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
    <path d="M18.5 14.9c1.7.8 2.9 2.4 2.9 5.1" />
  </Base>
)

export const TicketIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5Z" />
    <path d="M14 6v12" strokeDasharray="2 2.5" />
  </Base>
)

export const CardIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
    <path d="M2.5 10h19" />
  </Base>
)

export const UserIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
  </Base>
)

export const SettingsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.33-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
  </Base>
)

export const ShieldIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Base>
)

export const MenuIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
)

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
)

export const PhoneIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.6 3.5 9 4l1.2 3.3-1.8 1.5a12.4 12.4 0 0 0 5.8 5.8l1.5-1.8L19 14l.5 2.4a2 2 0 0 1-2.1 2.4A15.6 15.6 0 0 1 4.2 5.6 2 2 0 0 1 6.6 3.5Z" />
  </Base>
)

export const ChevronLeftIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m14.5 5-7 7 7 7" />
  </Base>
)

export const ArrowRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </Base>
)

export const SirenIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17v-5a5 5 0 0 1 10 0v5" />
    <rect x="4" y="17" width="16" height="4" rx="1.5" />
    <path d="M12 3v1.5M4.9 6.1l1 1M19.1 6.1l-1 1" />
  </Base>
)

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
)

export const AlertTriangleIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </Base>
)

export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path
        d="M32 12c-7.2 0-13 5.8-13 13v9.6l-4.4 7.6A1.6 1.6 0 0 0 16 46h32a1.6 1.6 0 0 0 1.4-3.8L45 34.6V25c0-7.2-5.8-13-13-13Z"
        fill="#e11d48"
      />
      <path
        d="M26 50a6 6 0 0 0 12 0"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="32" cy="25" r="6" fill="#fff" />
    </svg>
  )
}

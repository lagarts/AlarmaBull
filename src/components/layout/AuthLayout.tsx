import { Link } from 'react-router-dom'
import { AppLogo } from '../ui/AppLogo'
import { APP_NAME } from '../../config/env'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-av-surface px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <AppLogo className="h-12 w-12" />
          <span className="text-lg font-bold text-navy-900">{APP_NAME}</span>
        </Link>

        <div className="rounded-card border border-navy-100 bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold text-navy-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-navy-600">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>

        {footer && <div className="mt-4 text-center text-sm text-navy-600">{footer}</div>}
      </div>
    </div>
  )
}

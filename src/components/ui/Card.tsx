import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-card border border-navy-100 bg-white shadow-card ${className}`}
      {...rest}
    />
  )
}

export function CardBody({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 ${className}`} {...rest} />
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

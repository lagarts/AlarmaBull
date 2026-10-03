import type { ReactNode } from 'react'

type PageStubProps = { title: string; phase: number; description?: string }

export function PageStub({ title, phase, description }: PageStubProps): ReactNode {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-card border border-navy-100 bg-white p-8 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
          En construcción · Fase {phase}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-navy-600">
          {description ??
            'Esta pantalla se implementa en la fase indicada. Se mantiene la navegación para verificar estructura y diseño.'}
        </p>
      </div>
    </div>
  )
}

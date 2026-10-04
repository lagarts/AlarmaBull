import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { CloseIcon, MenuIcon } from '../icons'
import { AppLogo } from '../ui/AppLogo'
import { visibleNavItems } from '../../routes/nav'
import { APP_NAME } from '../../config/env'

type AppShellProps = {
  isAdmin?: boolean
  communityName?: string
  headerRight?: ReactNode
  sidebarFooter?: ReactNode
  topRight?: ReactNode
}

export function AppShell({
  isAdmin = false,
  communityName,
  headerRight,
  sidebarFooter,
  topRight,
}: AppShellProps) {
  const items = visibleNavItems(isAdmin)
  const [menuOpen, setMenuOpen] = useState(false)

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-white/12 text-white'
        : 'text-navy-100 hover:bg-white/8 hover:text-white'
    }`

  return (
    <div className="min-h-dvh bg-av-surface">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-900 px-4 py-6 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <AppLogo className="h-10 w-10" />
          <div>
            <p className="text-sm font-bold leading-tight text-white">{APP_NAME}</p>
            {communityName && (
              <p className="truncate text-xs text-navy-200">{communityName}</p>
            )}
          </div>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Navegación principal">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass} end={item.to === '/inicio'}>
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 pt-4">{sidebarFooter ?? headerRight}</div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-navy-100 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <AppLogo className="h-9 w-9" />
          <div>
            <p className="text-sm font-bold leading-tight text-navy-900">{APP_NAME}</p>
            {communityName && <p className="text-xs text-navy-600">{communityName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          <button
            type="button"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-xl text-navy-700 hover:bg-navy-50"
          >
            {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <nav
          aria-label="Navegación móvil"
          className="sticky top-[61px] z-20 border-b border-navy-100 bg-white px-3 py-2 shadow-soft lg:hidden"
        >
          <ul className="grid grid-cols-2 gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/inicio'}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${
                      isActive ? 'bg-navy-100 text-navy-900' : 'text-navy-700 hover:bg-navy-50'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="lg:pl-64">
        {topRight && (
          <div className="fixed right-5 top-4 z-30 hidden lg:block">{topRight}</div>
        )}
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pr-24">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Navegación inferior"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-navy-100 bg-white/95 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {items
            .filter((item) => item.bottom)
            .map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/inicio'}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-semibold ${
                      isActive ? 'text-av-blue' : 'text-navy-600'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  )
}

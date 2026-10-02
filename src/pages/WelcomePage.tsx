import { Link } from 'react-router-dom'
import { ArrowRightIcon, BellIcon, LogoMark, PhoneIcon, ShieldIcon, UsersIcon } from '../components/icons'
import { APP_NAME } from '../config/env'
import { Button } from '../components/ui/Button'

const features = [
  {
    icon: BellIcon,
    title: 'Alertas vecinales',
    description: 'Activá una alerta y registrá quién la disparó, cuándo y para qué comunidad.',
  },
  {
    icon: UsersIcon,
    title: 'Comunidad del barrio',
    description: 'Creá tu comunidad, compartí un código de invitación y administrá integrantes.',
  },
  {
    icon: PhoneIcon,
    title: 'Emergencias a un toque',
    description: 'Accesos directos a Policía, Bomberos y Ambulancia con el número de tu localidad.',
  },
  {
    icon: ShieldIcon,
    title: 'Suscripción individual',
    description: '7 días de prueba y un plan mensual propio en pesos. Sin pagos grupales.',
  },
]

export function WelcomePage() {
  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark className="h-9 w-9 text-navy-900" />
          <span className="text-base font-bold text-navy-900">{APP_NAME}</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            to="/acceder"
            className="rounded-xl px-3 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50"
          >
            Iniciar sesión
          </Link>
          <Link to="/acceder?modo=registro">
            <Button size="sm">Crear cuenta</Button>
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold text-navy-800">
                Hecho para barrios de Argentina
              </span>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight text-navy-900 sm:text-5xl">
                Coordiná la seguridad de tu barrio con tu comunidad vecinal
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-navy-600 sm:text-lg">
                {APP_NAME} conecta a los vecinos de una comunidad para compartir alertas de
                seguridad en tiempo real y acceder rápido a los teléfonos de emergencia.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link to="/acceder?modo=registro">
                  <Button size="lg">
                    Empezar prueba de 7 días
                    <ArrowRightIcon className="h-5 w-5" />
                  </Button>
                </Link>
                <Link to="/acceder">
                  <Button size="lg" variant="outline">
                    Ya tengo cuenta
                  </Button>
                </Link>
              </div>

              <p className="mt-4 text-xs text-navy-400">
                Los botones de emergencia solo abren una llamada al número configurado. La
                aplicación no contacta automáticamente a Policía, Bomberos ni Ambulancia.
              </p>
            </div>

            <div className="rounded-card border border-navy-100 bg-av-surface p-6 shadow-card sm:p-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-navy-900">Barrio Los Aromos</p>
                  <p className="text-xs text-navy-600">18 integrantes</p>
                </div>
                <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold text-navy-800">
                  Prueba · 6 días
                </span>
              </div>

              <div className="mt-6 flex flex-col items-center gap-4">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="grid h-40 w-40 cursor-not-allowed place-items-center rounded-full bg-av-red text-white shadow-[0_14px_40px_-14px_rgba(220,38,38,0.9)]"
                >
                  <BellIcon className="h-12 w-12" />
                  <span className="mt-1 text-sm font-extrabold tracking-wide">ALERTA VECINAL</span>
                </button>

                <div className="grid w-full grid-cols-3 gap-2">
                  <div className="rounded-xl bg-av-blue px-2 py-3 text-center text-xs font-bold text-white">
                    POLICÍA
                  </div>
                  <div className="rounded-xl bg-av-orange px-2 py-3 text-center text-xs font-bold text-white">
                    BOMBEROS
                  </div>
                  <div className="rounded-xl bg-av-green px-2 py-3 text-center text-xs font-bold text-white">
                    AMBULANCIA
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-navy-100 bg-av-surface">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-card border border-navy-100 bg-white p-5 shadow-soft"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-100 text-navy-700">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h2 className="mt-3 text-sm font-bold text-navy-900">{feature.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-navy-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-navy-100 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-navy-400 sm:px-6">
          © {new Date().getFullYear()} {APP_NAME} · Argentina · Uso comunitario, no reemplaza a los
          servicios de emergencia oficiales.
        </div>
      </footer>
    </div>
  )
}

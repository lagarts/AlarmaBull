import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WelcomePage } from './WelcomePage'

function renderWelcome() {
  return render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>,
  )
}

describe('WelcomePage', () => {
  it('muestra el nombre de la app y el período de prueba', () => {
    renderWelcome()

    expect(screen.getByText('Alarma Vecinal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Empezar prueba de 7 días/i })).toBeInTheDocument()
  })

  it('no afirma que contacta automáticamente a los servicios de emergencia', () => {
    renderWelcome()

    expect(
      screen.getByText(/no contacta automáticamente a Policía, Bomberos ni Ambulancia/i),
    ).toBeInTheDocument()
  })

  it('ofrece acceso a inicio de sesión y a registro', () => {
    renderWelcome()

    expect(screen.getAllByRole('link', { name: /Iniciar sesión/i }).length).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('link', { name: /Crear cuenta|Ya tengo cuenta/i }).length,
    ).toBeGreaterThanOrEqual(2)
  })
})

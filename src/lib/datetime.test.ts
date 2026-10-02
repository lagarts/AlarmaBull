import { describe, expect, it } from 'vitest'
import { formatAmountArs, formatDate, formatDateTime, getDaysLeft } from './datetime'

const ISO = '2026-03-01T12:00:00.000Z'

describe('datetime', () => {
  it('formatea fecha y hora en la zona horaria pedida', () => {
    const buenosAires = formatDateTime(ISO, { timeZone: 'America/Argentina/Buenos_Aires' })
    const utc = formatDateTime(ISO, { timeZone: 'UTC' })

    expect(buenosAires).toContain('1')
    expect(utc).toContain('12:00')
    expect(buenosAires).toMatch(/9:00/)
  })

  it('devuelve guion ante valores inválidos o vacíos', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('no-es-fecha')).toBe('—')
    expect(formatDate(undefined)).toBe('—')
  })

  it('calcula días restantes sin depender del formato local', () => {
    const now = new Date('2026-03-01T00:00:00.000Z')

    expect(getDaysLeft('2026-03-08T00:00:00.000Z', now)).toBe(7)
    expect(getDaysLeft('2026-03-01T00:00:00.000Z', now)).toBe(0)
    expect(getDaysLeft('2026-02-01T00:00:00.000Z', now)).toBe(0)
    expect(getDaysLeft(null, now)).toBeNull()
  })

  it('formatea importes en pesos argentinos', () => {
    expect(formatAmountArs(1500)).toContain('1.500')
    expect(formatAmountArs(1500)).toContain('$')
    expect(formatAmountArs(1500.5)).toContain('1.500,50')
  })
})

import { requireSupabase } from '../lib/supabase'
import { toAppError } from './client'
import type { EmergencyContact } from './types'

const SELECT =
  'id, country_code, province, locality, service_type, phone_number, label, source_url, verified_at'

/** Números de emergencia activos para la ubicación del usuario. */
export async function listEmergencyContacts(options?: {
  province?: string | null
  locality?: string | null
}): Promise<EmergencyContact[]> {
  const supabase = requireSupabase()
  const province = options?.province?.trim()
  const locality = options?.locality?.trim()

  let query = supabase
    .from('emergency_contacts')
    .select(SELECT)
    .eq('active', true)
    .order('service_type', { ascending: true })

  if (province) query = query.or(`province.eq.${province},province.is.null`)
  if (locality) query = query.or(`locality.eq.${locality},locality.is.null`)

  const { data, error } = await query.limit(50)
  if (error) throw toAppError(error)

  const rows = (data ?? []) as unknown as EmergencyContact[]
  // Prefiere los números específicos de la zona antes que los nacionales.
  return rows.sort((a, b) => specificity(b) - specificity(a))
}

function specificity(contact: EmergencyContact): number {
  let score = 0
  if (contact.locality) score += 2
  if (contact.province) score += 1
  if (contact.verified_at) score += 1
  return score
}

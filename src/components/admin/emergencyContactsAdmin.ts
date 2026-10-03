import { toAppError } from '../../data/client'
import type { EmergencyContact } from '../../data/types'
import { requireSupabase } from '../../lib/supabase'

export type AdminEmergencyContact = EmergencyContact & { active: boolean }

const SELECT =
  'id, country_code, province, locality, service_type, phone_number, label, source_url, verified_at, active'

/**
 * Todos los contactos (activos e inactivos). El RLS permite verlos a los
 * administradores aunque estén desactivados.
 */
export async function listAllEmergencyContacts(): Promise<AdminEmergencyContact[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select(SELECT)
    .order('service_type', { ascending: true })
    .order('province', { ascending: true, nullsFirst: false })
  if (error) throw toAppError(error)
  return (data ?? []) as unknown as AdminEmergencyContact[]
}

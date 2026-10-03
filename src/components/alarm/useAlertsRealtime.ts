import { useEffect, useRef } from 'react'
import { getSupabase } from '../../lib/supabase'

/**
 * Se suscribe a nuevas alertas de la comunidad y avisa vía `onAlertInserted`.
 * El callback se guarda en un ref para no volver a suscribirse en cada render.
 */
export function useAlertsRealtime(
  communityId: string | null | undefined,
  onAlertInserted: () => void,
) {
  const handlerRef = useRef(onAlertInserted)

  useEffect(() => {
    handlerRef.current = onAlertInserted
  })

  useEffect(() => {
    if (!communityId) return
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase
      .channel(`alerts-realtime-${communityId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter: `community_id=eq.${communityId}`,
        },
        () => {
          handlerRef.current()
        },
      )
      .subscribe()

    return () => {
      void channel.unsubscribe()
    }
  }, [communityId])
}

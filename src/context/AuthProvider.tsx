import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import { getMyProfile } from '../data/profile'
import type { MyProfile } from '../data/types'

type AuthState = {
  loading: boolean
  configured: boolean
  session: Session | null
  user: User | null
  profile: MyProfile | null
  isAdmin: boolean
  suspended: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  loading: true,
  configured: false,
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  suspended: false,
  refreshProfile: async () => {},
})

type ProfileEntry = { userId: string | null; profile: MyProfile | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [entry, setEntry] = useState<ProfileEntry>({ userId: null, profile: null })

  useEffect(() => {
    if (!supabase) return

    let active = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setSession(null)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const currentUserId = session?.user?.id ?? null

  // Perfil propio (rol y suspensión) siempre que haya sesión.
  useEffect(() => {
    if (!currentUserId) return
    let active = true

    getMyProfile()
      .then((value) => {
        if (active) setEntry({ userId: currentUserId, profile: value })
      })
      .catch(() => {
        if (active) setEntry({ userId: currentUserId, profile: null })
      })

    return () => {
      active = false
    }
  }, [currentUserId])

  // Si cambió el usuario o cerró sesión, el perfil guardado no corresponde.
  const profile = entry.userId === currentUserId ? entry.profile : null

  const refreshProfile = useCallback(async () => {
    if (!currentUserId) return
    try {
      setEntry({ userId: currentUserId, profile: await getMyProfile() })
    } catch {
      setEntry({ userId: currentUserId, profile: null })
    }
  }, [currentUserId])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      configured: Boolean(supabase),
      session,
      user: session?.user ?? null,
      profile,
      isAdmin: profile?.role === 'admin_general',
      suspended: Boolean(profile?.suspended),
      refreshProfile,
    }),
    [loading, session, supabase, profile, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

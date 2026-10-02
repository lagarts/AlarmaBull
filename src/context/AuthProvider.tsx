import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'

type AuthState = {
  loading: boolean
  configured: boolean
  session: Session | null
  user: User | null
  isAdmin: boolean
}

const AuthContext = createContext<AuthState>({
  loading: true,
  configured: false,
  session: null,
  user: null,
  isAdmin: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

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

  const value = useMemo<AuthState>(
    () => ({
      loading,
      configured: Boolean(supabase),
      session,
      user: session?.user ?? null,
      isAdmin: false,
    }),
    [loading, session, supabase],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

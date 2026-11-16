import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { AuthContext, type AuthContextValue } from './authContextValue'
import type { AuthSession, AuthUser, UserRole } from './types'

const STORAGE_KEY = 'smartfix.auth.session'

const demoUsers: Record<UserRole, AuthUser> = {
  resident: {
    id: 'demo-resident-sodeeq',
    name: 'Sodeeq Alli',
    email: 'sodeeq@example.com',
    role: 'resident',
  },
  crew: {
    id: 'demo-crew-sodeeq',
    name: 'Sodeeq Alli',
    email: 'sodeeq.crew@example.com',
    role: 'crew',
  },
  operator: {
    id: 'demo-operator-sodeeq',
    name: 'Sodeeq Alli',
    email: 'sodeeq.operator@example.com',
    role: 'operator',
  },
}

function readStoredSession(): AuthSession | null {
  const value = window.localStorage.getItem(STORAGE_KEY)
  if (!value) return null

  try {
    return JSON.parse(value) as AuthSession
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    setSession(readStoredSession())
    setIsReady(true)
  }, [])

  const signInAs = useCallback((role: UserRole) => {
    const nextSession: AuthSession = {
      accessToken: `demo-${role}-token`,
      user: demoUsers[role],
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
    setSession(nextSession)
  }, [])

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    setSession(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      session,
      user: session?.user ?? null,
      signInAs,
      signOut,
    }),
    [isReady, session, signInAs, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

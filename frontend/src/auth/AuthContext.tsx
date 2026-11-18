import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  api,
  loadStoredSession,
  setToken,
  setUnauthorizedHandler,
  storeSession,
} from '../api/client'
import type { AuthSession, AuthUser, UserRole } from '../api/types'

interface AuthValue {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<AuthUser>
  register: (
    fullName: string,
    email: string,
    password: string,
  ) => Promise<AuthUser>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

const initial = loadStoredSession<AuthSession>()
setToken(initial?.access_token ?? null)

// Shared with route guards and login redirects.
// eslint-disable-next-line react-refresh/only-export-components
export function homeFor(role: UserRole): string {
  if (role === 'resident') return '/resident/reports'
  if (role === 'crew') return '/crew'
  return '/ops/map'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(initial)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const apply = useCallback(
    (next: AuthSession | null) => {
      setToken(next?.access_token ?? null)
      storeSession(next)
      setSession(next)
      queryClient.clear()
    },
    [queryClient],
  )

  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        apply(null)
        navigate('/login', { replace: true })
      }),
    [apply, navigate],
  )

  // Refresh the profile once (role or crew may have changed since the token was stored).
  useEffect(() => {
    if (!initial) return
    api
      .get<AuthUser>('/auth/me')
      .then((user) => setSession((s) => (s ? { ...s, user } : s)))
      .catch(() => undefined)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      login: async (email, password) => {
        const next = await api.post<AuthSession>('/auth/login', {
          email,
          password,
        })
        apply(next)
        return next.user
      },
      register: async (full_name, email, password) => {
        const next = await api.post<AuthSession>('/auth/register', {
          full_name,
          email,
          password,
        })
        apply(next)
        return next.user
      },
      logout: () => {
        apply(null)
        navigate('/login', { replace: true })
      },
    }),
    [session, apply, navigate],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

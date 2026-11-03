import { createContext } from 'react'
import type { AuthSession, AuthUser, UserRole } from './types'

export interface AuthContextValue {
  isReady: boolean
  session: AuthSession | null
  user: AuthUser | null
  signInAs: (role: UserRole) => void
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)

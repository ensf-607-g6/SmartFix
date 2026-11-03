export const roles = ['resident', 'crew', 'operator'] as const

export type UserRole = (typeof roles)[number]

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface AuthSession {
  accessToken: string
  user: AuthUser
}

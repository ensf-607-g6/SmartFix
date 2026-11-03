import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullPageLoader } from '../components/FullPageLoader'
import type { UserRole } from './types'
import { useAuth } from './useAuth'

interface ProtectedRouteProps {
  allowedRoles: UserRole[]
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isReady, user } = useAuth()
  const location = useLocation()

  if (!isReady) return <FullPageLoader />

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={`/${user.role}`} replace />
  }

  return <Outlet />
}

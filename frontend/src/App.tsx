import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import type { UserRole } from './api/types'
import { homeFor, useAuth } from './auth/AuthContext'
import { AppShell } from './layouts/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />
  }

  return <Outlet />
}

function Home() {
  const { user } = useAuth()
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route element={<RequireRole roles={['resident']} />}>
          <Route
            path="/resident/reports"
            element={<DashboardPage role="resident" />}
          />
        </Route>
        <Route element={<RequireRole roles={['crew']} />}>
          <Route path="/crew" element={<DashboardPage role="crew" />} />
        </Route>
        <Route element={<RequireRole roles={['operator', 'supervisor']} />}>
          <Route path="/ops/map" element={<DashboardPage role="operator" />} />
        </Route>
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  )
}

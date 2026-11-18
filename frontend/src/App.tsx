import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import type { UserRole } from './api/types'
import { homeFor, useAuth } from './auth/AuthContext'
import { AppShell } from './layouts/AppShell'
import { LoginPage } from './pages/LoginPage'
import { CrewPage } from './pages/crew/CrewPage'
import { LiveMapPage } from './pages/ops/LiveMapPage'
import { ReviewPage } from './pages/ops/ReviewPage'
import { StatsPage } from './pages/ops/StatsPage'
import { MyReportsPage } from './pages/resident/MyReportsPage'
import { NewReportPage } from './pages/resident/NewReportPage'
import { ReportDetailPage } from './pages/resident/ReportDetailPage'

function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
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
          <Route path="/resident/new" element={<NewReportPage />} />
          <Route path="/resident/reports" element={<MyReportsPage />} />
          <Route path="/resident/reports/:reportId" element={<ReportDetailPage />} />
        </Route>
        <Route element={<RequireRole roles={['crew']} />}>
          <Route path="/crew" element={<CrewPage />} />
        </Route>
        <Route element={<RequireRole roles={['operator', 'supervisor']} />}>
          <Route path="/ops/map" element={<LiveMapPage />} />
          <Route path="/ops/review" element={<ReviewPage />} />
          <Route path="/ops/stats" element={<StatsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  )
}

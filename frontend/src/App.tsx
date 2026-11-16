import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute allowedRoles={['resident']} />}>
        <Route path="/resident" element={<DashboardPage role="resident" />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={['crew']} />}>
        <Route path="/crew" element={<DashboardPage role="crew" />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={['operator']} />}>
        <Route path="/operator" element={<DashboardPage role="operator" />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

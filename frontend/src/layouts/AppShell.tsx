import {
  ClipboardList,
  FilePlus2,
  HardHat,
  LogOut,
  Map as MapIcon,
} from 'lucide-react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import type { UserRole } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV: Record<UserRole, NavItem[]> = {
  resident: [
    {
      to: '/resident/new',
      label: 'Report a problem',
      icon: FilePlus2,
    },
    {
      to: '/resident/reports',
      label: 'My reports',
      icon: ClipboardList,
    },
  ],
  crew: [{ to: '/crew', label: 'Work orders', icon: HardHat }],
  operator: [{ to: '/ops/map', label: 'Live map', icon: MapIcon }],
  supervisor: [{ to: '/ops/map', label: 'Live map', icon: MapIcon }],
}

const ROLE_LABEL: Record<UserRole, string> = {
  resident: 'Resident',
  crew: 'Repair crew',
  operator: 'City operator',
  supervisor: 'Supervisor',
}

export function AppShell() {
  const { user, logout } = useAuth()

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex w-full shrink-0 items-center gap-3 bg-ink-900 px-3 py-3 text-ink-100 md:w-64 md:flex-col md:items-stretch md:gap-0 md:px-0 md:py-0">
        <div className="hidden px-6 pb-6 pt-7 md:block">
          <Brand dark />
        </div>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:block md:space-y-1 md:px-3">
          {NAV[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `group flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition md:gap-3 ${
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-ink-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`hidden h-5 w-1 rounded-full md:block ${
                      isActive ? 'bg-accent-500' : 'bg-transparent'
                    }`}
                  />
                  <item.icon className="h-[18px] w-[18px]" />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 hidden rounded-xl bg-white/5 p-4 md:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-white">
              {user.full_name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {user.full_name}
              </p>
              <p className="truncate text-xs text-ink-300">
                {ROLE_LABEL[user.role]}
                {user.crew_name && ` · ${user.crew_name}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-xs font-medium text-ink-200 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

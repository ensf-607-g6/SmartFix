import { useQuery } from '@tanstack/react-query'
import { BarChart3, ClipboardCheck, ClipboardList, FilePlus2, HardHat, ListChecks, LogOut, Map as MapIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api/client'
import type { Summary, UserRole } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'
import { NotificationBell } from '../components/NotificationBell'
import { useLive } from '../lib/live'

interface NavItem {
  to: string
  label: 'nav.reportProblem' | 'nav.myReports' | 'nav.workOrders' | 'nav.liveMap' | 'nav.reviewQueue' | 'nav.repairStatistics'
  icon: React.ComponentType<{ className?: string }>
  badge?: 'reviews'
}

const NAV: Record<UserRole, NavItem[]> = {
  resident: [
    { to: '/resident/new', label: 'nav.reportProblem', icon: FilePlus2 },
    { to: '/resident/reports', label: 'nav.myReports', icon: ClipboardList },
  ],
  crew: [{ to: '/crew', label: 'nav.workOrders', icon: HardHat }],
  operator: [
    { to: '/ops/map', label: 'nav.liveMap', icon: MapIcon },
    { to: '/ops/review', label: 'nav.reviewQueue', icon: ClipboardCheck, badge: 'reviews' },
    { to: '/ops/stats', label: 'nav.repairStatistics', icon: BarChart3 },
  ],
  supervisor: [
    { to: '/ops/map', label: 'nav.liveMap', icon: MapIcon },
    { to: '/ops/review', label: 'nav.reviewQueue', icon: ClipboardCheck, badge: 'reviews' },
    { to: '/ops/stats', label: 'nav.repairStatistics', icon: BarChart3 },
  ],
}

const ROLE_LABEL = {
  resident: 'roles.resident',
  crew: 'roles.crew',
  operator: 'roles.operator',
  supervisor: 'roles.supervisor',
} as const satisfies Record<UserRole, string>

export function AppShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { connected } = useLive()
  const staff = user?.role === 'operator' || user?.role === 'supervisor'
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<Summary>('/dashboard/summary'),
    enabled: staff,
  })
  if (!user) return null

  return (
    <div className="flex h-full">
      <a
        href="#main-content"
        className="sr-only z-[3000] rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('a11y.skipToContent')}
      </a>
      <aside className="flex w-64 shrink-0 flex-col bg-ink-900 text-ink-100">
        <div className="px-6 pb-6 pt-7">
          <Brand dark />
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label={t('a11y.mainNav')}>
          {NAV[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden className={`h-5 w-1 rounded-full ${isActive ? 'bg-accent-500' : 'bg-transparent'}`} />
                  <item.icon aria-hidden className="h-[18px] w-[18px]" />
                  <span className="flex-1">{t(item.label)}</span>
                  {item.badge === 'reviews' && !!summary?.pending_reviews && (
                    <>
                      <span aria-hidden className="rounded-full bg-accent-500 px-2 py-0.5 text-[11px] font-bold text-ink-950">
                        {summary.pending_reviews}
                      </span>
                      <span className="sr-only">, {t('a11y.reviewBadge', { count: summary.pending_reviews })}</span>
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-xl bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <div aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-white">
              {user.full_name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.full_name}</p>
              <p className="truncate text-xs text-ink-300">
                {t(ROLE_LABEL[user.role])}
                {user.crew_name && ` · ${user.crew_name}`}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-xs font-medium text-ink-200 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut aria-hidden className="h-3.5 w-3.5" /> {t('shell.signOut')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-end gap-4 border-b border-paper-300 bg-paper px-8">
          <span className="flex items-center gap-2 text-xs font-medium text-ink-500" title={t('shell.liveTitle')} role="status">
            <span aria-hidden className={`h-2 w-2 rounded-full ${connected ? 'bg-ink-600' : 'bg-ink-200'}`}>
              {connected && <span className="pulse-ring block h-2 w-2 rounded-full bg-ink-400" />}
            </span>
            {connected ? t('shell.live') : t('shell.reconnecting')}
          </span>
          {staff && summary && (
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-100">
              <ListChecks aria-hidden className="h-3.5 w-3.5" /> {t('shell.openIssues', { count: summary.open })}
            </span>
          )}
          <NotificationBell />
        </header>
        {/* Focusable so keyboard users can scroll it, and the skip link has a target. */}
        <main
          id="main-content"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}

import {
  BarChart3,
  Bell,
  ClipboardList,
  FilePlus2,
  LogOut,
  Map,
  Menu,
  Users,
  X,
} from 'lucide-react'
import { useState, type PropsWithChildren } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { UserRole } from '../auth/types'
import { Brand } from '../components/Brand'

const roleLabels: Record<UserRole, string> = {
  resident: 'Resident',
  crew: 'Repair crew',
  operator: 'City operator',
}

const roleNav = {
  resident: [
    { label: 'My reports', icon: ClipboardList },
    { label: 'New report', icon: FilePlus2 },
    { label: 'Notifications', icon: Bell },
  ],
  crew: [
    { label: 'Work orders', icon: ClipboardList },
    { label: 'Service map', icon: Map },
    { label: 'Notifications', icon: Bell },
  ],
  operator: [
    { label: 'Live map', icon: Map },
    { label: 'Review queue', icon: ClipboardList },
    { label: 'Crews', icon: Users },
    { label: 'Analytics', icon: BarChart3 },
  ],
} satisfies Record<UserRole, { label: string; icon: typeof Map }[]>

interface AppShellProps extends PropsWithChildren {
  role: UserRole
  title: string
  eyebrow: string
}

export function AppShell({ role, title, eyebrow, children }: AppShellProps) {
  const { user, signOut } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#f6f7f3] text-slate-900">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-forest-900/10 bg-white/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          className="rounded-lg p-2 text-forest-900 hover:bg-forest-50"
          onClick={() => setMobileNavOpen((open) => !open)}
          aria-label="Toggle navigation"
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X /> : <Menu />}
        </button>
      </header>

      <aside
        className={`${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-forest-900/10 bg-white px-5 py-6 transition-transform lg:translate-x-0`}
      >
        <Brand />

        <div className="mt-9 rounded-2xl bg-forest-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest-600">
            Signed in as
          </p>
          <p className="mt-2 font-semibold text-forest-950">{user?.name}</p>
          <p className="text-sm text-forest-700">{roleLabels[role]}</p>
        </div>

        <nav
          className="mt-8 space-y-2"
          aria-label={`${roleLabels[role]} navigation`}
        >
          {roleNav[role].map(({ label, icon: Icon }, index) => (
            <NavLink
              key={label}
              to={`/${role}`}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  isActive && index === 0
                    ? 'bg-forest-900 text-white shadow-lg shadow-forest-950/15'
                    : 'text-slate-600 hover:bg-forest-50 hover:text-forest-900'
                }`
              }
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={signOut}
          className="mt-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Sign out
        </button>
      </aside>

      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/25 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="px-5 py-8 sm:px-8 lg:ml-72 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-forest-600">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {title}
          </h1>
          {children}
        </div>
      </main>
    </div>
  )
}

import { ClipboardList, HardHat, Map as MapIcon } from 'lucide-react'
import type { UserRole } from '../api/types'

const CONTENT = {
  resident: {
    title: 'My reports',
    body: 'Track submitted reports and receive repair updates.',
    icon: ClipboardList,
  },
  crew: {
    title: 'Work orders',
    body: 'Review assigned work and update repair progress.',
    icon: HardHat,
  },
  operator: {
    title: 'Live map',
    body: 'Monitor reported infrastructure issues across the city.',
    icon: MapIcon,
  },
} as const

export function DashboardPage({ role }: { role: UserRole }) {
  const page = CONTENT[role === 'supervisor' ? 'operator' : role]
  const Icon = page.icon

  return (
    <div className="px-8 py-8">
      <div className="card max-w-3xl p-8">
        <Icon className="h-8 w-8 text-ink-600" />
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink-900">
          {page.title}
        </h1>
        <p className="mt-2 text-sm text-ink-500">{page.body}</p>
      </div>
    </div>
  )
}

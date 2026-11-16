import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  MapPin,
} from 'lucide-react'
import type { UserRole } from '../auth/types'
import { AppShell } from '../layouts/AppShell'

const copy: Record<
  UserRole,
  {
    eyebrow: string
    title: string
    intro: string
    stats: { label: string; value: string; note: string }[]
  }
> = {
  resident: {
    eyebrow: 'Resident workspace',
    title: 'Your neighbourhood, clearly tracked.',
    intro:
      'Report infrastructure damage and see what happens next without chasing for updates.',
    stats: [
      { label: 'Active reports', value: '3', note: 'One crew assigned' },
      { label: 'Recently fixed', value: '7', note: 'Past 90 days' },
      {
        label: 'Awaiting confirmation',
        value: '1',
        note: 'Your response needed',
      },
    ],
  },
  crew: {
    eyebrow: 'Repair crew workspace',
    title: 'Today’s work, in the right order.',
    intro:
      'Review assignments, update progress, and document completed repairs from one place.',
    stats: [
      { label: 'Assigned today', value: '6', note: 'Two high priority' },
      { label: 'In progress', value: '2', note: 'Across northwest Calgary' },
      { label: 'Completed', value: '4', note: 'This week' },
    ],
  },
  operator: {
    eyebrow: 'Operator workspace',
    title: 'A live view of the city’s repair queue.',
    intro:
      'Monitor open issues, review uncertain reports, and keep crews focused on urgent work.',
    stats: [
      { label: 'Open issues', value: '48', note: 'Five escalated' },
      { label: 'Needs review', value: '9', note: 'Three added today' },
      { label: 'Crews active', value: '12', note: 'Across six zones' },
    ],
  },
}

export function DashboardPage({ role }: { role: UserRole }) {
  const page = copy[role]

  return (
    <AppShell role={role} title={page.title} eyebrow={page.eyebrow}>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
        {page.intro}
      </p>

      <section
        className="mt-10 grid gap-4 md:grid-cols-3"
        aria-label="Workspace summary"
      >
        {page.stats.map((stat) => (
          <article
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card"
          >
            <p className="text-sm font-medium text-slate-500">{stat.label}</p>
            <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
              {stat.value}
            </p>
            <p className="mt-3 text-sm text-forest-700">{stat.note}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-semibold text-slate-950">Recent activity</h2>
              <p className="mt-1 text-sm text-slate-500">
                Representative data until API integration.
              </p>
            </div>
            <button className="inline-flex items-center gap-2 text-sm font-semibold text-forest-700">
              View all <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              {
                icon: AlertTriangle,
                title: 'Pothole reported',
                meta: '16 Avenue NW · High priority',
                tone: 'amber',
              },
              {
                icon: Clock3,
                title: 'Crew assigned',
                meta: 'Streetlight repair · 42 minutes ago',
                tone: 'blue',
              },
              {
                icon: CheckCircle2,
                title: 'Repair completed',
                meta: 'Sidewalk crack · Awaiting confirmation',
                tone: 'green',
              },
            ].map(({ icon: Icon, title, meta, tone }) => (
              <div key={title} className="flex items-center gap-4 px-6 py-5">
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    tone === 'amber'
                      ? 'bg-amber-50 text-amber-700'
                      : tone === 'blue'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-medium text-slate-900">{title}</p>
                  <p className="mt-1 text-sm text-slate-500">{meta}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="relative min-h-80 overflow-hidden rounded-2xl bg-forest-950 p-6 text-white shadow-card">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-forest-500/25 blur-3xl" />
          <div className="relative z-10">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10">
              <MapPin className="h-5 w-5 text-amber" />
            </span>
            <h2 className="mt-6 text-xl font-semibold">Live map ready</h2>
            <p className="mt-3 text-sm leading-6 text-forest-100/75">
              The routing and workspace shell are in place. React-Leaflet can be
              added in SF-38 without changing this application structure.
            </p>
          </div>
          <div className="absolute bottom-6 left-6 right-6 grid grid-cols-3 gap-2">
            {[38, 62, 47, 71, 54, 82].map((height, index) => (
              <div
                key={index}
                className="rounded-t bg-forest-400/50"
                style={{ height: `${height}px` }}
              />
            ))}
          </div>
        </article>
      </section>
    </AppShell>
  )
}

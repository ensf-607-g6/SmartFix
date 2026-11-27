import { useQuery } from '@tanstack/react-query'
import { AlertOctagon, Gauge, Timer, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { Crew, DeadLetter, Stats, Summary } from '../../api/types'
import { ProblemIcon } from '../../components/ProblemIcon'
import { PageHeader, PageLoader } from '../../components/ui'
import { eventLabel, formatDateTime, humanize } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

interface Bar {
  key: string
  label: string
  value: number
  display: string
  detail: string
  icon?: string
}

/** Single-series horizontal bars: one colour, value labels in text ink, hover for detail. */
function BarList({ bars, empty }: { bars: Bar[]; empty: string }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(1, ...bars.map((b) => b.value))
  if (!bars.length) return <p className="py-8 text-center text-sm text-ink-500">{empty}</p>
  return (
    <ul className="space-y-3">
      {bars.map((b) => (
        <li
          key={b.key}
          className="relative grid grid-cols-[150px_1fr_64px] items-center gap-3"
          onMouseEnter={() => setHover(b.key)}
          onMouseLeave={() => setHover(null)}
          // Keyboard users can reach each bar and see the same detail as on hover.
          tabIndex={0}
          onFocus={() => setHover(b.key)}
          onBlur={() => setHover(null)}
        >
          <span aria-hidden className="flex items-center gap-2 truncate text-sm text-ink-700">
            {b.icon && <ProblemIcon code={b.icon} className="h-3.5 w-3.5 text-ink-400" />}
            {b.label}
          </span>
          <span className="sr-only">{t('a11y.barDetail', { label: b.label, value: b.display, detail: b.detail })}</span>
          <span aria-hidden className="h-6 rounded bg-paper-200/60">
            <span
              className={`block h-full rounded-r transition-colors ${hover === b.key ? 'bg-ink-900' : 'bg-ink-700'}`}
              style={{ width: b.value > 0 ? `${Math.max(1.5, (b.value / max) * 100)}%` : 0 }}
            />
          </span>
          <span aria-hidden className="text-right text-sm font-semibold tabular-nums text-ink-900">{b.display}</span>
          {hover === b.key && (
            <span aria-hidden className="pointer-events-none absolute -top-9 left-[160px] z-10 whitespace-nowrap rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lift">
              {b.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Tile({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        <Icon aria-hidden className="h-4 w-4 text-ink-300" />
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function StatsPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('stats.title'))
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') })
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: () => api.get<Summary>('/dashboard/summary') })
  const { data: crews = [] } = useQuery({ queryKey: ['crews'], queryFn: () => api.get<Crew[]>('/crews') })
  const { data: dead = [] } = useQuery({ queryKey: ['dead-letters'], queryFn: () => api.get<DeadLetter[]>('/dead-letters') })
  if (!stats || !summary) return <PageLoader />

  const repairs = stats.repair_stats.reduce((n, r) => n + r.repairs, 0)
  const avgHours = repairs
    ? stats.repair_stats.reduce((s, r) => s + Number(r.avg_repair_hours) * r.repairs, 0) / repairs
    : null
  const metPct = repairs ? stats.repair_stats.reduce((s, r) => s + Number(r.pct_met_deadline) * r.repairs, 0) / repairs : null
  const lat = summary.validation_latency
  const confirmations = stats.confirmations
  const answered = (confirmations.confirmed ?? 0) + (confirmations.disputed ?? 0) + (confirmations.auto_closed ?? 0)

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <PageHeader title={t('stats.title')} subtitle={t('stats.subtitle')} />

      <div className="grid grid-cols-4 gap-4">
        <Tile
          label={t('stats.avgRepairTime')}
          value={
            avgHours === null
              ? '—'
              : avgHours < 1
                ? t('stats.minutesValue', { count: Math.round(avgHours * 60) })
                : t('stats.hoursValue', { value: avgHours.toFixed(1) })
          }
          sub={t('stats.avgRepairSub', { count: repairs })}
          icon={Timer}
        />
        <Tile
          label={t('stats.metDeadline')}
          value={metPct === null ? '—' : `${metPct.toFixed(0)}%`}
          sub={t('stats.metDeadlineSub')}
          icon={Wrench}
        />
        <Tile
          label={t('stats.photoCheck')}
          value={lat.p95_ms ? t('stats.secondsValue', { value: (lat.p95_ms / 1000).toFixed(1) }) : '—'}
          sub={lat.runs ? t('stats.photoCheckSub', { pct: lat.pct_under_15s, runs: lat.runs }) : t('stats.photoCheckNone')}
          icon={Gauge}
        />
        <Tile
          label={t('stats.disputed')}
          value={answered ? `${Math.round((100 * (confirmations.disputed ?? 0)) / answered)}%` : '—'}
          sub={t('stats.disputedSub', {
            confirmed: confirmations.confirmed ?? 0,
            disputed: confirmations.disputed ?? 0,
            autoClosed: confirmations.auto_closed ?? 0,
          })}
          icon={AlertOctagon}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <Card title={t('stats.byTypeTitle')} subtitle={t('stats.byTypeSubtitle')}>
          <BarList
            empty={t('stats.byTypeEmpty')}
            bars={stats.repair_stats.map((r) => ({
              key: r.problem_type,
              icon: r.problem_type,
              label: r.display_name,
              value: Number(r.avg_repair_hours),
              display: t('stats.hoursValue', { value: Number(r.avg_repair_hours).toFixed(1) }),
              detail: t('stats.repairDetail', { count: r.repairs, pct: Number(r.pct_met_deadline).toFixed(0) }),
            }))}
          />
        </Card>
        <Card title={t('stats.openByTypeTitle')} subtitle={t('stats.openByTypeSubtitle')}>
          <BarList
            empty={t('stats.openByTypeEmpty')}
            bars={stats.by_type.map((row) => ({
              key: row.code,
              icon: row.code,
              label: row.display_name,
              value: row.open,
              display: String(row.open),
              detail: t('stats.openDetail', { open: row.open, closed: row.closed }),
            }))}
          />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-[1.3fr_1fr] gap-6">
        <Card title={t('stats.workloadTitle')} subtitle={t('stats.workloadSubtitle')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500">
                <th scope="col" className="pb-2 font-medium">{t('stats.colCrew')}</th>
                <th scope="col" className="pb-2 font-medium">{t('stats.colHandles')}</th>
                <th scope="col" className="w-48 pb-2 font-medium">{t('stats.colLoad')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200">
              {crews.map((c) => (
                <tr key={c.crew_id}>
                  <td className="py-2.5 font-medium">{c.name}</td>
                  <td className="py-2.5 text-xs text-ink-500">{c.specialties.map(humanize).join(', ')}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-ink-50">
                        <span
                          className="block h-full rounded-full bg-ink-700"
                          style={{ width: `${(100 * c.active_orders) / c.max_active_orders}%` }}
                        />
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-ink-600">
                        {c.active_orders}/{c.max_active_orders}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('stats.hotspotsTitle')} subtitle={t('stats.hotspotsSubtitle')}>
          {!stats.hotspots.length ? (
            <p className="py-8 text-center text-sm text-ink-500">{t('stats.hotspotsEmpty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500">
                  <th scope="col" className="pb-2 font-medium">{t('stats.colArea')}</th>
                  <th scope="col" className="pb-2 text-right font-medium">{t('stats.colIssues')}</th>
                  <th scope="col" className="pb-2 text-right font-medium">{t('stats.colRepeat')}</th>
                  <th scope="col" className="pb-2 text-right font-medium">{t('stats.colStillOpen')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200 tabular-nums">
                {stats.hotspots.map((h) => (
                  <tr key={h.area_id}>
                    <td className="py-2.5 font-medium">{h.name}</td>
                    <td className="py-2.5 text-right">{h.issues_30d}</td>
                    <td className="py-2.5 text-right">{h.repeat_reports_30d}</td>
                    <td className="py-2.5 text-right">{h.still_open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <Card title={t('stats.eventsTitle')} subtitle={t('stats.eventsSubtitle')}>
          {!stats.events_24h.length ? (
            <p className="py-6 text-center text-sm text-ink-500">{t('stats.eventsEmpty')}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {stats.events_24h.map((e) => (
                <li key={e.event_name} className="flex justify-between border-b border-paper-200 pb-1.5">
                  <span className="text-ink-700">{eventLabel(e.event_name)}</span>
                  <span className="font-semibold tabular-nums">{e.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('stats.deadLetterTitle')} subtitle={t('stats.deadLetterSubtitle')}>
          {!dead.length ? (
            <p className="py-6 text-center text-sm text-ink-500">{t('stats.deadLetterEmpty')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {dead.slice(0, 8).map((d) => (
                <li key={d.dead_letter_id} className="rounded-lg bg-paper px-3 py-2">
                  <p className="font-medium">
                    {d.event_name ? eventLabel(d.event_name) : t('stats.unknownEvent')} → {humanize(d.consumer)}
                    <span className="ml-2 text-xs font-normal text-ink-500">{formatDateTime(d.failed_at)}</span>
                  </p>
                  <p className="truncate text-xs text-ink-600">{d.error_message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

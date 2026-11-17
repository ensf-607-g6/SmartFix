import { useQuery } from '@tanstack/react-query'
import { BarChart3, Clock3 } from 'lucide-react'
import { api } from '../../api/client'
import type { IssueStatus, Stats, Summary } from '../../api/types'
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PageLoader,
} from '../../components/ui'
import { STATUS_LABEL, humanize } from '../../lib/format'

const STATUS_ORDER: IssueStatus[] = [
  'reported',
  'validated',
  'prioritized',
  'assigned',
  'in_progress',
  'completed',
  'closed',
  'reopened',
  'escalated',
  'rejected',
  'merged',
]

function statusLabel(status: string): string {
  return STATUS_LABEL[status as IssueStatus] ?? humanize(status)
}

function hours(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function AnalyticsPage() {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/stats'),
    refetchInterval: 30000,
  })
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<Summary>('/dashboard/summary'),
    refetchInterval: 30000,
  })
  const repairs = (stats.data?.repair_stats ?? []).map((row) => ({
    ...row,
    average: hours(row.avg_repair_hours),
  }))
  const maxHours = Math.max(0, ...repairs.map((row) => row.average))
  const statusCounts = stats.data?.by_status ?? summary.data?.by_status
  const statuses = Object.entries(statusCounts ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const rankA = STATUS_ORDER.indexOf(a as IssueStatus)
      const rankB = STATUS_ORDER.indexOf(b as IssueStatus)
      return (
        (rankA < 0 ? STATUS_ORDER.length : rankA) -
          (rankB < 0 ? STATUS_ORDER.length : rankB) || a.localeCompare(b)
      )
    })
  const maxCount = Math.max(0, ...statuses.map(([, count]) => count))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="Analytics"
        subtitle="Repair time and issue status across the city."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-ink-600" />
            <h2 className="text-base font-semibold">Average repair time</h2>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Reported to completed, by problem type
          </p>
          {stats.isLoading && <PageLoader />}
          {stats.isError && (
            <div className="mt-5">
              <ErrorNote>
                Repair statistics could not be loaded.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void stats.refetch()}
                >
                  Try again
                </button>
              </ErrorNote>
            </div>
          )}
          {stats.data && repairs.length === 0 && (
            <EmptyState
              icon={<Clock3 className="h-5 w-5" />}
              title="No completed repairs yet"
              body="Repair times will appear when work orders are completed."
            />
          )}
          {repairs.length > 0 && (
            <div
              className="mt-7 space-y-6"
              role="list"
              aria-label="Average repair hours by problem type"
            >
              {repairs.map((row) => (
                <div key={row.problem_type} role="listitem">
                  <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium text-ink-900">
                        {row.display_name}
                      </span>
                      <span className="ml-2 text-xs text-ink-500">
                        {row.repairs} repair{row.repairs === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-ink-900">
                      {row.average.toFixed(1)} h
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink-50">
                    <div
                      className="h-full rounded-full bg-ink-700"
                      style={{
                        width: `${maxHours ? (row.average / maxHours) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-ink-600" />
            <h2 className="text-base font-semibold">Issues by status</h2>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Current count in each status
          </p>
          {!statusCounts && summary.isLoading && <PageLoader />}
          {!statusCounts && summary.isError && (
            <div className="mt-5">
              <ErrorNote>
                Issue counts could not be loaded.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void summary.refetch()}
                >
                  Try again
                </button>
              </ErrorNote>
            </div>
          )}
          {statusCounts && statuses.length === 0 && (
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title="No issues yet"
              body="Status counts will appear when reports are submitted."
            />
          )}
          {statuses.length > 0 && (
            <div
              className="mt-7 space-y-6"
              role="list"
              aria-label="Issue counts by status"
            >
              {statuses.map(([status, count]) => (
                <div key={status} role="listitem">
                  <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink-900">
                      {statusLabel(status)}
                    </span>
                    <span className="font-semibold tabular-nums text-ink-900">
                      {count}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink-50">
                    <div
                      className="h-full rounded-full bg-ink-700"
                      style={{
                        width: `${maxCount ? (count / maxCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

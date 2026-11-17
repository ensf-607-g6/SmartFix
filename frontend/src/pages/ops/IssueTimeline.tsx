import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { api } from '../../api/client'
import type { TimelineRow } from '../../api/types'
import { ErrorNote } from '../../components/ui'
import { eventLabel, humanize } from '../../lib/format'

function labelFor(row: TimelineRow): string {
  if (row.kind === 'event') return eventLabel(row.label)
  const [from, to] = row.label.split(' -> ')
  return to ? `${humanize(from)} → ${humanize(to)}` : humanize(row.label)
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? '—'
}

export function IssueTimeline({ issueId }: { issueId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['issue-events', issueId],
    queryFn: () => api.get<TimelineRow[]>(`/issues/${issueId}/events`),
    refetchInterval: 5000,
  })
  const rows = [...(data ?? [])].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )

  return (
    <section className="card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-ink-500" /> Issue history
      </h3>
      {isLoading && (
        <p className="mt-4 text-sm text-ink-500">Loading history…</p>
      )}
      {isError && (
        <div className="mt-4">
          <ErrorNote>
            Issue history could not be loaded.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void refetch()}
            >
              Try again
            </button>
          </ErrorNote>
        </div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="mt-4 text-sm text-ink-500">No history recorded yet.</p>
      )}
      {rows.length > 0 && (
        <ol className="mt-5 border-l-2 border-paper-200 pl-5">
          {rows.map((row, index) => {
            const date = new Date(row.at)
            const actor = row.actor_name ?? row.actor_id
            return (
              <li
                key={`${row.at}-${row.kind}-${row.label}-${index}`}
                className="relative pb-6 last:pb-0"
              >
                <span className="absolute -left-[29px] top-1 h-3.5 w-3.5 rounded-full border-[3px] border-white bg-ink-600" />
                <p className="text-sm font-semibold text-ink-900">
                  {labelFor(row)}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  <time dateTime={row.at}>
                    {date.toLocaleString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                  {' · '}
                  {actor ? `By ${actor}` : `Source: ${humanize(row.source)}`}
                </p>
                {row.detail && Object.keys(row.detail).length > 0 && (
                  <details className="mt-2 text-xs text-ink-600">
                    <summary className="cursor-pointer font-medium">
                      Event details
                    </summary>
                    <dl className="mt-2 space-y-1 rounded-md bg-ink-50 p-3">
                      {Object.entries(row.detail).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="min-w-24 font-medium">
                            {humanize(key)}
                          </dt>
                          <dd className="break-all">{detailValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

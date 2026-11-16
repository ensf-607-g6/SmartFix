import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  ClipboardList,
  Copy,
  FilePlus2,
  Hourglass,
  MessageSquareWarning,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, photoUrl } from '../../api/client'
import type { MyReport } from '../../api/types'
import { StatusStepper } from '../../components/StatusStepper'
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PageLoader,
  SeverityPill,
  StatusBadge,
} from '../../components/ui'
import { REPORT_STATUS_LABEL, timeAgo } from '../../lib/format'

export function MyReportsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => api.get<MyReport[]>('/reports/mine'),
    refetchInterval: 5000,
  })
  const waiting =
    data?.filter(
      (r) =>
        r.confirmation_status === 'pending' && r.issue_status === 'completed',
    ) ?? []

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="My reports"
        subtitle="Follow each problem you reported from photo to finished repair."
        actions={
          <Link to="/resident/new" className="btn-primary">
            <FilePlus2 className="h-4 w-4" /> Report a problem
          </Link>
        }
      />
      {isLoading && <PageLoader />}
      {isError && (
        <div className="mb-6">
          <ErrorNote>
            Reports could not be loaded.{' '}
            <button
              type="button"
              onClick={() => void refetch()}
              className="underline"
            >
              Try again
            </button>
          </ErrorNote>
        </div>
      )}
      {data && !data.length && (
        <EmptyState
          icon={<ClipboardList className="h-5 w-5" />}
          title="No reports yet"
          body="When you spot a pothole, broken light, leak or cracked sidewalk, report it here and we will keep you posted."
          action={
            <Link to="/resident/new" className="btn-primary">
              Report your first problem
            </Link>
          }
        />
      )}

      {!!waiting.length && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-accent-300 bg-accent-50 p-5">
          <MessageSquareWarning className="h-6 w-6 shrink-0 text-accent-700" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-900">
              {waiting.length === 1
                ? 'A repair is waiting for your answer'
                : `${waiting.length} repairs are waiting for your answer`}
            </p>
            <p className="text-sm text-ink-600">
              Tell us whether the problem is really fixed. Unanswered repairs
              close after 7 days.
            </p>
          </div>
          <Link
            to={`/resident/reports/${waiting[0].report_id}`}
            className="btn-primary"
          >
            Check the repair
          </Link>
        </div>
      )}

      <ul className="space-y-3">
        {data?.map((r) => (
          <li key={r.report_id}>
            <Link
              to={`/resident/reports/${r.report_id}`}
              className="card group flex gap-5 p-4 transition hover:shadow-lift"
            >
              <img
                src={photoUrl(r.photo_id)}
                alt=""
                className="h-28 w-36 shrink-0 rounded-lg bg-ink-50 object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-ink-900">
                        {r.problem_type_name}
                      </h3>
                      <StatusBadge
                        status={r.issue_status}
                        escalated={r.is_escalated}
                      />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-500">
                      {r.address_text ??
                        `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`}{' '}
                      · {timeAgo(r.submitted_at)}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
                </div>
                <div className="mt-auto flex items-center gap-6 pt-3">
                  <div className="min-w-0 flex-1 sm:max-w-[420px]">
                    {['rejected', 'merged'].includes(r.issue_status) ||
                    r.report_status === 'needs_review' ||
                    r.report_status === 'submitted' ? (
                      <p className="flex items-center gap-2 text-sm text-ink-600">
                        {r.report_status === 'submitted' ||
                        r.report_status === 'needs_review' ? (
                          <Hourglass className="h-4 w-4 text-ink-400" />
                        ) : null}
                        {REPORT_STATUS_LABEL[r.report_status]}
                      </p>
                    ) : (
                      <StatusStepper status={r.issue_status} compact />
                    )}
                  </div>
                  <SeverityPill severity={r.severity} />
                  {r.report_status === 'duplicate' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ink-500">
                      <Copy className="h-3.5 w-3.5" /> Joined an existing report
                    </span>
                  )}
                  {r.duplicate_count > 0 && r.report_status !== 'duplicate' && (
                    <span className="text-xs text-ink-500">
                      +{r.duplicate_count} others reported this
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

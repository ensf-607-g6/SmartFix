import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ClipboardList, Copy, FilePlus2, Hourglass, MessageSquareWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, photoUrl } from '../../api/client'
import type { MyReport } from '../../api/types'
import { StatusStepper } from '../../components/StatusStepper'
import { EmptyState, PageHeader, PageLoader, SeverityPill, StatusBadge } from '../../components/ui'
import { reportStatusLabel, timeAgo } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export function MyReportsPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('myReports.title'))
  const { data, isLoading } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => api.get<MyReport[]>('/reports/mine'),
  })
  const waiting = data?.filter((r) => r.confirmation_status === 'pending' && r.issue_status === 'completed') ?? []

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title={t('myReports.title')}
        subtitle={t('myReports.subtitle')}
        actions={
          <Link to="/resident/new" className="btn-primary">
            <FilePlus2 aria-hidden className="h-4 w-4" /> {t('myReports.reportProblem')}
          </Link>
        }
      />
      {isLoading && <PageLoader />}
      {data && !data.length && (
        <EmptyState
          icon={<ClipboardList aria-hidden className="h-5 w-5" />}
          title={t('myReports.emptyTitle')}
          body={t('myReports.emptyBody')}
          action={
            <Link to="/resident/new" className="btn-primary">
              {t('myReports.emptyAction')}
            </Link>
          }
        />
      )}

      {!!waiting.length && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-accent-300 bg-accent-50 p-5" role="status">
          <MessageSquareWarning aria-hidden className="h-6 w-6 shrink-0 text-accent-700" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-900">
              {t('myReports.waiting', { count: waiting.length })}
            </p>
            <p className="text-sm text-ink-600">{t('myReports.waitingBody')}</p>
          </div>
          <Link to={`/resident/reports/${waiting[0].report_id}`} className="btn-primary">
            {t('myReports.checkRepair')}
          </Link>
        </div>
      )}

      <ul className="space-y-3" aria-label={t('myReports.title')}>
        {data?.map((r) => (
          <li key={r.report_id}>
            <Link to={`/resident/reports/${r.report_id}`} className="card group flex gap-5 p-4 transition hover:shadow-lift">
              <img
                src={photoUrl(r.photo_id)}
                alt=""
                className="h-28 w-36 shrink-0 rounded-lg bg-ink-50 object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-ink-900">{r.problem_type_name}</h3>
                      <StatusBadge status={r.issue_status} escalated={r.is_escalated} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-500">
                      {r.address_text ?? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`} · {timeAgo(r.submitted_at)}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
                </div>
                <div className="mt-auto flex items-center gap-6 pt-3">
                  <div className="w-[420px]">
                    {['rejected', 'merged'].includes(r.issue_status) || r.report_status === 'needs_review' || r.report_status === 'submitted' ? (
                      <p className="flex items-center gap-2 text-sm text-ink-600">
                        {r.report_status === 'submitted' || r.report_status === 'needs_review' ? (
                          <Hourglass aria-hidden className="h-4 w-4 text-ink-400" />
                        ) : null}
                        {reportStatusLabel(r.report_status)}
                      </p>
                    ) : (
                      <StatusStepper status={r.issue_status} compact />
                    )}
                  </div>
                  <SeverityPill severity={r.severity} />
                  {r.report_status === 'duplicate' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ink-500">
                      <Copy aria-hidden className="h-3.5 w-3.5" /> {t('myReports.joinedExisting')}
                    </span>
                  )}
                  {r.duplicate_count > 0 && r.report_status !== 'duplicate' && (
                    <span className="text-xs text-ink-500">{t('myReports.othersReported', { count: r.duplicate_count })}</span>
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

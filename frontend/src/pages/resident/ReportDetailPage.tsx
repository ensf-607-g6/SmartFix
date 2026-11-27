import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, HardHat, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api, photoUrl } from '../../api/client'
import type { IssueDetail } from '../../api/types'
import { StatusStepper } from '../../components/StatusStepper'
import { BaseMap, IssueMarker } from '../../components/maps'
import { ErrorNote, KeyValue, PageLoader, Photo, SeverityPill, StatusBadge } from '../../components/ui'
import { formatDateTime, reportStatusLabel, statusLabel, timeAgo } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export function ReportDetailPage() {
  const { t } = useTranslation()
  const historyId = useId()
  const { reportId } = useParams()
  const { data: d, isLoading } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api.get<IssueDetail & { report_id: string }>(`/reports/${reportId}`),
  })
  useDocumentTitle(d?.problem_type_name ?? t('myReports.title'))
  if (isLoading || !d) return <PageLoader />

  const mine = d.reports[0]
  const wo = d.work_orders[0]
  const awaiting = wo?.confirmation_id && wo.confirmation_status === 'pending' && d.status === 'completed'
  const special = d.report_status === 'needs_review' || d.report_status === 'submitted' || d.status === 'rejected'

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <Link to="/resident/reports" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft aria-hidden className="h-4 w-4" /> {t('reportDetail.back')}
      </Link>
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{d.problem_type_name}</h1>
            <StatusBadge status={d.status} escalated={d.is_escalated} />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {d.address_text ?? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`}
            {mine && t('reportDetail.reportedAgo', { time: timeAgo(mine.submitted_at) })}
          </p>
        </div>
        <SeverityPill severity={d.severity} showLabel />
      </div>

      {awaiting && <ConfirmPanel confirmationId={wo.confirmation_id!} autoCloseAt={wo.auto_close_at} />}

      <div className="card mb-6 p-6">
        {special ? (
          <p className="text-sm text-ink-700">
            <span className="font-semibold">{t('reportDetail.statusSentence', { label: reportStatusLabel(d.report_status!) })}</span>{' '}
            {d.report_status === 'submitted' && t('reportDetail.submittedNote')}
            {d.report_status === 'needs_review' && t('reportDetail.needsReviewNote')}
            {d.status === 'rejected' && t('reportDetail.rejectedNote')}
          </p>
        ) : (
          <StatusStepper status={d.status} />
        )}
        {d.report_status === 'duplicate' && (
          <p className="mt-5 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">
            {t('reportDetail.duplicateNote')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold">{t('reportDetail.photos')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <figure>
                <Photo src={photoUrl(mine?.photo_id)} alt={t('reportDetail.yourPhoto')} className="aspect-[4/3] rounded-lg" />
                <figcaption className="mt-2 text-xs font-medium text-ink-500">{t('reportDetail.yourPhoto')}</figcaption>
              </figure>
              <figure>
                <Photo src={photoUrl(wo?.after_photo_id)} alt={t('reportDetail.afterAlt')} className="aspect-[4/3] rounded-lg" />
                <figcaption className="mt-2 text-xs font-medium text-ink-500">
                  {wo?.after_photo_id ? t('reportDetail.afterCaption') : t('reportDetail.afterPending')}
                </figcaption>
              </figure>
            </div>
            {mine?.description && (
              <p className="mt-4 rounded-lg bg-paper px-4 py-3 text-sm text-ink-700">{t('common.quoted', { text: mine.description })}</p>
            )}
          </div>

          {wo && (
            <div className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <HardHat aria-hidden className="h-4 w-4 text-ink-500" /> {t('reportDetail.repair')}
              </h2>
              <dl className="grid grid-cols-3 gap-4">
                <KeyValue label={t('reportDetail.crew')}>{wo.crew_name}</KeyValue>
                <KeyValue label={t('reportDetail.dueBy')}>{formatDateTime(wo.deadline_at)}</KeyValue>
                <KeyValue label={t('reportDetail.finished')}>{formatDateTime(wo.completed_at)}</KeyValue>
              </dl>
              {wo.crew_notes && <p className="mt-4 text-sm text-ink-600">{t('reportDetail.crewNotes', { notes: wo.crew_notes })}</p>}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card h-56 overflow-hidden">
            <BaseMap center={[d.lat, d.lng]} zoom={16} label={t('a11y.mapIssue')}>
              <IssueMarker lat={d.lat} lng={d.lng} severity={d.severity} escalated={d.is_escalated} />
            </BaseMap>
          </div>
          <div className="card p-5">
            <h2 id={historyId} className="mb-4 text-sm font-semibold">{t('reportDetail.history')}</h2>
            <ol className="relative space-y-4 border-l border-ink-100 pl-5" aria-labelledby={historyId}>
              {d.status_history.map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[26px] top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-ink-900 ring-4 ring-white" />
                  <p className="text-sm font-medium text-ink-900">{statusLabel(h.to_status)}</p>
                  <p className="text-xs text-ink-500">{formatDateTime(h.changed_at)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfirmPanel({ confirmationId, autoCloseAt }: { confirmationId: string; autoCloseAt: string | null }) {
  const { t } = useTranslation()
  const titleId = useId()
  const queryClient = useQueryClient()
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState('')
  const answer = useMutation({
    mutationFn: (action: 'confirm' | 'dispute') =>
      api.post(`/confirmations/${confirmationId}`, { action, reason: action === 'dispute' ? reason : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report'] })
      queryClient.invalidateQueries({ queryKey: ['my-reports'] })
    },
  })
  if (answer.isSuccess) {
    return (
      <div className="card mb-6 flex items-center gap-3 p-5 text-sm font-medium" role="status">
        <Check aria-hidden className="h-5 w-5" /> {t('confirm.recorded')}
      </div>
    )
  }
  return (
    <section className="mb-6 rounded-xl border border-accent-300 bg-accent-50 p-6" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">{t('confirm.title')}</h2>
      <p className="mt-1 text-sm text-ink-600">
        {t('confirm.body')}
        {autoCloseAt && t('confirm.autoClose', { date: formatDateTime(autoCloseAt) })}
      </p>
      {disputing ? (
        <div className="mt-4 space-y-3">
          <textarea
            className="input min-h-[80px]"
            placeholder={t('confirm.reasonPlaceholder')}
            aria-label={t('a11y.disputeReasonLabel')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="flex gap-3">
            <button className="btn-primary" disabled={!reason.trim() || answer.isPending} onClick={() => answer.mutate('dispute')}>
              {t('confirm.sendAgain')}
            </button>
            <button className="btn-ghost" onClick={() => setDisputing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-3">
          <button className="btn-primary" disabled={answer.isPending} onClick={() => answer.mutate('confirm')}>
            <ThumbsUp aria-hidden className="h-4 w-4" /> {t('confirm.yes')}
          </button>
          <button className="btn-secondary" onClick={() => setDisputing(true)}>
            <ThumbsDown aria-hidden className="h-4 w-4" /> {t('confirm.no')}
          </button>
        </div>
      )}
      {answer.isError && (
        <div className="mt-3">
          <ErrorNote>{(answer.error as Error).message}</ErrorNote>
        </div>
      )}
    </section>
  )
}

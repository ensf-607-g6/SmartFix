import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, ClipboardCheck, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, photoUrl } from '../../api/client'
import type { ProblemType, ReviewItem } from '../../api/types'
import { BaseMap, IssueMarker } from '../../components/maps'
import { EmptyState, ErrorNote, Field, PageHeader, PageLoader, Photo } from '../../components/ui'
import { pct, severityLabel, timeAgo } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export function ReviewPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('review.title'))
  const { data, isLoading } = useQuery({ queryKey: ['review'], queryFn: () => api.get<ReviewItem[]>('/review') })
  const { data: types = [] } = useQuery({
    queryKey: ['problem-types'],
    queryFn: () => api.get<ProblemType[]>('/problem-types'),
    staleTime: Infinity,
  })
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title={t('review.title')}
        subtitle={t('review.subtitle')}
      />
      {isLoading && <PageLoader />}
      {data && !data.length && (
        <EmptyState
          icon={<ClipboardCheck aria-hidden className="h-5 w-5" />}
          title={t('review.emptyTitle')}
          body={t('review.emptyBody')}
        />
      )}
      <div className="space-y-5" aria-live="polite">
        {data?.map((item) => <ReviewCard key={item.review_id} item={item} types={types} />)}
      </div>
    </div>
  )
}

function ReviewCard({ item, types }: { item: ReviewItem; types: ProblemType[] }) {
  const { t } = useTranslation()
  const titleId = useId()
  const queryClient = useQueryClient()
  const [severity, setSeverity] = useState<number>(item.ai_severity ?? 3)
  const [type, setType] = useState(item.ai_type ?? item.chosen_type)
  const [notes, setNotes] = useState('')
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api.post(`/review/${item.review_id}`, {
        approve,
        notes: notes.trim() || undefined,
        severity: approve ? severity : undefined,
        problem_type: approve ? type : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review'] })
      queryClient.invalidateQueries({ queryKey: ['summary'] })
    },
  })
  const unavailable = item.ai_model === 'unavailable'

  return (
    <article className="card grid grid-cols-[340px_1fr] overflow-hidden" aria-labelledby={titleId}>
      <div className="relative bg-ink-50">
        <Photo src={photoUrl(item.photo_id)} alt={t('review.photoAlt')} className="h-full min-h-[300px]" />
        <span className="absolute left-3 top-3 rounded-full bg-ink-900/90 px-3 py-1 text-xs font-semibold text-white">
          {item.reason === 'not_infrastructure' ? t('review.reasonNotInfrastructure') : t('review.reasonLowConfidence')}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_220px] gap-6 p-6">
        <div className="space-y-5">
          <div>
            <p className="text-xs text-ink-500">
              {t('review.reporterAndTime', { name: item.reporter_name, time: timeAgo(item.created_at) })}
            </p>
            <h2 id={titleId} className="mt-0.5 text-lg font-semibold">{t('review.residentChose', { type: item.chosen_type_name })}</h2>
            {item.description && <p className="mt-1 text-sm text-ink-600">{t('common.quoted', { text: item.description })}</p>}
            {item.address_text && <p className="mt-1 text-xs text-ink-500">{item.address_text}</p>}
          </div>

          <div className="rounded-lg bg-ink-50 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <Bot aria-hidden className="h-3.5 w-3.5" /> {t('review.aiAssessment')}
            </p>
            {unavailable ? (
              <p className="text-sm text-ink-700">{t('review.modelUnavailable')}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-ink-500">{t('review.detected')}</p>
                    <p className="font-semibold">{item.ai_type_name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">{t('review.severity')}</p>
                    <p className="font-semibold">{t('review.severityOutOfFive', { severity: item.ai_severity ?? '—' })}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">{t('review.confidence')}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <span className="block h-full rounded-full bg-ink-700" style={{ width: pct(item.ai_confidence) }} />
                      </span>
                      <span className="text-xs font-semibold tabular-nums">{pct(item.ai_confidence)}</span>
                    </div>
                  </div>
                </div>
                {item.ai_summary && <p className="mt-3 text-sm text-ink-600">{item.ai_summary}</p>}
                <p className="mt-2 text-[11px] text-ink-500">
                  {item.ai_is_infrastructure === false && t('review.notInfrastructure')}
                  {item.ai_model}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('review.problemType')}>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                {types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('review.severity')}>
              <select className="input" value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>
                    {t('review.severityOption', { severity: s, label: severityLabel(s) })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('review.note')}>
            <input
              className="input"
              placeholder={t('review.notePlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {decide.isError && <ErrorNote>{(decide.error as Error).message}</ErrorNote>}
          <div className="flex gap-3">
            <button className="btn-primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
              <Check aria-hidden className="h-4 w-4" /> {t('review.approve')}
            </button>
            <button className="btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
              <X aria-hidden className="h-4 w-4" /> {t('review.reject')}
            </button>
          </div>
        </div>
        <div className="h-full min-h-[220px] overflow-hidden rounded-lg">
          <BaseMap center={[item.lat, item.lng]} zoom={15} label={t('a11y.mapIssue')}>
            <IssueMarker lat={item.lat} lng={item.lng} severity={item.ai_severity} />
          </BaseMap>
        </div>
      </div>
    </article>
  )
}

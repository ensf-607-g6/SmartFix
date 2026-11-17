import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, ClipboardCheck, X } from 'lucide-react'
import { useState } from 'react'
import { api, photoUrl } from '../../api/client'
import type { ProblemType, ReviewItem } from '../../api/types'
import { BaseMap, IssueMarker } from '../../components/maps'
import {
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  PageLoader,
  Photo,
} from '../../components/ui'
import { SEVERITY_LABEL, pct, timeAgo } from '../../lib/format'

export function ReviewPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['review'],
    queryFn: () => api.get<ReviewItem[]>('/review'),
    refetchInterval: 5000,
  })
  const { data: types = [], isError: typesError } = useQuery({
    queryKey: ['problem-types'],
    queryFn: () => api.get<ProblemType[]>('/problem-types'),
    staleTime: Infinity,
  })
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="Review queue"
        subtitle="Reports the AI was unsure about, or that may not show public infrastructure. Approve to send them on, or reject."
      />
      {isLoading && <PageLoader />}
      {isError && (
        <div className="mb-6">
          <ErrorNote>
            Review items could not be loaded.{' '}
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
      {typesError && (
        <div className="mb-6">
          <ErrorNote>
            Problem types could not be loaded. Refresh before approving.
          </ErrorNote>
        </div>
      )}
      {data && !data.length && (
        <EmptyState
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="All caught up"
          body="New flagged reports appear here automatically as soon as the AI flags them."
        />
      )}
      <div className="space-y-5">
        {data?.map((item) => (
          <ReviewCard key={item.review_id} item={item} types={types} />
        ))}
      </div>
    </div>
  )
}

function ReviewCard({
  item,
  types,
}: {
  item: ReviewItem
  types: ProblemType[]
}) {
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
      void queryClient.invalidateQueries({ queryKey: ['review'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
      void queryClient.invalidateQueries({ queryKey: ['map'] })
    },
  })
  const unavailable = item.ai_model === 'unavailable'

  return (
    <article className="card grid overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="relative bg-ink-50">
        <Photo
          src={photoUrl(item.photo_id)}
          alt="Reported photo"
          className="h-60 sm:h-72 xl:h-full xl:min-h-[300px]"
        />
        <span className="absolute left-3 top-3 rounded-full bg-ink-900/90 px-3 py-1 text-xs font-semibold text-white">
          {item.reason === 'not_infrastructure'
            ? 'May not be infrastructure'
            : 'Low confidence'}
        </span>
      </div>
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-5">
          <div>
            <p className="text-xs text-ink-500">
              {item.reporter_name} · {timeAgo(item.created_at)}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold">
              Resident chose: {item.chosen_type_name}
            </h2>
            {item.description && (
              <p className="mt-1 text-sm text-ink-600">“{item.description}”</p>
            )}
            {item.address_text && (
              <p className="mt-1 text-xs text-ink-500">{item.address_text}</p>
            )}
          </div>

          <div className="rounded-lg bg-ink-50 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <Bot className="h-3.5 w-3.5" /> AI assessment
            </p>
            {unavailable ? (
              <p className="text-sm text-ink-700">
                The vision model was unavailable, so this report needs a person
                to check it.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-ink-500">Detected</p>
                    <p className="font-semibold">{item.ai_type_name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Severity</p>
                    <p className="font-semibold">
                      {item.ai_severity ?? '—'} / 5
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Confidence</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <span
                          className="block h-full rounded-full bg-ink-700"
                          style={{ width: pct(item.ai_confidence) }}
                        />
                      </span>
                      <span className="text-xs font-semibold tabular-nums">
                        {pct(item.ai_confidence)}
                      </span>
                    </div>
                  </div>
                </div>
                {item.ai_summary && (
                  <p className="mt-3 text-sm text-ink-600">{item.ai_summary}</p>
                )}
                <p className="mt-2 text-[11px] text-ink-400">
                  {item.ai_is_infrastructure === false &&
                    'Model says this is not public infrastructure · '}
                  {item.ai_model}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Problem type">
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select
                className="input"
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>
                    {s} · {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Note to the resident (optional)">
            <input
              className="input"
              placeholder="e.g. This looks like private property"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </Field>
          {decide.isError && <ErrorNote>{decide.error.message}</ErrorNote>}
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              disabled={decide.isPending || !types.length}
              onClick={() => decide.mutate(true)}
            >
              <Check className="h-4 w-4" /> Approve and prioritize
            </button>
            <button
              className="btn-secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate(false)}
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
        <div className="h-full min-h-[220px] overflow-hidden rounded-lg">
          <BaseMap center={[item.lat, item.lng]} zoom={15}>
            <IssueMarker
              lat={item.lat}
              lng={item.lng}
              severity={item.ai_severity}
            />
          </BaseMap>
        </div>
      </div>
    </article>
  )
}

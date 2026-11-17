import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ClipboardCheck,
  Hourglass,
  MapPinned,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type {
  IssueStatus,
  MapIssue,
  ProblemType,
  RepeatHeatCell,
  Summary,
} from '../../api/types'
import { ProblemIcon } from '../../components/ProblemIcon'
import {
  BaseMap,
  FlyTo,
  IssueMarker,
  RepeatHeatLayer,
  SeverityLegend,
} from '../../components/maps'
import { SeverityPill, StatusBadge } from '../../components/ui'
import { useLive } from '../../lib/live'
import {
  ALL_STATUSES,
  STATUS_LABEL,
  deadlineText,
  eventLabel,
  timeAgo,
} from '../../lib/format'
import { IssueDrawer } from './IssueDrawer'

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value]
}

export function LiveMapPage() {
  const [statuses, setStatuses] = useState<IssueStatus[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [severities, setSeverities] = useState<number[]>([])
  const [escalatedOnly, setEscalatedOnly] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<[number, number] | null>(null)
  const { lastEvent } = useLive()

  const params = new URLSearchParams()
  statuses.forEach((s) => params.append('status', s))
  types.forEach((t) => params.append('problem_type', t))
  severities.forEach((s) => params.append('severity', String(s)))
  if (escalatedOnly) params.set('escalated_only', 'true')
  const qs = params.toString()

  const {
    data: issues = [],
    isError: mapError,
    refetch: refetchMap,
  } = useQuery({
    queryKey: ['map', qs],
    queryFn: () => api.get<MapIssue[]>(`/dashboard/map?${qs}`),
    refetchInterval: 5000,
  })
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<Summary>('/dashboard/summary'),
  })
  const heatmap = useQuery({
    queryKey: ['repeat-heatmap'],
    queryFn: () => api.get<RepeatHeatCell[]>('/dashboard/heatmap'),
    enabled: showHeatmap,
    refetchInterval: 30000,
  })
  const { data: problemTypes = [] } = useQuery({
    queryKey: ['problem-types'],
    queryFn: () => api.get<ProblemType[]>('/problem-types'),
    staleTime: Infinity,
  })

  const open = (issue: MapIssue) => {
    setSelected(issue.issue_id)
    setFocus([issue.lat, issue.lng])
  }
  const filtersOn =
    statuses.length + types.length + severities.length + Number(escalatedOnly) >
    0

  return (
    <div className="grid min-h-[calc(100vh-4rem)] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative h-[60vh] min-h-[500px] xl:h-auto">
        <BaseMap>
          <FlyTo position={focus} />
          {showHeatmap && heatmap.data && (
            <RepeatHeatLayer cells={heatmap.data} />
          )}
          {issues.map((i) => (
            <IssueMarker
              key={i.issue_id}
              lat={i.lat}
              lng={i.lng}
              severity={i.severity}
              escalated={i.is_escalated}
              selected={i.issue_id === selected}
              label={`${i.problem_type_name} · ${STATUS_LABEL[i.status]}`}
              onClick={() => open(i)}
            />
          ))}
        </BaseMap>

        <div className="absolute left-4 right-4 top-4 z-[500] flex max-h-[55%] flex-wrap items-center gap-2 overflow-y-auto rounded-xl bg-white/95 p-3 shadow-card backdrop-blur">
          <span className="label mb-0 mr-1">Status</span>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatuses(toggle(statuses, s))}
              className={statuses.includes(s) ? 'chip-on' : 'chip-off'}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-ink-100" />
          <span className="label mb-0 mr-1">Type</span>
          {problemTypes.map((t) => (
            <button
              key={t.code}
              onClick={() => setTypes(toggle(types, t.code))}
              className={types.includes(t.code) ? 'chip-on' : 'chip-off'}
            >
              <ProblemIcon code={t.code} className="h-3.5 w-3.5" />
              {t.display_name}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-ink-100" />
          <span className="label mb-0 mr-1">Severity</span>
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => setSeverities(toggle(severities, s))}
              className={`${severities.includes(s) ? 'chip-on' : 'chip-off'} w-8 justify-center px-0`}
            >
              {s}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-ink-100" />
          <button
            onClick={() => setEscalatedOnly(!escalatedOnly)}
            className={escalatedOnly ? 'chip-on' : 'chip-off'}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Escalated only
          </button>
          {filtersOn && (
            <button
              className="ml-auto text-xs font-medium text-ink-500 hover:text-ink-900"
              onClick={() => {
                setStatuses([])
                setTypes([])
                setSeverities([])
                setEscalatedOnly(false)
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="absolute bottom-6 left-4 z-[500] flex flex-col items-start gap-2">
          <button
            type="button"
            className={
              showHeatmap ? 'chip-on shadow-card' : 'chip-off shadow-card'
            }
            aria-pressed={showHeatmap}
            onClick={() => setShowHeatmap((shown) => !shown)}
          >
            {showHeatmap ? 'Hide repeat heatmap' : 'Show repeat heatmap'}
          </button>
          {showHeatmap && heatmap.isLoading && (
            <p className="rounded-lg bg-white/95 px-3 py-2 text-xs text-ink-600 shadow-card">
              Loading repeat reports…
            </p>
          )}
          {showHeatmap && heatmap.isError && (
            <p className="rounded-lg bg-white/95 px-3 py-2 text-xs text-danger-700 shadow-card">
              Heatmap unavailable.{' '}
              <button
                className="underline"
                onClick={() => void heatmap.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {showHeatmap && heatmap.data?.length === 0 && (
            <p className="rounded-lg bg-white/95 px-3 py-2 text-xs text-ink-600 shadow-card">
              No repeat-report clusters in the last 30 days.
            </p>
          )}
          <SeverityLegend />
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-l border-paper-300 bg-paper-50">
        <div className="grid grid-cols-4 gap-px border-b border-paper-300 bg-paper-300">
          {[
            { label: 'Open', value: summary?.open, icon: MapPinned },
            {
              label: 'Escalated',
              value: summary?.escalated,
              icon: AlertTriangle,
              attention: !!summary?.escalated,
            },
            {
              label: 'No crew yet',
              value: summary?.awaiting_crew,
              icon: Hourglass,
            },
            {
              label: 'To review',
              value: summary?.pending_reviews,
              icon: ClipboardCheck,
            },
          ].map((k) => {
            const body = (
              <>
                <k.icon
                  className={`h-4 w-4 ${k.attention ? 'text-accent-600' : 'text-ink-400'}`}
                />
                <span className="mt-1.5 text-xl font-bold text-ink-900">
                  {k.value ?? '—'}
                </span>
                <span className="text-[11px] font-medium text-ink-500">
                  {k.label}
                </span>
              </>
            )
            return (
              <div key={k.label} className="flex flex-col bg-white px-4 py-3">
                {body}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-sm font-semibold">Priority queue</h2>
          <span className="text-xs text-ink-500">
            {issues.length} shown · highest first
          </span>
        </div>
        {lastEvent && (
          <p className="mx-5 mb-2 truncate rounded-md bg-ink-50 px-2.5 py-1.5 text-[11px] text-ink-600">
            Latest event:{' '}
            <span className="font-semibold">
              {eventLabel(lastEvent.event_name)}
            </span>{' '}
            · {timeAgo(lastEvent.occurred_at)}
          </p>
        )}
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-5">
          {mapError && (
            <li className="py-6 text-center text-sm text-ink-500">
              Map issues could not be loaded.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void refetchMap()}
              >
                Try again
              </button>
            </li>
          )}
          {!mapError && !issues.length && (
            <li className="py-10 text-center text-sm text-ink-400">
              No open issues match these filters
            </li>
          )}
          {issues.map((i, idx) => (
            <li key={i.issue_id}>
              <button
                onClick={() => open(i)}
                className={`card flex w-full items-start gap-3 p-3 text-left transition hover:shadow-lift ${
                  selected === i.issue_id ? 'ring-2 ring-ink-900' : ''
                } ${i.is_escalated ? 'border-l-4 border-l-accent-500' : ''}`}
              >
                <span className="w-5 pt-0.5 text-right text-xs font-semibold text-ink-400">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      <ProblemIcon
                        code={i.problem_type}
                        className="h-3.5 w-3.5 text-ink-500"
                      />
                      {i.problem_type_name}
                    </p>
                    <span className="text-sm font-bold tabular-nums text-ink-900">
                      {Number(i.priority_score).toFixed(1)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-ink-500">
                    {i.address_text ??
                      `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <StatusBadge status={i.status} escalated={i.is_escalated} />
                    <SeverityPill severity={i.severity} />
                  </div>
                  {(i.crew_name || i.duplicate_count > 0) && (
                    <p className="mt-1.5 truncate text-[11px] text-ink-500">
                      {i.crew_name &&
                        `${i.crew_name} · ${i.deadline_at ? deadlineText(i.deadline_at).text : ''}`}
                      {i.crew_name && i.duplicate_count > 0 && ' · '}
                      {i.duplicate_count > 0 &&
                        `${i.duplicate_count + 1} reports`}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <IssueDrawer issueId={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

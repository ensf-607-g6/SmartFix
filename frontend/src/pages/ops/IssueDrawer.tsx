import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, Bot, Radio, Send, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, photoUrl } from '../../api/client'
import type { Crew, IssueDetail, IssueWorkOrder, TimelineRow } from '../../api/types'
import { ProblemIcon } from '../../components/ProblemIcon'
import { Drawer, ErrorNote, KeyValue, PageLoader, Photo, SeverityPill, StatusBadge } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { STATUS_LABEL, deadlineText, eventLabel, formatDateTime, humanize, pct } from '../../lib/format'

export function IssueDrawer({ issueId, onClose }: { issueId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview')
  useEffect(() => setTab('overview'), [issueId])
  const { data: d } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => api.get<IssueDetail>(`/issues/${issueId}`),
    enabled: !!issueId,
  })

  return (
    <Drawer
      open={!!issueId}
      onClose={onClose}
      width="w-[620px]"
      title={
        d ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-white">
              <ProblemIcon code={d.problem_type} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold">{d.problem_type_name}</h2>
                <StatusBadge status={d.status} escalated={d.is_escalated} />
              </div>
              <p className="truncate text-xs text-ink-500">{d.address_text ?? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`}</p>
            </div>
          </div>
        ) : (
          'Issue'
        )
      }
    >
      {!d ? (
        <PageLoader />
      ) : (
        <>
          <div className="sticky top-0 z-10 flex gap-6 border-b border-paper-300 bg-white px-6">
            {(['overview', 'timeline'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b-2 py-3 text-sm font-medium ${tab === t ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800'}`}
              >
                {t === 'overview' ? 'Overview' : 'Event timeline'}
              </button>
            ))}
          </div>
          {tab === 'overview' ? <Overview d={d} /> : <Timeline issueId={d.issue_id} />}
        </>
      )}
    </Drawer>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Overview({ d }: { d: IssueDetail }) {
  const active = d.work_orders.find((w) => w.status === 'assigned' || w.status === 'in_progress')
  const latest = d.work_orders[0]
  const p = d.priority_history[0]
  return (
    <div className="space-y-4 p-6">
      <dl className="card grid grid-cols-4 gap-4 p-5">
        <KeyValue label="Priority score">
          <span className="text-lg font-bold">{d.priority_score ? Number(d.priority_score).toFixed(1) : '—'}</span>
        </KeyValue>
        <KeyValue label="Severity">
          <SeverityPill severity={d.severity} />
        </KeyValue>
        <KeyValue label="Reports">
          {d.reports.length}
          {d.duplicate_count > 0 && <span className="text-ink-500"> ({d.duplicate_count} merged)</span>}
        </KeyValue>
        <KeyValue label="Area">{d.area_name ?? 'Outside zones'}</KeyValue>
      </dl>
      {p && (
        <p className="-mt-1 px-1 text-xs text-ink-500">
          Score = severity {Number(p.severity_part).toFixed(0)} + duplicates {Number(p.duplicate_part).toFixed(0)}
          {d.reopen_count > 0 && ` + reopened ${d.reopen_count}×`} + aging since {formatDateTime(d.created_at)}
          {d.is_escalated && ' + escalation boost'} · last change: {humanize(p.reason)}
        </p>
      )}

      {d.status === 'prioritized' && !active && <DispatchPanel issueId={d.issue_id} problemType={d.problem_type} />}
      {latest && <WorkOrderPanel issueId={d.issue_id} wo={latest} severity={d.severity} problemType={d.problem_type} />}

      <Section title={`Resident reports (${d.reports.length})`} icon={<Bot className="h-4 w-4 text-ink-500" />}>
        <div className="space-y-4">
          {d.reports.map((r) => (
            <div key={r.report_id} className="flex gap-4">
              <Photo src={photoUrl(r.photo_id)} alt="Report photo" className="h-28 w-36 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {r.reporter_name} <span className="font-normal text-ink-500">· {formatDateTime(r.submitted_at)}</span>
                </p>
                {r.description && <p className="mt-1 text-ink-600">“{r.description}”</p>}
                {r.ai_model && (
                  <p className="mt-2 rounded-md bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">
                    AI: {r.ai_detected_type ?? '—'}, severity {r.ai_severity ?? '—'}, confidence {pct(r.ai_confidence)}
                    {r.ai_latency_ms != null && ` · ${(r.ai_latency_ms / 1000).toFixed(1)} s`} · {r.ai_model}
                    {r.ai_summary && <span className="mt-0.5 block text-ink-500">{r.ai_summary}</span>}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {d.work_orders.length > 1 && (
        <Section title="Earlier work orders">
          <ul className="space-y-2 text-sm">
            {d.work_orders.slice(1).map((w) => (
              <li key={w.work_order_id} className="flex justify-between">
                <span>
                  {w.crew_name} · {humanize(w.status)}
                </span>
                <span className="text-ink-500">
                  {w.confirmation_status === 'disputed' ? `Disputed: “${w.dispute_reason}”` : formatDateTime(w.completed_at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function useCrews() {
  return useQuery({ queryKey: ['crews'], queryFn: () => api.get<Crew[]>('/crews'), staleTime: 30_000 })
}

function CrewSelect({ value, onChange, problemType, exclude }: {
  value: string
  onChange: (v: string) => void
  problemType: string
  exclude?: number
}) {
  const { data: crews = [] } = useCrews()
  const options = crews
    .filter((c) => c.is_active && c.crew_id !== exclude)
    .sort((a, b) => Number(b.specialties.includes(problemType)) - Number(a.specialties.includes(problemType)))
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a crew…</option>
      {options.map((c) => (
        <option key={c.crew_id} value={c.crew_id}>
          {c.name} · {c.active_orders}/{c.max_active_orders} busy{c.specialties.includes(problemType) ? '' : ' · not a specialty'}
        </option>
      ))}
    </select>
  )
}

function DispatchPanel({ issueId, problemType }: { issueId: string; problemType: string }) {
  const queryClient = useQueryClient()
  const [crew, setCrew] = useState('')
  const send = useMutation({
    mutationFn: () => api.post(`/issues/${issueId}/dispatch`, { crew_id: Number(crew) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issueId] }),
  })
  return (
    <div className="rounded-xl border border-accent-300 bg-accent-50 p-5">
      <p className="text-sm font-semibold">Waiting for a crew</p>
      <p className="mt-1 text-xs text-ink-600">No matching crew had capacity. SmartFix retries automatically, or you can send one now.</p>
      <div className="mt-3 flex gap-2">
        <CrewSelect value={crew} onChange={setCrew} problemType={problemType} />
        <button className="btn-primary shrink-0" disabled={!crew || send.isPending} onClick={() => send.mutate()}>
          <Send className="h-4 w-4" /> Dispatch
        </button>
      </div>
      {send.isError && (
        <div className="mt-3">
          <ErrorNote>{(send.error as Error).message}</ErrorNote>
        </div>
      )}
    </div>
  )
}

function WorkOrderPanel({ issueId, wo, severity, problemType }: {
  issueId: string
  wo: IssueWorkOrder
  severity: number | null
  problemType: string
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [crew, setCrew] = useState('')
  const [reason, setReason] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
  const reassign = useMutation({
    mutationFn: () => api.post(`/work-orders/${wo.work_order_id}/reassign`, { crew_id: Number(crew), reason: reason || undefined }),
    onSuccess: () => {
      setCrew('')
      setReason('')
      refresh()
      toast.show('Work order reassigned', 'success')
    },
  })
  const isActive = wo.status === 'assigned' || wo.status === 'in_progress'
  const due = deadlineText(wo.deadline_at)

  return (
    <Section title="Work order" icon={<Timer className="h-4 w-4 text-ink-500" />}>
      <dl className="grid grid-cols-3 gap-4">
        <KeyValue label="Crew">{wo.crew_name}</KeyValue>
        <KeyValue label="Status">{humanize(wo.status)}</KeyValue>
        <KeyValue label="Deadline">
          <span className={isActive && due.overdue ? 'text-accent-700' : ''}>{formatDateTime(wo.deadline_at)}</span>
          {isActive && <span className="block text-xs font-normal text-ink-500">{due.text}</span>}
        </KeyValue>
      </dl>
      {wo.escalated_at && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent-700">
          <AlertTriangle className="h-3.5 w-3.5" /> Deadline missed {formatDateTime(wo.escalated_at)}; supervisor alerted
        </p>
      )}

      {(wo.after_photo_id || wo.verdict) && (
        <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3 border-t border-paper-200 pt-4">
          <Photo src={photoUrl(wo.after_photo_id)} alt="After photo" className="aspect-[4/3] rounded-lg" />
          <div className="space-y-3 text-sm">
            <KeyValue label="AI repair check">
              {wo.verdict ? `${humanize(wo.verdict)} (${pct(wo.verdict_confidence)})` : 'Checking…'}
            </KeyValue>
            <KeyValue label="Resident">
              {wo.confirmation_status ? humanize(wo.confirmation_status) : '—'}
              {wo.confirmation_status === 'pending' && wo.auto_close_at && (
                <span className="block text-xs font-normal text-ink-500">auto-closes {formatDateTime(wo.auto_close_at)}</span>
              )}
            </KeyValue>
            {wo.dispute_reason && <p className="text-xs text-ink-600">“{wo.dispute_reason}”</p>}
            {wo.crew_notes && <p className="text-xs text-ink-500">Crew: {wo.crew_notes}</p>}
          </div>
        </div>
      )}

      {isActive && (
        <div className="mt-4 space-y-2 border-t border-paper-200 pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Reassign
          </p>
          <div className="flex gap-2">
            <CrewSelect value={crew} onChange={setCrew} problemType={problemType} exclude={wo.crew_id} />
            <button className="btn-primary shrink-0" disabled={!crew || reassign.isPending} onClick={() => reassign.mutate()}>
              Move
            </button>
          </div>
          <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-ink-500">
            The new crew gets a fresh severity-{severity ?? '?'} deadline. Started work can only be moved after it is escalated.
          </p>
          {reassign.isError && <ErrorNote>{(reassign.error as Error).message}</ErrorNote>}
        </div>
      )}

    </Section>
  )
}

function Timeline({ issueId }: { issueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timeline', issueId],
    queryFn: () => api.get<TimelineRow[]>(`/issues/${issueId}/timeline`),
  })
  if (isLoading || !data) return <PageLoader />
  return (
    <div className="p-6">
      <p className="mb-5 text-xs text-ink-500">
        Every event published for this issue and every status change it caused (FR-14). Status changes show the only module allowed
        to make them.
      </p>
      <ol className="relative space-y-1 border-l-2 border-ink-100 pl-6">
        {data.map((row, i) => (
          <li key={i} className="relative pb-3">
            {row.kind === 'event' ? (
              <>
                <span className="absolute -left-[33px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 ring-4 ring-paper-50">
                  <Radio className="h-2.5 w-2.5 text-white" />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-ink-900">{eventLabel(row.label)}</p>
                  <time className="shrink-0 text-xs text-ink-400">{formatDateTime(row.at)}</time>
                </div>
                <p className="text-xs text-ink-500">
                  published by <span className="font-medium text-ink-700">{humanize(row.source)}</span>
                </p>
                {row.detail && Object.keys(row.detail).length > 0 && (
                  <pre className="mt-1.5 overflow-x-auto rounded-md bg-ink-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-600">
                    {Object.entries(row.detail)
                      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                      .join('\n')}
                  </pre>
                )}
              </>
            ) : (
              <>
                <span className="absolute -left-[29px] top-1.5 h-2 w-2 rounded-full bg-ink-300 ring-4 ring-paper-50" />
                <p className="text-xs text-ink-600">
                  Status{' '}
                  {row.label
                    .split(' -> ')
                    .map((s) => (s === '-' ? 'new' : (STATUS_LABEL as Record<string, string>)[s] ?? s))
                    .join(' → ')}{' '}
                  <span className="text-ink-400">by {humanize(row.source)} · {formatDateTime(row.at)}</span>
                </p>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { useState } from 'react'
import { api, photoUrl } from '../../api/client'
import type { Crew, IssueDetail } from '../../api/types'
import { ProblemIcon } from '../../components/ProblemIcon'
import {
  Drawer,
  ErrorNote,
  KeyValue,
  PageLoader,
  Photo,
  SeverityPill,
  StatusBadge,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'

export function IssueDrawer({
  issueId,
  onClose,
}: {
  issueId: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [crewId, setCrewId] = useState('')
  const [reason, setReason] = useState('')
  const issue = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => api.get<IssueDetail>(`/issues/${issueId}`),
    enabled: Boolean(issueId),
  })
  const crews = useQuery({
    queryKey: ['crews'],
    queryFn: () => api.get<Crew[]>('/crews'),
    enabled: Boolean(issueId),
  })
  const detail = issue.data
  const order = detail?.work_orders.find(
    (item) => item.status === 'assigned' || item.status === 'in_progress',
  )
  const reassign = useMutation({
    mutationFn: () =>
      api.post(`/work-orders/${order?.work_order_id}/reassign`, {
        crew_id: Number(crewId),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      setCrewId('')
      setReason('')
      void queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      void queryClient.invalidateQueries({ queryKey: ['map'] })
    },
  })

  return (
    <Drawer
      open={Boolean(issueId)}
      onClose={onClose}
      width="w-full sm:w-[620px]"
      title={detail ? detail.problem_type_name : 'Issue'}
    >
      {issue.isLoading && <PageLoader />}
      {issue.isError && (
        <div className="p-6">
          <ErrorNote>Issue details could not be loaded.</ErrorNote>
        </div>
      )}
      {detail && (
        <div className="space-y-4 p-4 sm:p-6">
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <ProblemIcon code={detail.problem_type} className="h-5 w-5" />
              <h3 className="text-lg font-semibold">
                {detail.problem_type_name}
              </h3>
              <StatusBadge
                status={detail.status}
                escalated={detail.is_escalated}
              />
            </div>
            <p className="mt-2 text-sm text-ink-500">
              {detail.address_text ??
                `${detail.lat.toFixed(5)}, ${detail.lng.toFixed(5)}`}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-paper-200 pt-4">
              <KeyValue label="Priority score">
                {detail.priority_score
                  ? Number(detail.priority_score).toFixed(1)
                  : '—'}
              </KeyValue>
              <KeyValue label="Severity">
                <SeverityPill severity={detail.severity} showLabel />
              </KeyValue>
              <KeyValue label="Reports">{detail.reports.length}</KeyValue>
              <KeyValue label="Area">
                {detail.area_name ?? 'Outside zones'}
              </KeyValue>
            </dl>
          </div>

          <section className="card p-5">
            <h3 className="mb-4 text-sm font-semibold">Resident reports</h3>
            {detail.reports.map((report) => (
              <div key={report.report_id} className="mb-4 flex gap-3 last:mb-0">
                <Photo
                  src={photoUrl(report.photo_id)}
                  alt="Report photo"
                  className="h-24 w-28 shrink-0 rounded-lg"
                />
                <div className="text-sm">
                  <p className="font-medium">{report.reporter_name}</p>
                  <p className="text-ink-500">
                    {formatDateTime(report.submitted_at)}
                  </p>
                  {report.description && (
                    <p className="mt-1">{report.description}</p>
                  )}
                </div>
              </div>
            ))}
          </section>

          {order && (
            <section className="card p-5">
              <h3 className="mb-4 text-sm font-semibold">Work order</h3>
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Crew">{order.crew_name}</KeyValue>
                <KeyValue label="Deadline">
                  {formatDateTime(order.deadline_at)}
                </KeyValue>
              </dl>
              <div className="mt-5 border-t border-paper-200 pt-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <ArrowRightLeft className="h-4 w-4" /> Reassign
                </p>
                <select
                  className="input"
                  value={crewId}
                  onChange={(event) => setCrewId(event.target.value)}
                >
                  <option value="">Choose a crew…</option>
                  {crews.data
                    ?.filter(
                      (crew) =>
                        crew.is_active && crew.crew_id !== order.crew_id,
                    )
                    .map((crew) => (
                      <option key={crew.crew_id} value={crew.crew_id}>
                        {crew.name} · {crew.active_orders}/
                        {crew.max_active_orders} busy
                      </option>
                    ))}
                </select>
                <input
                  className="input mt-2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Reason (optional)"
                  maxLength={300}
                />
                <p className="mt-2 text-xs text-ink-500">
                  Started work can only move after its deadline has been
                  escalated.
                </p>
                {reassign.isError && (
                  <div className="mt-2">
                    <ErrorNote>{reassign.error.message}</ErrorNote>
                  </div>
                )}
                <button
                  type="button"
                  className="btn-primary mt-3"
                  disabled={
                    !crewId ||
                    reassign.isPending ||
                    (order.status === 'in_progress' &&
                      detail.status !== 'escalated')
                  }
                  onClick={() => reassign.mutate()}
                >
                  {reassign.isPending ? 'Moving…' : 'Move work order'}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}

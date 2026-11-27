import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, HardHat, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, photoUrl } from '../../api/client'
import type { WorkOrder } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { PhotoDropzone } from '../../components/PhotoDropzone'
import { ProblemIcon } from '../../components/ProblemIcon'
import { BaseMap, FitBounds, IssueMarker } from '../../components/maps'
import { EmptyState, ErrorNote, Field, KeyValue, Modal, NewTabHint, PageHeader, PageLoader, Photo, SeverityPill } from '../../components/ui'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { deadlineText, formatDateTime } from '../../lib/format'

export function CrewPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('crew.title'))
  const { user } = useAuth()
  const [scope, setScope] = useState<'active' | 'done'>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['work-orders', scope],
    queryFn: () => api.get<WorkOrder[]>(`/crew/work-orders?scope=${scope}`),
    refetchInterval: 60_000,
  })
  const orders = data ?? []
  const selected = orders.find((o) => o.work_order_id === selectedId) ?? orders[0] ?? null

  useEffect(() => setSelectedId(null), [scope])

  return (
    <div className="px-8 py-8">
      <PageHeader
        title={t('crew.title')}
        subtitle={t('crew.subtitle', { crew: user?.crew_name ?? t('crew.yourCrew') })}
        actions={
          <div className="flex rounded-lg border border-ink-100 bg-white p-1" role="group" aria-label={t('a11y.scope')}>
            {(['active', 'done'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${scope === s ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}
              >
                {s === 'active' ? t('crew.toDo') : t('crew.completed')}
              </button>
            ))}
          </div>
        }
      />
      {isLoading && <PageLoader />}
      {!isLoading && !orders.length && (
        <EmptyState
          icon={<HardHat aria-hidden className="h-5 w-5" />}
          title={scope === 'active' ? t('crew.emptyActiveTitle') : t('crew.emptyDoneTitle')}
          body={scope === 'active' ? t('crew.emptyActiveBody') : t('crew.emptyDoneBody')}
        />
      )}
      {!!orders.length && (
        <div className="grid grid-cols-[400px_1fr] gap-6">
          <ul className="space-y-2.5" aria-label={t('a11y.workOrderList')}>
            {orders.map((o) => {
              const due = deadlineText(o.deadline_at)
              const active = selected?.work_order_id === o.work_order_id
              return (
                <li key={o.work_order_id}>
                  <button
                    onClick={() => setSelectedId(o.work_order_id)}
                    aria-current={active ? 'true' : undefined}
                    className={`card w-full p-4 text-left transition ${active ? 'ring-2 ring-ink-900' : 'hover:shadow-lift'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-700">
                        <ProblemIcon code={o.problem_type} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-semibold">{o.problem_type_name}</p>
                          {o.status === 'in_progress' && (
                            <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-white">{t('crew.started')}</span>
                          )}
                        </div>
                        <p className="truncate text-sm text-ink-500">{o.address_text ?? `${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}`}</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          <SeverityPill severity={o.severity} />
                          {scope === 'active' ? (
                            <span
                              className={`flex items-center gap-1 text-xs font-semibold ${
                                due.overdue || o.is_escalated ? 'text-accent-700' : 'text-ink-600'
                              }`}
                            >
                              {due.overdue || o.is_escalated ? <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> : <Clock aria-hidden className="h-3.5 w-3.5" />}
                              {due.text}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-500">{t('crew.done', { date: formatDateTime(o.completed_at) })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && <OrderDetail order={selected} all={orders} onSelect={setSelectedId} />}
        </div>
      )}
    </div>
  )
}

function OrderDetail({ order, all, onSelect }: { order: WorkOrder; all: WorkOrder[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [completing, setCompleting] = useState(false)
  const start = useMutation({
    mutationFn: () => api.patch(`/crew/work-orders/${order.work_order_id}`, { status: 'in_progress' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
  })
  const due = deadlineText(order.deadline_at)
  const directions = `https://www.openstreetmap.org/directions?to=${order.lat}%2C${order.lng}`

  return (
    <div className="space-y-5">
      <div className="card h-64 overflow-hidden">
        <BaseMap label={t('a11y.mapWorkOrders')}>
          <FitBounds points={all.map((o) => [o.lat, o.lng])} />
          {all.map((o) => (
            <IssueMarker
              key={o.work_order_id}
              lat={o.lat}
              lng={o.lng}
              severity={o.severity}
              escalated={o.is_escalated}
              selected={o.work_order_id === order.work_order_id}
              label={o.problem_type_name}
              onClick={() => onSelect(o.work_order_id)}
            />
          ))}
        </BaseMap>
      </div>

      <div className="card p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold">{order.problem_type_name}</h2>
            <p className="mt-1 text-sm text-ink-500">{order.address_text ?? `${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}`}</p>
          </div>
          <div className="flex gap-2">
            <a href={directions} target="_blank" rel="noreferrer" className="btn-secondary">
              <ExternalLink aria-hidden className="h-4 w-4" /> {t('crew.directions')}
              <NewTabHint />
            </a>
            {order.status === 'assigned' && (
              <button className="btn-primary" onClick={() => start.mutate()} disabled={start.isPending}>
                <Play aria-hidden className="h-4 w-4" /> {t('crew.startWork')}
              </button>
            )}
            {order.status === 'in_progress' && (
              <button className="btn-primary" onClick={() => setCompleting(true)}>
                <CheckCircle2 aria-hidden className="h-4 w-4" /> {t('crew.completeRepair')}
              </button>
            )}
          </div>
        </div>
        {order.is_escalated && order.status !== 'completed' && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent-50 px-4 py-2.5 text-sm font-medium text-accent-700 ring-1 ring-accent-200">
            <AlertTriangle aria-hidden className="h-4 w-4" /> {t('crew.escalatedWarning')}
          </div>
        )}
        {start.isError && (
          <div className="mt-4">
            <ErrorNote>{(start.error as Error).message}</ErrorNote>
          </div>
        )}
        <dl className="mt-6 grid grid-cols-4 gap-4 border-t border-paper-200 pt-5">
          <KeyValue label={t('crew.severity')}>
            <SeverityPill severity={order.severity} showLabel />
          </KeyValue>
          <KeyValue label={t('crew.deadline')}>
            <span className={due.overdue && order.status !== 'completed' ? 'text-accent-700' : ''}>{formatDateTime(order.deadline_at)}</span>
          </KeyValue>
          <KeyValue label={t('crew.startedAt')}>{formatDateTime(order.started_at)}</KeyValue>
          <KeyValue label={t('crew.reports')}>{t('crew.residents', { count: order.duplicate_count + 1 })}</KeyValue>
        </dl>
        {order.description && <p className="mt-5 rounded-lg bg-paper px-4 py-3 text-sm text-ink-700">{t('crew.residentSaid', { text: order.description })}</p>}
        <div className="mt-5 grid grid-cols-2 gap-4">
          <figure>
            <Photo src={photoUrl(order.before_photo_id)} alt={t('crew.reportedAlt')} className="aspect-[4/3] rounded-lg" />
            <figcaption className="mt-2 text-xs font-medium text-ink-500">{t('crew.reportedCaption')}</figcaption>
          </figure>
          <figure>
            <Photo src={photoUrl(order.after_photo_id)} alt={t('crew.afterAlt')} className="aspect-[4/3] rounded-lg" />
            <figcaption className="mt-2 text-xs font-medium text-ink-500">{t('crew.afterCaption')}</figcaption>
          </figure>
        </div>
      </div>
      <CompleteModal order={order} open={completing} onClose={() => setCompleting(false)} />
    </div>
  )
}

function CompleteModal({ order, open, onClose }: { order: WorkOrder; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [photo, setPhoto] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const complete = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('after_photo', photo!)
      if (notes.trim()) form.append('notes', notes.trim())
      return api.upload(`/crew/work-orders/${order.work_order_id}/complete`, form)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      setPhoto(null)
      setNotes('')
      onClose()
    },
  })
  return (
    <Modal open={open} onClose={onClose} title={t('crew.completeRepair')}>
      <div className="space-y-4">
        <PhotoDropzone file={photo} onChange={setPhoto} label={t('crew.addAfterPhoto')} />
        <Field label={t('crew.notes')}>
          <textarea
            className="input min-h-[72px]"
            placeholder={t('crew.notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <p className="text-xs text-ink-500">
          {t('crew.completeInfo')}
        </p>
        {complete.isError && <ErrorNote>{(complete.error as Error).message}</ErrorNote>}
        <button className="btn-primary w-full" disabled={!photo || complete.isPending} onClick={() => complete.mutate()}>
          <CheckCircle2 aria-hidden className="h-4 w-4" /> {complete.isPending ? t('crew.uploading') : t('crew.markRepaired')}
        </button>
      </div>
    </Modal>
  )
}

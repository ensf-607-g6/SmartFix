import { AlertTriangle, Loader2, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { IssueStatus } from '../api/types'
import { SEVERITY_LABEL, STATUS_LABEL, severityColor } from '../lib/format'

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-ink-400 ${className}`} />
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-7 w-7" />
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-500">{icon}</div>
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/** Status badge. Only 'escalated' uses the accent: it is the one state that needs action. */
export function StatusBadge({ status, escalated }: { status: IssueStatus; escalated?: boolean }) {
  const attention = status === 'escalated' || (escalated && !['closed', 'rejected', 'merged'].includes(status))
  const muted = ['closed', 'rejected', 'merged'].includes(status)
  const cls = attention
    ? 'bg-accent-100 text-accent-700 ring-accent-300'
    : muted
      ? 'bg-paper-200 text-ink-500 ring-paper-300'
      : status === 'completed'
        ? 'bg-ink-900 text-white ring-ink-900'
        : 'bg-ink-50 text-ink-700 ring-ink-200'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      {attention && status !== 'escalated' && <AlertTriangle className="h-3 w-3" />}
      {STATUS_LABEL[status]}
      {attention && status !== 'escalated' && ' · escalated'}
    </span>
  )
}

export function SeverityPill({ severity, showLabel = false }: { severity: number | null; showLabel?: boolean }) {
  if (!severity) return <span className="text-xs text-ink-400">Not rated</span>
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-700" title={`Severity ${severity} of 5`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="h-2.5 w-1.5 rounded-sm"
            style={{ background: n <= severity ? severityColor(severity) : '#E3E8F1' }}
          />
        ))}
      </span>
      <span>
        {severity}/5{showLabel && ` · ${SEVERITY_LABEL[severity]}`}
      </span>
    </span>
  )
}

export function Drawer({ open, onClose, title, children, width = 'w-[560px]' }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1500] flex justify-end">
      <div className="absolute inset-0 bg-ink-950/30" onClick={onClose} />
      <aside className={`relative flex h-full ${width} flex-col bg-paper-50 shadow-lift`}>
        <header className="flex items-center justify-between border-b border-paper-300 bg-white px-6 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button onClick={onClose} className="btn-ghost -mr-2 px-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}

export function Modal({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-ink-950/40" onClick={onClose} />
      <div className="card relative w-full max-w-lg p-6 shadow-lift">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="btn-ghost -mr-2 px-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{children}</dd>
    </div>
  )
}

export function Photo({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  if (!src) {
    return <div className={`flex items-center justify-center bg-ink-50 text-xs text-ink-400 ${className}`}>No photo</div>
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className={`block overflow-hidden bg-ink-50 ${className}`}>
      <img src={src} alt={alt} className="h-full w-full object-cover transition hover:scale-[1.02]" />
    </a>
  )
}

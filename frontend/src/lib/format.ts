import type { IssueStatus, ReportStatus } from '../api/types'
import i18n from '../i18n'

/** Look up a key built at run time (e.g. "status.in_progress"); undefined if it is not in the locale files. */
function lookup(key: string): string | undefined {
  return i18n.exists(key) ? i18n.t(key as never) : undefined
}

export function statusLabel(status: IssueStatus): string {
  return lookup(`status.${status}`) ?? status
}

export function reportStatusLabel(status: ReportStatus): string {
  return lookup(`reportStatus.${status}`) ?? status
}

export const ALL_STATUSES: IssueStatus[] = [
  'reported',
  'validated',
  'prioritized',
  'assigned',
  'in_progress',
  'completed',
  'reopened',
  'escalated',
]

/** Severity 1-5 on one navy hue, light to dark (validated ordinal ramp). */
export const SEVERITY_COLOR = ['#8FA3C4', '#6380AD', '#3F5C8C', '#263F6A', '#13213C']
export const ACCENT = '#F5A524'

export function severityColor(severity: number | null | undefined): string {
  return SEVERITY_COLOR[Math.min(5, Math.max(1, severity ?? 1)) - 1]
}

/** "Cosmetic" ... "Critical" for severity 1-5. */
export function severityLabel(severity: number): string {
  return lookup(`severity.label${severity}`) ?? ''
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  // Dates follow the selected UI language (en / fr), not just the browser's locale.
  return new Date(iso).toLocaleString(i18n.resolvedLanguage, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return i18n.t('time.justNow')
  const m = Math.round(s / 60)
  if (m < 60) return i18n.t('time.minutesAgo', { count: m })
  const h = Math.round(m / 60)
  if (h < 24) return i18n.t('time.hoursAgo', { count: h })
  const d = Math.round(h / 24)
  return i18n.t('time.daysAgo', { count: d })
}

/** "Due in 5 h" / "Overdue by 2 h" */
export function deadlineText(iso: string): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(ms)
  const h = abs / 3_600_000
  const amount =
    h < 1
      ? i18n.t('time.minutes', { count: Math.max(1, Math.round(abs / 60000)) })
      : h < 48
        ? i18n.t('time.hours', { count: Math.round(h) })
        : i18n.t('time.days', { count: Math.round(h / 24) })
  return ms >= 0
    ? { text: i18n.t('time.dueIn', { amount }), overdue: false }
    : { text: i18n.t('time.overdueBy', { amount }), overdue: true }
}

export function pct(value: string | number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

/** Backend codes (statuses, modules, verdicts, specialties) as words: "in_progress" -> "In progress". */
export function humanize(code: string): string {
  return lookup(`codes.${code}`) ?? code.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Event names like IssueDuplicateDetected -> "Issue duplicate detected" */
export function eventLabel(name: string): string {
  return (
    lookup(`events.${name}`) ??
    name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(\w)(.*)$/, (_, a, b) => a + b.toLowerCase())
  )
}

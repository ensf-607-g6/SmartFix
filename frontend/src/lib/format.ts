import type { IssueStatus, ReportStatus } from '../api/types'

export const STATUS_LABEL: Record<IssueStatus, string> = {
  reported: 'Reported',
  validated: 'Validated',
  prioritized: 'Prioritized',
  assigned: 'Crew assigned',
  in_progress: 'In progress',
  completed: 'Repaired',
  closed: 'Closed',
  reopened: 'Reopened',
  escalated: 'Escalated',
  rejected: 'Rejected',
  merged: 'Merged',
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: 'Checking photo',
  validated: 'Accepted',
  duplicate: 'Joined existing report',
  needs_review: 'Under operator review',
  rejected: 'Not accepted',
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
export const SEVERITY_COLOR = [
  '#8FA3C4',
  '#6380AD',
  '#3F5C8C',
  '#263F6A',
  '#13213C',
]
export const ACCENT = '#F5A524'

export function severityColor(severity: number | null | undefined): string {
  return SEVERITY_COLOR[Math.min(5, Math.max(1, severity ?? 1)) - 1]
}

export const SEVERITY_LABEL = [
  '',
  'Cosmetic',
  'Minor',
  'Moderate',
  'Serious',
  'Critical',
]

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** "Due in 5 h" / "Overdue by 2 h" */
export function deadlineText(iso: string): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(ms)
  const h = abs / 3_600_000
  const amount =
    h < 1
      ? `${Math.max(1, Math.round(abs / 60000))} min`
      : h < 48
        ? `${Math.round(h)} h`
        : `${Math.round(h / 24)} days`
  return ms >= 0
    ? { text: `Due in ${amount}`, overdue: false }
    : { text: `Overdue by ${amount}`, overdue: true }
}

export function pct(
  value: string | number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined) return '—'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

export function humanize(code: string): string {
  return code.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Event names like IssueDuplicateDetected -> "Issue duplicate detected" */
export function eventLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(
      /^(\w)(.*)$/,
      (_match: string, a: string, b: string) => a + b.toLowerCase(),
    )
}

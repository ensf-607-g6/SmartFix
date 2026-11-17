import { Check } from 'lucide-react'
import type { IssueStatus } from '../api/types'

const STEPS: { key: IssueStatus[]; label: string }[] = [
  { key: ['reported'], label: 'Reported' },
  { key: ['validated', 'prioritized', 'reopened'], label: 'Checked' },
  { key: ['assigned', 'escalated'], label: 'Crew assigned' },
  { key: ['in_progress'], label: 'In progress' },
  { key: ['completed'], label: 'Repaired' },
  { key: ['closed'], label: 'Closed' },
]

/** The resident's view of the issue lifecycle. */
export function StatusStepper({
  status,
  compact = false,
}: {
  status: IssueStatus
  compact?: boolean
}) {
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.key.includes(status)),
  )
  return (
    <ol className="flex items-center">
      {STEPS.map((step, i) => {
        const done = i < current || status === 'closed'
        const active = i === current && status !== 'closed'
        return (
          <li
            key={step.label}
            className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex items-center justify-center rounded-full text-[10px] font-bold ${compact ? 'h-5 w-5' : 'h-7 w-7'} ${
                  done
                    ? 'bg-ink-900 text-white'
                    : active
                      ? 'bg-white text-ink-900 ring-2 ring-ink-900'
                      : 'bg-ink-50 text-ink-400 ring-1 ring-ink-200'
                }`}
              >
                {done ? (
                  <Check className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                ) : (
                  i + 1
                )}
              </span>
              {!compact && (
                <span
                  className={`whitespace-nowrap text-[11px] font-medium ${done || active ? 'text-ink-900' : 'text-ink-400'}`}
                >
                  {step.label}
                </span>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={`mx-1.5 h-0.5 flex-1 rounded ${done ? 'bg-ink-900' : 'bg-ink-100'} ${compact ? '' : '-mt-5'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

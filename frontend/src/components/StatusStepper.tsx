import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IssueStatus } from '../api/types'

const STEPS = [
  { key: ['reported'], label: 'stepper.reported' },
  { key: ['validated', 'prioritized', 'reopened'], label: 'stepper.checked' },
  { key: ['assigned', 'escalated'], label: 'stepper.crewAssigned' },
  { key: ['in_progress'], label: 'stepper.inProgress' },
  { key: ['completed'], label: 'stepper.repaired' },
  { key: ['closed'], label: 'stepper.closed' },
] as const satisfies readonly { key: readonly IssueStatus[]; label: string }[]

/** The resident's view of the issue lifecycle. */
export function StatusStepper({ status, compact = false }: { status: IssueStatus; compact?: boolean }) {
  const { t } = useTranslation()
  const current = Math.max(0, STEPS.findIndex((s) => (s.key as readonly IssueStatus[]).includes(status)))
  const summary = t('a11y.progress', { label: t(STEPS[current].label), step: current + 1, total: STEPS.length })

  const steps = STEPS.map((step, i) => {
    const done = i < current || status === 'closed'
    const active = i === current && status !== 'closed'
    return (
      <li
        key={step.label}
        className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}
        aria-current={active ? 'step' : undefined}
      >
        <div className="flex flex-col items-center gap-1.5">
          <span
            aria-hidden
            className={`flex items-center justify-center rounded-full text-[10px] font-bold ${compact ? 'h-5 w-5' : 'h-7 w-7'} ${
              done
                ? 'bg-ink-900 text-white'
                : active
                  ? 'bg-white text-ink-900 ring-2 ring-ink-900'
                  : 'bg-ink-50 text-ink-500 ring-1 ring-ink-200'
            }`}
          >
            {done ? <Check aria-hidden className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : i + 1}
          </span>
          {!compact && (
            <span className={`whitespace-nowrap text-[11px] font-medium ${done || active ? 'text-ink-900' : 'text-ink-500'}`}>
              {t(step.label)}
            </span>
          )}
          {!compact && (done || active) && (
            <span className="sr-only"> {done ? t('a11y.stepDone') : t('a11y.stepCurrent')}</span>
          )}
        </div>
        {i < STEPS.length - 1 && (
          <span aria-hidden className={`mx-1.5 h-0.5 flex-1 rounded ${done ? 'bg-ink-900' : 'bg-ink-100'} ${compact ? '' : '-mt-5'}`} />
        )}
      </li>
    )
  })

  if (compact) {
    // The compact list view has no visible labels, so say where the issue is in words instead.
    return (
      <>
        <span className="sr-only">{summary}</span>
        <ol className="flex items-center" aria-hidden>
          {steps}
        </ol>
      </>
    )
  }
  return (
    <ol className="flex items-center" aria-label={summary}>
      {steps}
    </ol>
  )
}

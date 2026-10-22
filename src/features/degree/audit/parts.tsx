// Small presentational pieces shared by the audit panel and program picker.
import { CircleCheck, CircleDashed, CircleHelp, Circle, Clock } from 'lucide-react'
import { fmt, type DisplayState } from './format'

const STATE_ICON = {
  complete: CircleCheck,
  'complete-with-plan': Clock,
  'in-progress': CircleDashed,
  missing: Circle,
  manual: CircleHelp,
  skipped: Circle,
}

const STATE_COLOR: Record<DisplayState, string> = {
  complete: 'text-ok',
  'complete-with-plan': 'text-warn',
  'in-progress': 'text-ink-2',
  missing: 'text-danger',
  manual: 'text-muted',
  skipped: 'text-line-strong',
}

export function StateIcon({ state, className = '' }: { state: DisplayState; className?: string }) {
  const Icon = STATE_ICON[state]
  return <Icon aria-hidden className={`shrink-0 ${STATE_COLOR[state]} ${className}`} />
}

/** "Done" / "Planned" badge for program headers. */
export function StateBadge({ state }: { state: DisplayState }) {
  const tone: Record<DisplayState, string> = {
    complete: 'bg-[color-mix(in_oklab,var(--ok)_14%,var(--surface))] text-ok',
    'complete-with-plan': 'bg-[color-mix(in_oklab,var(--warn)_14%,var(--surface))] text-warn',
    'in-progress': 'bg-surface-2 text-ink-2',
    missing: 'bg-accent-soft text-danger',
    manual: 'bg-surface-2 text-muted',
    skipped: 'bg-surface-2 text-muted',
  }
  const text: Record<DisplayState, string> = {
    complete: 'Complete',
    'complete-with-plan': 'Complete with plan',
    'in-progress': 'In progress',
    missing: 'Not started',
    manual: 'Advisor check',
    skipped: 'Not needed',
  }
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold ${tone[state]}`}>
      <StateIcon state={state} className="size-3.5" />
      {text[state]}
    </span>
  )
}

/**
 * Progress toward a target: solid for completed work, hatched for planned work.
 * `have` and `planned` are separate amounts (planned is on top of have).
 */
export function ProgressBar({ have, planned, need, label, className = '' }: { have: number; planned: number; need: number; label: string; className?: string }) {
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / Math.max(need, 1e-9)) * 100))}%`
  const plannedVisible = Math.max(0, Math.min(planned, need - have))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={need}
      aria-valuenow={Math.min(need, have + planned)}
      aria-valuetext={`${fmt(have)} done${planned ? `, ${fmt(planned)} planned` : ''}, of ${fmt(need)}`}
      className={`relative h-1.5 overflow-hidden rounded-full bg-line ${className}`}
    >
      <div className="absolute inset-y-0 left-0 bg-ok" style={{ width: pct(have) }} />
      <div
        className="absolute inset-y-0 bg-[color-mix(in_oklab,var(--ok)_45%,transparent)]"
        style={{ left: pct(have), width: pct(plannedVisible) }}
      />
    </div>
  )
}

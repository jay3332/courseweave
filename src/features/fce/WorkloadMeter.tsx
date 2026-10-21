import { FCE_HOURS_HELP, formatHours, workloadRatio, workloadTone, type WorkloadTone } from '../../lib/fce'
import { workloadDescription } from './workload'

const TONE_FILL: Record<WorkloadTone, string> = {
  light: 'bg-ok',
  even: 'bg-ink-2',
  heavy: 'bg-warn',
  'very-heavy': 'bg-danger',
}

/** Scale ceiling for meters, in hours/week. */
const SCALE = 24

/**
 * Reported hours as a bar, with a tick where the units sit (1 unit ≈ 1 hour a week).
 * The fill color says whether the course runs lighter or heavier than its units.
 */
export function WorkloadMeter({ hours, units, className = '' }: { hours: number | null; units: number | null; className?: string }) {
  if (hours === null) return null
  const tone = workloadTone(workloadRatio(hours, units)) ?? 'even'
  const pct = (v: number) => `${Math.min(100, (v / SCALE) * 100)}%`
  return (
    <span aria-hidden className={`relative block h-[5px] rounded-full bg-line ${className}`}>
      <span className={`absolute inset-y-0 left-0 rounded-full ${TONE_FILL[tone]}`} style={{ width: pct(hours) }} />
      {units !== null && units > 0 ? <span className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-full bg-ink" style={{ left: `calc(${pct(units)} - 1px)` }} /> : null}
    </span>
  )
}

/** "11.4 h" with a meter underneath; compact for result rows. */
export function WorkloadCell({ hours, units }: { hours: number | null; units: number | null }) {
  if (hours === null) return <span className="text-[12px] text-muted">No FCE</span>
  return (
    <span className="block" title={`${workloadDescription(hours, units)}. ${FCE_HOURS_HELP}`}>
      <span className="block text-right">
        <span className="course-code text-[15px] text-ink">{formatHours(hours)}</span>
        <span className="ml-0.5 text-[11px] text-muted">h</span>
      </span>
      <WorkloadMeter hours={hours} units={units} className="mt-1" />
      <span className="sr-only">{workloadDescription(hours, units)}</span>
    </span>
  )
}

import { FCE_HOURS_HELP, expectedHours, formatHours, workloadRatio, workloadTone, type WorkloadTone } from '../../lib/fce'
import { workloadDescription } from './workload'

const TONE_FILL: Record<WorkloadTone, string> = {
  light: 'bg-ok',
  even: 'bg-ink-2',
  heavy: 'bg-warn',
  'very-heavy': 'bg-danger',
}

/** Scale ceiling for meters, in hours/week. */
const SCALE = 24

interface MeterProps {
  hours: number | null
  units: number | null
  /** Minis run half a semester, so their units suggest twice the weekly hours. */
  mini?: boolean
  className?: string
}

/**
 * Reported hours as a bar, with a tick at the hours the units suggest (1 unit ≈ 1 hour a week over a full
 * semester; 2 for a mini). The fill color says whether the course runs lighter or heavier than that.
 */
export function WorkloadMeter({ hours, units, mini = false, className = '' }: MeterProps) {
  if (hours === null) return null
  const tone = workloadTone(workloadRatio(hours, units, mini)) ?? 'even'
  const expected = expectedHours(units, mini)
  const pct = (v: number) => `${Math.min(100, (v / SCALE) * 100)}%`
  return (
    <span aria-hidden className={`relative block h-[5px] rounded-full bg-line ${className}`}>
      <span className={`absolute inset-y-0 left-0 rounded-full ${TONE_FILL[tone]}`} style={{ width: pct(hours) }} />
      {expected !== null && expected > 0 ? <span className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-full bg-ink" style={{ left: `calc(${pct(expected)} - 1px)` }} /> : null}
    </span>
  )
}

/** "11.4 h" with a meter underneath; compact for result rows. */
export function WorkloadCell({ hours, units, mini = false }: { hours: number | null; units: number | null; mini?: boolean }) {
  if (hours === null) return <span className="text-[12px] text-muted">No FCE</span>
  const description = workloadDescription(hours, units, mini)
  return (
    <span className="block" title={`${description}. ${FCE_HOURS_HELP}`}>
      <span className="block text-right">
        {mini ? <span className="mr-1 text-[10.5px] font-semibold text-muted">mini</span> : null}
        <span className="course-code text-[15px] text-ink">{formatHours(hours)}</span>
        <span className="ml-0.5 text-[11px] text-muted">h</span>
      </span>
      <WorkloadMeter hours={hours} units={units} mini={mini} className="mt-1" />
      <span className="sr-only">{description}</span>
    </span>
  )
}

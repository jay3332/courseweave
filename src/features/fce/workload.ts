import { WORKLOAD_TONE_LABEL, formatHours, workloadRatio, workloadTone } from '../../lib/fce'

/** One-line explanation of hours vs units, for tooltips and screen readers. */
export function workloadDescription(hours: number | null, units: number | null): string {
  if (hours === null) return 'No FCE hours reported'
  const tone = workloadTone(workloadRatio(hours, units))
  const base = `${formatHours(hours)} FCE hours a week`
  if (units === null) return `${base} (variable units)`
  return tone ? `${base} for ${units} units: ${WORKLOAD_TONE_LABEL[tone].toLowerCase()}` : `${base} for ${units} units`
}

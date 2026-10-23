// Formatting helpers for the audit UI (kept out of component files for fast refresh).
import type { RequirementResult, RequirementState } from '../../../lib/plan-types'

export type DisplayState = RequirementState | 'manual' | 'skipped'

export function displayState(r: Pick<RequirementResult, 'state' | 'manual' | 'skipped'>): DisplayState {
  if (r.skipped) return 'skipped'
  if (r.manual) return 'manual'
  return r.state
}

export const STATE_LABEL: Record<DisplayState, string> = {
  complete: 'Done',
  'complete-with-plan': 'Planned',
  'in-progress': 'In progress',
  missing: 'Still needed',
  manual: 'Checked by your advisor',
  skipped: 'Not needed',
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** "9 of 27 units, 18 planned". */
export function progressText(p: { have: number; planned: number; need: number }, unit: 'units' | 'courses'): string {
  const word = unit === 'units' ? 'units' : p.need === 1 ? 'course' : 'courses'
  return `${fmt(p.have)} of ${fmt(p.need)} ${word}${p.planned ? `, ${fmt(p.planned)} planned` : ''}`
}

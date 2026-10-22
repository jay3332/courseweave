import { WORKLOAD_TONE_LABEL, expectedHours, expectedHoursText, formatHours, isMostlyMini, splitHalves, workloadRatio, workloadTone, type FceSummary, type HalfLoad } from '../../lib/fce'
import type { MiniMeta } from '../../lib/types'
import type { ResolvedEntry } from '../../state/schedule-view'

/** One-line explanation of hours vs units, for tooltips and screen readers. */
export function workloadDescription(hours: number | null, units: number | null, mini = false): string {
  if (hours === null) return 'No FCE hours reported'
  const base = `${formatHours(hours)} FCE hours a week`
  if (units === null) return `${base} (variable units)`
  const tone = workloadTone(workloadRatio(hours, units, mini))
  const expected = `${expectedHoursText(units, mini)} expected${mini ? ', since a mini runs half the semester' : ''}`
  return tone ? `${base}; ${expected}: ${WORKLOAD_TONE_LABEL[tone].toLowerCase()}` : `${base}; ${expected}`
}

export interface WorkloadRow {
  entry: ResolvedEntry
  /** FCE hours, or null when the course has none. */
  hours: number | null
  /** Hours counted in the estimate: FCE hours, or what the units suggest when there are none. */
  estimate: number
  /** Mini number in this term, or null for full semester. */
  mini: number | null
}

export interface ScheduleLoad {
  rows: WorkloadRow[]
  /** Official units (minis count their real units). */
  units: number
  /** Single-number estimate when there are no minis: sum of estimates. */
  total: number
  /** Per half, when any course is a mini: [first half, second half] keyed to the term's minis. */
  halves: { mini: MiniMeta; load: HalfLoad }[] | null
  /** Index into `halves` of the heavier half. */
  peak: number | null
}

/** The term mini a schedule entry runs in: its chosen section, else all its sections, else its FCE history. */
export function entryMini(e: ResolvedEntry, minis: MiniMeta[], summary: FceSummary | undefined): number | null {
  const numbers = new Set(minis.map((m) => m.number))
  if (e.section) return e.section.mini !== null && numbers.has(e.section.mini) ? e.section.mini : null
  const tops = e.course.sections.filter((s) => s.parent === null)
  const first = tops[0]?.mini ?? null
  if (tops.length && tops.every((s) => s.mini === first)) return first !== null && numbers.has(first) ? first : null
  if (tops.length && tops.every((s) => s.mini === null)) return null
  if (minis.length >= 2 && isMostlyMini(summary?.mini)) {
    if (summary!.mini.half === 'first') return minis[0].number
    if (summary!.mini.half === 'second') return minis[1].number
  }
  return null
}

export function scheduleLoad(entries: ResolvedEntry[], minis: MiniMeta[], fce: Map<string, FceSummary>): ScheduleLoad {
  const visible = entries.filter((e) => !e.entry.hidden)
  const rows: WorkloadRow[] = visible.map((entry) => {
    const s = fce.get(entry.course.id)
    const mini = entryMini(entry, minis, s)
    const hours = s?.hours ?? null
    return { entry, hours, mini, estimate: hours ?? expectedHours(entry.course.units ?? 0, mini !== null)! }
  })
  const units = visible.reduce((n, e) => n + (e.course.units ?? 0), 0)
  const total = rows.reduce((n, r) => n + r.estimate, 0)
  if (minis.length < 2 || !rows.some((r) => r.mini !== null)) return { rows, units, total, halves: null, peak: null }

  const split = splitHalves(
    rows.map((r) => ({
      hours: r.estimate,
      units: r.entry.course.units ?? 0,
      half: r.mini === null ? null : r.mini === minis[0].number ? 'first' : 'second',
    })),
  )
  const halves = [
    { mini: minis[0], load: split.first },
    { mini: minis[1], load: split.second },
  ]
  return { rows, units, total, halves, peak: split.second.hours > split.first.hours ? 1 : 0 }
}

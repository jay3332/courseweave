import { formatDays, formatTimeRange, isScheduled } from '../../lib/time'
import type { Course, TermMeta } from '../../lib/types'

export interface MeetingSummary {
  primary: string
  secondary?: string
}

/** Compact meeting description for a result row. */
export function meetingSummary(course: Course): MeetingSummary {
  const sections = course.sections
  if (sections.length === 1) {
    const scheduled = sections[0].meetings.filter(isScheduled)
    if (!scheduled.length) return { primary: 'Time TBA' }
    // Prefer the meeting that covers the most days (the regular lecture over a one-off evening slot).
    const main = [...scheduled].sort((a, b) => b.days.length - a.days.length)[0]
    return {
      primary: `${formatDays(main.days)} ${formatTimeRange(main.start, main.end)}`,
      secondary: scheduled.length > 1 ? `plus ${scheduled.length - 1} more meeting${scheduled.length > 2 ? 's' : ''}` : undefined,
    }
  }

  const patterns: string[] = []
  let unscheduled = 0
  for (const s of sections) {
    const scheduled = s.meetings.filter(isScheduled)
    if (!scheduled.length) {
      unscheduled++
      continue
    }
    const days = [...new Set(scheduled.flatMap((m) => m.days))].sort()
    const p = formatDays(days)
    if (!patterns.includes(p)) patterns.push(p)
  }
  let secondary: string | undefined
  if (patterns.length === 0) secondary = 'Times TBA'
  else if (patterns.length === 1) secondary = unscheduled ? `${patterns[0]} or TBA` : `All ${patterns[0]}`
  else secondary = patterns.length > 3 ? `${patterns.slice(0, 3).join(' / ')} / …` : patterns.join(' / ')
  return { primary: `${sections.length} sections`, secondary }
}

/** "Mini 3" when every section is the same mini, else null. */
export function courseMini(course: Course, term: TermMeta): string | null {
  const first = course.sections[0]?.mini ?? null
  if (first === null || !course.sections.every((s) => s.mini === first)) return null
  return term.minis.find((m) => m.number === first)?.name ?? `Mini ${first}`
}

export function miniName(mini: number | null, term: TermMeta): string {
  if (mini === null) return 'Full semester'
  return term.minis.find((m) => m.number === mini)?.name ?? `Mini ${mini}`
}

export function unitsText(units: number | null): string {
  if (units === null) return 'Variable units'
  return `${units} ${units === 1 ? 'unit' : 'units'}`
}

/** DOM id of a result row, for keyboard navigation. */
export function rowId(course: Course): string {
  return `course-row-${course.id}`
}

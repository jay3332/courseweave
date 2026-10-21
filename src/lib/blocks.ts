import type { CalendarBlock } from '../components/WeekGrid'
import { formatLocation, isScheduled } from './time'
import type { Course, Section } from './types'

export function sectionLabel(section: Section): string {
  return section.kind === 'lecture' ? `Lec ${section.name}` : `Sec ${section.name}`
}

/** One calendar block per (meeting, day) of a section. Spread `extra` onto every block. */
export function sectionBlocks(
  course: Course,
  section: Section,
  color: number,
  extra: Partial<CalendarBlock> & { keyPrefix?: string } = {},
): CalendarBlock[] {
  const { keyPrefix = '', ...rest } = extra
  const blocks: CalendarBlock[] = []
  section.meetings.forEach((m, i) => {
    if (!isScheduled(m)) return
    for (const day of m.days) {
      blocks.push({
        key: `${keyPrefix}${course.id}-${section.name}-${i}-${day}`,
        day,
        start: m.start,
        end: m.end,
        color,
        label: course.code,
        detail: `${sectionLabel(section)} · ${formatLocation(m)}`,
        mini: section.mini,
        tooltip: `${course.code} ${course.title}, ${sectionLabel(section)}`,
        ...rest,
      })
    }
  })
  return blocks
}

/** True when no meeting of the section has a scheduled day and time. */
export function isUnscheduled(section: Section): boolean {
  return !section.meetings.some(isScheduled)
}

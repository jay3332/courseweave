import type { CalendarBlock } from '../../components/WeekGrid'
import { sectionBlocks, sectionLabel } from '../../lib/blocks'
import type { Term } from '../../lib/data'
import { childSections, topSections } from '../../lib/sections'
import { formatDays, formatLocation, formatTimeRange, isScheduled } from '../../lib/time'
import type { Course, Section } from '../../lib/types'
import { fittingSelections, partsConflict, type ScheduleView } from '../../state/schedule-view'
import type { Schedule } from '../../state/store'

/** Explains factorable units wherever the split is shown. */
export const FACTORABLE_HELP =
  'Factorable units count toward your QPA. Pass/fail units still count toward your total units, but not your QPA: that covers courses graded only pass/fail (StuCo, PE, and similar) and courses you choose to take pass/fail.'

export const PASS_FAIL_ONLY_HELP = "This course is graded pass/fail only, so its units don't count toward your QPA."

/** "Lec 1", "Rec A" (a recitation/lab under a lecture), or "Sec A" (standalone). */
export function partLabel(section: Section): string {
  return section.parent !== null ? `Rec ${section.name}` : sectionLabel(section)
}

/** Calendar blocks for one part of a selection, labelled with partLabel. */
export function partBlocks(course: Course, section: Section, color: number, extra: Partial<CalendarBlock> & { keyPrefix?: string } = {}): CalendarBlock[] {
  const generic = sectionLabel(section)
  const label = partLabel(section)
  const blocks = sectionBlocks(course, section, color, extra)
  if (generic === label) return blocks
  return blocks.map((b) => ({ ...b, detail: b.detail?.replace(generic, label), tooltip: b.tooltip?.replace(generic, label) }))
}

/** "TR 9:30–10:50 AM, T 7:00–8:20 PM", or "Time TBA". */
export function meetingSummary(section: Section): string {
  const scheduled = section.meetings.filter(isScheduled)
  if (!scheduled.length) return 'Time TBA'
  return scheduled.map((m) => `${formatDays(m.days)} ${formatTimeRange(m.start, m.end)}`).join(', ')
}

/**
 * Meeting times plus where: one shared room is returned separately (shown after the times); when meetings are in
 * different rooms, each time carries its own ("TR 9:30–10:50 AM (DH 2210), W 7:00–8:20 PM (GHC 4401)").
 */
export function timesAndRoom(section: Section): { times: string; room: string | null } {
  const scheduled = section.meetings.filter(isScheduled)
  if (!scheduled.length) return { times: 'Time TBA', room: null }
  const rooms = [...new Set(scheduled.map(formatLocation))]
  if (rooms.length === 1) return { times: meetingSummary(section), room: rooms[0] === 'TBA' ? 'Room TBA' : rooms[0] }
  return { times: scheduled.map((m) => `${formatDays(m.days)} ${formatTimeRange(m.start, m.end)} (${formatLocation(m)})`).join(', '), room: null }
}

export function locationSummary(section: Section): string {
  const places = [...new Set(section.meetings.map(formatLocation))]
  return places.join(', ')
}

/** Codes of placed courses (other than `courseId`) that these sections would conflict with. */
export function conflictingCodes(parts: Section | Section[], courseId: string, view: ScheduleView): string[] {
  const list = Array.isArray(parts) ? parts : [parts]
  return view.placed.filter((e) => e.course.id !== courseId && partsConflict(list, e.parts)).map((e) => e.course.code)
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

export function unitsText(units: number | null): string {
  return units === null ? 'Variable units' : `${units} ${units === 1 ? 'unit' : 'units'}`
}

/** Fixed units over visible entries of any schedule. */
export function scheduleUnits(schedule: Schedule, term: Term): number {
  return schedule.entries.filter((e) => !e.hidden).reduce((n, e) => n + (term.courseById.get(e.courseId)?.units ?? 0), 0)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const hasTime = (s: Section) => s.meetings.some(isScheduled)

/** Section and recitation to start a newly added course on: the first that fits (preferring set times), else the first. */
export function initialChoice(course: Course, view: ScheduleView): { section: string | null; child: string | null } {
  const fits = fittingSelections(course, view)
  const pick = fits.find((f) => hasTime(f.section) && (!f.child || hasTime(f.child))) ?? fits[0]
  if (pick) return { section: pick.section.name, child: pick.child?.name ?? null }
  const first = topSections(course)[0]
  if (!first) return { section: null, child: null }
  return { section: first.name, child: childSections(course, first.name)[0]?.name ?? null }
}

/** Recitation to pair with `sectionName` when switching lectures: the first that fits, else the first; null if none. */
export function childForSection(course: Course, sectionName: string, view: ScheduleView): string | null {
  const children = childSections(course, sectionName)
  if (!children.length) return null
  const fit = fittingSelections(course, view).find((f) => f.section.name === sectionName && f.child && hasTime(f.child))
  return fit?.child?.name ?? children[0].name
}

/** "2 lectures, 18 recitations" / "4 sections" — how many choices a course offers. */
export function sectionCounts(course: Course): string {
  const tops = topSections(course)
  const children = course.sections.length - tops.length
  const topNoun = tops.every((s) => s.kind === 'lecture') ? 'lecture' : 'section'
  return children ? `${plural(tops.length, topNoun)}, ${plural(children, 'recitation')}` : plural(tops.length, topNoun)
}

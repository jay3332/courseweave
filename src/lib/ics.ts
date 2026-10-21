// iCalendar (RFC 5545) export of a schedule's weekly meetings.

import { formatDays, formatTimeRange, isScheduled } from './time'
import type { Course, Day, Meeting, Section, TermMeta } from './types'

export interface IcsItem {
  course: Course
  section: Section
}

export interface IcsOptions {
  calendarName: string
  /** Timestamp for DTSTAMP; defaults to now. */
  now?: Date
}

const TZID = 'America/New_York'
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const CRLF = '\r\n'

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  `X-LIC-LOCATION:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** Calendar dates as UTC-midnight timestamps, so arithmetic never crosses a DST boundary. */
const DAY_MS = 86_400_000

function parseDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Our Day (0 = Monday) for a UTC-midnight timestamp. */
function weekday(date: number): Day {
  return ((new Date(date).getUTCDay() + 6) % 7) as Day
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function ymd(date: number): string {
  const d = new Date(date)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function localDateTime(date: number, minutes: number): string {
  return `${ymd(date)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`
}

function utcStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

/** nth (1-based) Sunday of a month, as a UTC-midnight timestamp. */
function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1)
  const offset = (7 - new Date(first).getUTCDay()) % 7
  return first + (offset + (n - 1) * 7) * DAY_MS
}

/** UTC offset of US Eastern time late on the given calendar date, in hours (4 or 5). */
export function easternOffsetHours(date: number): number {
  const year = new Date(date).getUTCFullYear()
  const dstStart = nthSunday(year, 2, 2)
  const dstEnd = nthSunday(year, 10, 1)
  return date >= dstStart && date < dstEnd ? 4 : 5
}

/** UNTIL value: 23:59:59 Eastern on `date`, expressed in UTC as RFC 5545 requires with a TZID'd DTSTART. */
function untilUtc(date: number): string {
  return utcStamp(new Date(date + (23 * 3600 + 59 * 60 + 59 + easternOffsetHours(date) * 3600) * 1000))
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds a content line to 75 octets per physical line without splitting UTF-8 sequences. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    // Continuation lines start with a space, which counts toward the limit.
    const limit = parts.length ? 74 : 75
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

function sectionDates(section: Section, term: TermMeta): { start: number; end: number } {
  const mini = section.mini === null ? undefined : term.minis.find((m) => m.number === section.mini)
  return {
    start: parseDate(mini?.start ?? term.classesBegin),
    end: parseDate(mini?.end ?? term.classesEnd),
  }
}

function meetingEvent(item: IcsItem, meeting: Meeting & { start: number; end: number }, index: number, term: TermMeta, stamp: string): string[] | null {
  const { course, section } = item
  const range = sectionDates(section, term)

  let first = range.start
  while (!meeting.days.includes(weekday(first))) {
    first += DAY_MS
    if (first > range.end) return null
  }

  const excluded: number[] = []
  for (const closed of term.noClasses) {
    for (let d = Math.max(parseDate(closed.start), first); d <= Math.min(parseDate(closed.end), range.end); d += DAY_MS) {
      if (meeting.days.includes(weekday(d))) excluded.push(d)
    }
  }

  const location = meeting.building ? [meeting.building, meeting.room].filter(Boolean).join(' ') : null
  const kind = section.parent !== null ? `Recitation ${section.name} (Lecture ${section.parent})` : `${section.kind === 'lecture' ? 'Lecture' : 'Section'} ${section.name}`
  const description = [
    `${kind}${section.mini ? ` (mini ${section.mini})` : ''}`,
    section.title ? section.title : null,
    section.instructors.length ? `Instructors: ${section.instructors.join(', ')}` : null,
    `${course.units === null ? 'Variable' : course.units} units`,
  ]
    .filter(Boolean)
    .join('\n')

  const lines = [
    'BEGIN:VEVENT',
    `UID:${term.id}-${course.id}-${section.name}-${index}@courseweave`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeText(`${course.code} ${section.title ?? course.title}`)}`,
    `DTSTART;TZID=${TZID}:${localDateTime(first, meeting.start)}`,
    `DTEND;TZID=${TZID}:${localDateTime(first, meeting.end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${[...meeting.days].sort((a, b) => a - b).map((d) => BYDAY[d]).join(',')};UNTIL=${untilUtc(range.end)}`,
  ]
  if (excluded.length) lines.push(`EXDATE;TZID=${TZID}:${excluded.map((d) => localDateTime(d, meeting.start)).join(',')}`)
  if (location) lines.push(`LOCATION:${escapeText(location)}`)
  lines.push(`DESCRIPTION:${escapeText(description)}`, 'END:VEVENT')
  return lines
}

/** Builds a .ics file. Sections without scheduled meetings are skipped. */
export function buildIcs(items: IcsItem[], term: TermMeta, options: IcsOptions): string {
  const stamp = utcStamp(options.now ?? new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Courseweave//CMU course planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
  ]
  for (const item of items) {
    item.section.meetings.forEach((m, i) => {
      if (!isScheduled(m)) return
      const event = meetingEvent(item, m, i, term, stamp)
      if (event) lines.push(...event)
    })
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join(CRLF) + CRLF
}

/** Whether a schedule has anything to put on a calendar. */
export function hasScheduledMeetings(items: IcsItem[]): boolean {
  return items.some((i) => i.section.meetings.some(isScheduled))
}

/** "MWF 9:00–9:50 AM; T 7:00–8:20 PM", or "TBA". */
export function meetingSummary(section: Section): string {
  const scheduled = section.meetings.filter(isScheduled)
  if (!scheduled.length) return 'TBA'
  return scheduled.map((m) => `${formatDays(m.days)} ${formatTimeRange(m.start, m.end)}`).join('; ')
}

import { describe, expect, it } from 'vitest'
import { buildIcs, easternOffsetHours, escapeText, foldLine, meetingSummary } from './ics'
import type { Course, Section, TermMeta } from './types'

const term: TermMeta = {
  id: 'S27',
  name: 'Spring 2027',
  season: 'spring',
  year: 2027,
  minis: [
    { number: 3, name: 'Mini 3', start: '2027-01-19', end: '2027-03-05' },
    { number: 4, name: 'Mini 4', start: '2027-03-15', end: '2027-04-30' },
  ],
  classesBegin: '2027-01-19',
  classesEnd: '2027-04-30',
  noClasses: [
    { start: '2027-03-08', end: '2027-03-12', name: 'Spring break' },
    { start: '2027-04-15', end: '2027-04-17', name: 'Spring Carnival' },
  ],
}

const lecture: Section = {
  name: '1',
  kind: 'lecture',
  parent: null,
  mini: null,
  mode: 'IPE',
  instructors: ['Iliano Cervesato', 'Anne Kohlbrenner'],
  meetings: [
    { days: [1, 3], start: 570, end: 650, building: 'GHC', room: '4401' },
    { days: [1], start: 1140, end: 1220, building: null, room: null },
  ],
}

const course: Course = {
  id: '15122',
  code: '15-122',
  title: 'Principles of Imperative Computation',
  units: 12,
  dept: 'CS',
  level: 'U',
  instructors: lecture.instructors,
  sections: [lecture],
  crossListed: [],
}

const now = new Date(Date.UTC(2026, 9, 21, 12, 0, 0))

function events(ics: string): string[] {
  return ics.split('BEGIN:VEVENT').slice(1)
}

function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '')
}

describe('buildIcs', () => {
  const ics = buildIcs([{ course, section: lecture }], term, { calendarName: 'Spring 2027: Schedule 1', now })
  const text = unfold(ics)

  it('produces a valid calendar envelope with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
    expect(text).toContain('BEGIN:VTIMEZONE\r\nTZID:America/New_York')
    expect(text).toContain('X-WR-CALNAME:Spring 2027: Schedule 1')
  })

  it('emits one event per meeting starting on the first matching weekday', () => {
    const [main, evening] = events(text)
    expect(main).toContain('DTSTART;TZID=America/New_York:20270119T093000')
    expect(main).toContain('DTEND;TZID=America/New_York:20270119T105000')
    expect(main).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270501T035959Z')
    expect(main).toContain('SUMMARY:15-122 Principles of Imperative Computation')
    expect(main).toContain('LOCATION:GHC 4401')
    expect(main).toContain('DESCRIPTION:Lecture 1\\nInstructors: Iliano Cervesato\\, Anne Kohlbrenner\\n12 units')
    expect(main).toContain('DTSTAMP:20261021T120000Z')
    expect(evening).toContain('DTSTART;TZID=America/New_York:20270119T190000')
    expect(evening).not.toContain('LOCATION')
  })

  it('excludes dates with no classes', () => {
    const [main, evening] = events(text)
    expect(main).toContain('EXDATE;TZID=America/New_York:20270309T093000,20270311T093000,20270415T093000')
    expect(evening).toContain('EXDATE;TZID=America/New_York:20270309T190000')
  })

  it('uses mini dates for mini sections', () => {
    const m3: Section = { ...lecture, name: 'A3', mini: 3, meetings: [{ days: [0, 2], start: 600, end: 680, building: 'DH', room: '2210' }] }
    const m4: Section = { ...m3, name: 'A4', mini: 4 }
    const out = unfold(buildIcs([{ course, section: m3 }, { course, section: m4 }], term, { calendarName: 'x', now }))
    const [third, fourth] = events(out)
    expect(third).toContain('DTSTART;TZID=America/New_York:20270120T100000')
    expect(third).toContain('UNTIL=20270306T045959Z')
    expect(third).not.toContain('EXDATE')
    expect(fourth).toContain('DTSTART;TZID=America/New_York:20270315T100000')
    expect(fourth).toContain('UNTIL=20270501T035959Z')
    expect(fourth).toContain('(mini 4)')
  })

  it('exports a lecture and its recitation as separate events', () => {
    const rec: Section = {
      ...lecture,
      name: 'F',
      kind: 'section',
      parent: '1',
      instructors: [],
      meetings: [{ days: [2], start: 660, end: 710, building: 'WEH', room: '5302' }],
    }
    const out = unfold(buildIcs([{ course, section: lecture }, { course, section: rec }], term, { calendarName: 'x', now }))
    const all = events(out)
    expect(all).toHaveLength(3)
    const recitation = all[2]
    expect(recitation).toContain('UID:S27-15122-F-0@courseweave')
    expect(recitation).toContain('DTSTART;TZID=America/New_York:20270120T110000')
    expect(recitation).toContain('LOCATION:WEH 5302')
    expect(recitation).toContain('DESCRIPTION:Recitation F (Lecture 1)\\n12 units')
    expect(out).toContain('PRODID:-//Courseweave//CMU course planner//EN')
  })

  it('skips unscheduled sections', () => {
    const tba: Section = { ...lecture, meetings: [{ days: [], start: null, end: null, building: null, room: null }] }
    expect(events(buildIcs([{ course, section: tba }], term, { calendarName: 'x', now }))).toHaveLength(0)
  })

  it('keeps every physical line within 75 octets', () => {
    const long: Course = { ...course, title: 'Ünïcode — A Very Long Course Title, With Commas; Semicolons, And More Words To Fold Over Lines' }
    const out = buildIcs([{ course: long, section: lecture }], term, { calendarName: 'x', now })
    for (const line of out.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(unfold(out)).toContain('SUMMARY:15-122 Ünïcode — A Very Long Course Title\\, With Commas\\; Semicolons')
  })
})

describe('helpers', () => {
  it('escapes text values', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('folds without splitting multi-byte characters', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`)
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(80)}`)
  })

  it('knows US Eastern DST boundaries', () => {
    expect(easternOffsetHours(Date.UTC(2027, 2, 13))).toBe(5)
    expect(easternOffsetHours(Date.UTC(2027, 2, 14))).toBe(4)
    expect(easternOffsetHours(Date.UTC(2027, 10, 6))).toBe(4)
    expect(easternOffsetHours(Date.UTC(2027, 10, 7))).toBe(5)
  })

  it('summarizes meetings', () => {
    expect(meetingSummary(lecture)).toBe('TR 9:30–10:50 AM; T 7:00–8:20 PM')
  })
})

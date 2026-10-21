/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectMini, parseClock, parseStellicCourse, timingsToMeetings, type StellicSectionsFile } from '../../scripts/lib/stellic-parse.ts'
import type { TermMeta } from './types'

const F26: TermMeta = {
  id: 'F26',
  name: 'Fall 2026',
  season: 'fall',
  year: 2026,
  minis: [
    { number: 1, name: 'Mini 1', start: '2026-08-24', end: '2026-10-09' },
    { number: 2, name: 'Mini 2', start: '2026-10-19', end: '2026-12-04' },
  ],
  classesBegin: '2026-08-24',
  classesEnd: '2026-12-04',
  noClasses: [],
}

const raw = (day: string, start: string, end: string, building = 'GHC', room = '4401') => ({ day, start, end, building, room })

const file: StellicSectionsFile = {
  data_list: [
    {
      course: { code: '15-122', name: 'Principles of Imperative Computation', units: 12 },
      section_groups: [
        {
          group_name: 'Lecture',
          sections: [
            {
              name: '1',
              parent: null,
              type: { name: 'Lecture', short_name: 'L' },
              instructors: [{ first_name: 'Iliano', last_name: 'Cervesato' }],
              raw_timings: [raw('tuesday', '07:00 PM', '08:20 PM'), raw('tuesday', '09:30 AM', '10:50 AM'), raw('thursday', '09:30 AM', '10:50 AM')],
              max_enrollment: 244,
              start_date: '2026-08-24',
              end_date: '2026-12-05',
            },
          ],
        },
        {
          group_name: 'Recitation',
          sections: [
            {
              name: 'A',
              parent: { name: '1' },
              type: { name: 'Recitation', short_name: 'R' },
              instructors: [],
              raw_timings: [raw('friday', '09:00 AM', '09:50 AM', 'PH', '226C')],
              max_enrollment: 25,
              start_date: '2026-08-24',
              end_date: '2026-12-05',
            },
            { name: 'Z', parent: { name: '1' }, hidden: true, raw_timings: [] },
          ],
        },
      ],
    },
    // Stellic sometimes repeats the same course entry; sections must not duplicate.
    {
      course: { code: '15-122', name: 'Principles of Imperative Computation', units: 12 },
      section_groups: [{ group_name: 'Lecture', sections: [{ name: '1', parent: null, raw_timings: [] }] }],
    },
  ],
}

describe('stellic parsing', () => {
  it('parses clock times with or without a space', () => {
    expect(parseClock('07:00 PM')).toBe(1140)
    expect(parseClock('09:30AM')).toBe(570)
    expect(parseClock('12:00 PM')).toBe(720)
    expect(parseClock('')).toBeNull()
  })

  it('merges per-day timings into meetings and marks TBA sections', () => {
    expect(timingsToMeetings([raw('tuesday', '09:30 AM', '10:50 AM'), raw('thursday', '09:30 AM', '10:50 AM')])).toEqual([
      { days: [1, 3], start: 570, end: 650, building: 'GHC', room: '4401' },
    ])
    expect(timingsToMeetings([])).toEqual([{ days: [], start: null, end: null, building: null, room: null }])
    expect(timingsToMeetings([raw('monday', '10:00 AM', '10:50 AM', 'TBA', 'TBA')])[0].building).toBeNull()
  })

  it('detects minis from section dates, falling back to the name', () => {
    expect(detectMini('A', '2026-08-24', '2026-12-05', F26)).toBeNull()
    expect(detectMini('A', '2026-08-24', '2026-10-10', F26)).toBe(1)
    expect(detectMini('12', '2026-10-19', '2026-12-05', F26)).toBe(2)
    expect(detectMini('A2', null, null, F26)).toBe(2)
    // Dates from another year don't count.
    expect(detectMini('A1', '2025-08-25', '2025-12-06', F26)).toBe(1)
  })

  it('builds lectures with child recitations and drops hidden or duplicate sections', () => {
    const course = parseStellicCourse('15122', file, F26)!
    expect(course.code).toBe('15-122')
    expect(course.dept).toBe('CS')
    expect(course.level).toBe('U')
    expect(course.units).toBe(12)
    expect(course.sections.map((s) => [s.name, s.kind, s.parent])).toEqual([
      ['1', 'lecture', null],
      ['A', 'section', '1'],
    ])
    expect(course.sections[0].meetings).toHaveLength(2)
    expect(course.sections[0].instructors).toEqual(['Iliano Cervesato'])
    expect(course.sections[0].capacity).toBe(244)
    expect(course.sections[1].meetings[0]).toMatchObject({ days: [4], start: 540, building: 'PH', room: '226C' })
  })

  it('treats lettered sections typed as lectures as standalone sections, like SOC', () => {
    const lettered = parseStellicCourse('76101', { data_list: [{ course: { code: '76-101', name: 'Interpretation and Argument', units: 9 }, section_groups: [{ group_name: 'Lecture', sections: [{ name: 'A', parent: null, type: { name: 'Lecture', short_name: 'L' }, raw_timings: [] }] }] }] }, F26)!
    expect(lettered.sections[0].kind).toBe('section')
  })

  it('marks 600-level and above as graduate', () => {
    const grad = parseStellicCourse('15641', { data_list: [{ ...file.data_list[0], course: { code: '15-641', name: 'Networks', units: 12 } }] }, F26)!
    expect(grad.level).toBe('G')
  })

  const real = join(homedir(), 'Projects/scottylabs/courses/exported/jgtsao/courses_history/15122/ly1_sm1.json')
  it.skipIf(!existsSync(real))('parses a real Fall 2026 export', () => {
    const course = parseStellicCourse('15122', JSON.parse(readFileSync(real, 'utf8')), F26)!
    const lectures = course.sections.filter((s) => s.parent === null)
    const recitations = course.sections.filter((s) => s.parent !== null)
    expect(lectures.length).toBeGreaterThanOrEqual(1)
    expect(recitations.length).toBeGreaterThan(5)
    expect(recitations.every((r) => lectures.some((l) => l.name === r.parent))).toBe(true)
    expect(recitations.every((r) => r.meetings.some((m) => m.start !== null))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { indexTerm } from '../../lib/data'
import type { Course, Day, Section, TermData } from '../../lib/types'
import { entriesFromPlan } from './fromPlan'

const sec = (name: string, days: Day[], start: number, parent: string | null = null): Section => ({
  name,
  kind: parent === null ? 'lecture' : 'section',
  parent,
  mini: null,
  mode: 'IPE',
  instructors: [],
  meetings: [{ days, start, end: start + 50, building: null, room: null }],
})
const course = (id: string, sections: Section[]): Course => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units: 12,
  dept: 'CS',
  level: 'U',
  instructors: [],
  sections,
  crossListed: [],
})
const data: TermData = {
  term: { id: 'S27', name: 'Spring 2027', season: 'spring', year: 2027, minis: [], classesBegin: '2027-01-19', classesEnd: '2027-04-30', noClasses: [] },
  generatedAt: '',
  courses: [
    course('15122', [sec('1', [1, 3], 570), sec('A', [4], 600, '1'), sec('B', [4], 660, '1')]),
    course('15150', [sec('1', [1, 3], 570), sec('2', [1, 3], 750), sec('A', [2], 600, '2')]),
  ],
}

describe('entriesFromPlan', () => {
  it('picks conflict-free lectures and recitations in plan order, skipping unoffered courses', () => {
    const { entries, skipped } = entriesFromPlan([{ courseId: '15122' }, { courseId: '15150', passFail: true }, { courseId: '21127' }], indexTerm(data))
    expect(entries.map((e) => [e.courseId, e.section, e.child, e.passFail])).toEqual([
      ['15122', '1', 'A', false],
      // Lec 1 would clash with 15-122 Lec 1, so Lec 2 with its recitation.
      ['15150', '2', 'A', true],
    ])
    expect(new Set(entries.map((e) => e.color)).size).toBe(2)
    expect(skipped).toEqual(['21127'])
  })
})

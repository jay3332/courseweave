import { describe, expect, it } from 'vitest'
import { indexTerm } from '../../lib/data'
import type { Course, Day, Section, TermData } from '../../lib/types'
import { buildScheduleView, fittingSelections } from '../../state/schedule-view'
import type { Schedule, ScheduleEntry } from '../../state/store'
import { childForSection, conflictingCodes, initialChoice, partLabel, sectionCounts } from './format'

const h = (hours: number, minutes = 0) => hours * 60 + minutes
const sec = (name: string, days: Day[], start: number, end: number, parent: string | null = null, kind: Section['kind'] = parent ? 'section' : 'lecture'): Section => ({
  name,
  kind,
  parent,
  mini: null,
  mode: 'IPE',
  instructors: [],
  meetings: [{ days, start, end, building: 'GHC', room: '4401' }],
})

const course = (id: string, sections: Section[], extra: Partial<Course> = {}): Course => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units: 12,
  dept: 'CS',
  level: 'U',
  instructors: [],
  sections,
  crossListed: [],
  ...extra,
})

// 15-122: two lectures, each with a Friday-9am and a Friday-10am recitation.
const imperative = course('15122', [
  sec('1', [1, 3], h(9, 30), h(10, 50)),
  sec('A', [4], h(9), h(9, 50), '1'),
  sec('B', [4], h(10), h(10, 50), '1'),
  sec('2', [1, 3], h(11), h(12, 20)),
  sec('C', [4], h(9), h(9, 50), '2'),
  sec('D', [4], h(10), h(10, 50), '2'),
])
// Busy Friday 9am, and TR 9:30.
const busy = course('21127', [sec('1', [4], h(9), h(9, 50), null, 'section')])
const morning = course('76101', [sec('A', [1, 3], h(9, 30), h(10, 20), null, 'section')], { units: 9 })
const stuco = course('98012', [sec('A', [2], h(19), h(20), null, 'section')], { units: 3, passFail: true })

const data: TermData = {
  term: { id: 'X', name: 'Test', season: 'fall', year: 2026, minis: [], classesBegin: '2026-08-24', classesEnd: '2026-12-04', noClasses: [] },
  generatedAt: '',
  courses: [imperative, busy, morning, stuco],
}
const term = indexTerm(data)

const entry = (courseId: string, section: string | null, child: string | null = null, passFail = false): ScheduleEntry => ({ courseId, section, child, passFail, color: 0, hidden: false })
const schedule = (entries: ScheduleEntry[]): Schedule => ({ id: 's', termId: 'X', name: 'S', entries, createdAt: 0, updatedAt: 0 })

describe('planner choices', () => {
  it('labels recitations distinctly from standalone sections', () => {
    expect(partLabel(imperative.sections[0])).toBe('Lec 1')
    expect(partLabel(imperative.sections[1])).toBe('Rec A')
    expect(partLabel(busy.sections[0])).toBe('Sec 1')
    expect(sectionCounts(imperative)).toBe('2 lectures, 4 recitations')
    expect(sectionCounts(busy)).toBe('1 section')
  })

  it('starts a new course on a lecture and recitation that fit', () => {
    const view = buildScheduleView(schedule([entry('21127', '1'), entry('76101', 'A')]), term)
    // Lecture 1 collides with 76-101 on TR; Friday 9am recitations collide with 21-127.
    expect(fittingSelections(imperative, view).map((f) => `${f.section.name}${f.child?.name}`)).toEqual(['2D'])
    expect(initialChoice(imperative, view)).toEqual({ section: '2', child: 'D' })
  })

  it('pairs a fitting recitation when switching lectures', () => {
    const view = buildScheduleView(schedule([entry('21127', '1'), entry('15122', '2', 'D')]), term)
    expect(childForSection(imperative, '1', view)).toBe('B')
    expect(childForSection(busy, '1', view)).toBeNull()
  })

  it('checks conflicts across both parts of a selection', () => {
    const view = buildScheduleView(schedule([entry('21127', '1'), entry('15122', '1', 'A')]), term)
    expect(view.conflicts.get('15122')).toEqual(['21127'])
    expect(conflictingCodes(imperative.sections[2], '15122', view)).toEqual([])
    expect(conflictingCodes(imperative.sections[1], '15122', view)).toEqual(['21-127'])
  })

  it('flags a lecture with recitations but none chosen', () => {
    const view = buildScheduleView(schedule([entry('15122', '1')]), term)
    const resolved = view.entries[0]
    expect(resolved.needsChild).toBe(true)
    expect(resolved.parts.map((p) => p.name)).toEqual(['1'])
  })

  it('splits factorable and pass/fail units', () => {
    const view = buildScheduleView(schedule([entry('15122', '1', 'A'), entry('76101', 'A', null, true), entry('98012', 'A')]), term)
    expect(view.units).toEqual({ total: 24, factorable: 12, nonFactorable: 12, hasVariable: false })
  })
})

import { describe, expect, it } from 'vitest'
import type { Course, Day, Meeting, Section } from '../../src/lib/types.ts'
import { mergeSupplement } from './merge.ts'

const meeting = (days: Day[], start: number | null, building: string | null = null): Meeting => ({
  days,
  start,
  end: start === null ? null : start + 50,
  building,
  room: building ? '100' : null,
})
const section = (name: string, meetings: Meeting[]): Section => ({ name, kind: 'lecture', parent: null, mini: null, mode: 'IPE', instructors: [], meetings })
const course = (sections: Section[]): Course => ({ id: '45820', code: '45-820', title: 'T', units: 6, dept: 'BA', level: 'G', instructors: [], sections, crossListed: [] })

// The supplement has the room, an old Tuesday and Thursday time, and the same time split by day; for the section the
// primary lists as TBA, its times.
const supplement = () => [
  course([
    section('A3', [meeting([1, 3], 600, 'TEP'), meeting([2, 4], 600, 'TEP'), meeting([1], 600, 'TEP')]),
    section('B3', [meeting([2], 720, 'TEP')]),
  ]),
]

describe('mergeSupplement', () => {
  it('keeps the meeting times of an authoritative primary, filling rooms and TBA sections', () => {
    const primary = new Map([['45820', course([section('A3', [meeting([1, 3], 600)]), section('B3', [])])]])
    mergeSupplement(primary, supplement(), false, false)
    const [a, b] = primary.get('45820')!.sections
    expect(a.meetings).toEqual([meeting([1, 3], 600, 'TEP')])
    expect(b.meetings).toEqual([meeting([2], 720, 'TEP')])
  })

  it('adds meetings at other times when the primary may be missing some', () => {
    const primary = new Map([['45820', course([section('A3', [meeting([1, 3], 600)])])]])
    mergeSupplement(primary, supplement(), false, true)
    expect(primary.get('45820')!.sections[0].meetings).toHaveLength(3)
  })
})

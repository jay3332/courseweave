import { describe, expect, it } from 'vitest'
import { findConflicts, meetingsOverlap, sectionsConflict } from './conflicts'
import type { Day, Meeting, Section } from './types'

const meeting = (days: Day[], start: number | null, end: number | null): Meeting => ({ days, start, end, building: null, room: null })
const section = (name: string, meetings: Meeting[], mini: number | null = null): Section => ({
  name,
  kind: 'lecture',
  parent: null,
  mini,
  mode: 'IPE',
  instructors: [],
  meetings,
})

describe('meetingsOverlap', () => {
  it('detects overlap on a shared day', () => {
    expect(meetingsOverlap(meeting([1, 3], 570, 650), meeting([3], 600, 700))).toBe(true)
  })
  it('treats back-to-back meetings as not overlapping', () => {
    expect(meetingsOverlap(meeting([0], 540, 590), meeting([0], 590, 640))).toBe(false)
  })
  it('ignores meetings on different days', () => {
    expect(meetingsOverlap(meeting([0, 2, 4], 540, 590), meeting([1, 3], 540, 590))).toBe(false)
  })
  it('never conflicts with TBA meetings', () => {
    expect(meetingsOverlap(meeting([], null, null), meeting([0], 540, 590))).toBe(false)
  })
})

describe('sectionsConflict', () => {
  const a = section('A3', [meeting([0, 2], 930, 1010)], 3)
  const b = section('A4', [meeting([0, 2], 930, 1010)], 4)
  const full = section('1', [meeting([2], 960, 1050)])

  it('lets different minis share a time slot', () => {
    expect(sectionsConflict(a, b)).toBe(false)
  })
  it('flags a mini against an overlapping full-semester section', () => {
    expect(sectionsConflict(a, full)).toBe(true)
    expect(sectionsConflict(full, b)).toBe(true)
  })
  it('checks every meeting of multi-meeting sections', () => {
    const lecture = section('1', [meeting([1, 3], 570, 650), meeting([1], 1140, 1220)])
    const evening = section('A', [meeting([1], 1200, 1260)])
    expect(sectionsConflict(lecture, evening)).toBe(true)
  })
})

describe('findConflicts', () => {
  it('maps each conflicting key to its counterparts', () => {
    const x = section('1', [meeting([0], 540, 600)])
    const y = section('1', [meeting([0], 570, 630)])
    const z = section('1', [meeting([1], 540, 600)])
    const out = findConflicts([
      { key: 'x', section: x },
      { key: 'y', section: y },
      { key: 'z', section: z },
    ])
    expect(out.get('x')).toEqual(['y'])
    expect(out.get('y')).toEqual(['x'])
    expect(out.has('z')).toBe(false)
  })
})

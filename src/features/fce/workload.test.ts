import { describe, expect, it } from 'vitest'
import type { FceSummary } from '../../lib/fce'
import type { Course, MiniMeta, Section } from '../../lib/types'
import type { ResolvedEntry } from '../../state/schedule-view'
import { entryMini, scheduleLoad } from './workload'

const minis: MiniMeta[] = [
  { number: 3, name: 'Mini 3', start: '2027-01-19', end: '2027-03-05' },
  { number: 4, name: 'Mini 4', start: '2027-03-15', end: '2027-04-30' },
]
const section = (name: string, mini: number | null): Section => ({ name, kind: 'section', parent: null, mini, mode: 'IPE', instructors: [], meetings: [] })
const course = (id: string, units: number, sections: Section[]): Course => ({ id, code: id, title: id, units, dept: 'X', level: 'U', instructors: [], sections, crossListed: [] })
const entry = (c: Course, chosen: Section | null, hidden = false): ResolvedEntry => ({
  entry: { courseId: c.id, section: chosen?.name ?? null, child: null, color: 0, hidden, passFail: false },
  course: c,
  section: chosen,
  child: null,
  needsChild: false,
  parts: chosen ? [chosen] : [],
  factorable: true,
})
const summary = (hours: number | null, share = 0, half: FceSummary['mini']['half'] = null): FceSummary => ({
  hours,
  courseRate: 4,
  teachingRate: 4,
  responses: 10,
  terms: 2,
  totalTerms: 2,
  last: 'S26',
  hoursDelta: null,
  enrolled: 10,
  mini: { share, half },
})

describe('schedule workload by half', () => {
  const full = course('full', 12, [section('A', null)])
  const hci = course('hci', 6, [section('A3', 3), section('A4', 4)])
  const other = course('other', 6, [section('B4', 4)])
  const fce = new Map([
    ['full', summary(14)],
    ['hci', summary(11, 1, 'either')],
  ])

  it('uses the chosen section, then all sections, then FCE history', () => {
    expect(entryMini(entry(hci, hci.sections[1]), minis, undefined)).toBe(4)
    expect(entryMini(entry(other, null), minis, undefined)).toBe(4)
    expect(entryMini(entry(hci, null), minis, summary(10, 1, 'first'))).toBe(3)
    expect(entryMini(entry(full, null), minis, summary(10, 1, 'first'))).toBe(null)
  })

  it('adds full-semester courses to both halves and minis to theirs, at twice their units', () => {
    const load = scheduleLoad([entry(full, full.sections[0]), entry(hci, hci.sections[0]), entry(other, other.sections[0])], minis, fce)
    expect(load.units).toBe(24)
    const [m3, m4] = load.halves!
    expect(m3.load).toEqual({ hours: 14 + 11, expected: 12 + 12 })
    // 'other' has no FCE hours, so it counts at what its units suggest: 12 h/wk as a 6-unit mini.
    expect(m4.load).toEqual({ hours: 14 + 12, expected: 12 + 12 })
    expect(load.peak).toBe(1)
  })

  it('keeps a single total without minis and skips hidden courses', () => {
    const load = scheduleLoad([entry(full, full.sections[0]), entry(hci, hci.sections[0], true)], minis, fce)
    expect(load.halves).toBeNull()
    expect(load.total).toBe(14)
    expect(load.units).toBe(12)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { indexTerm } from '../../lib/data'
import type { TermData } from '../../lib/types'
import type { FceSummary } from '../../lib/fce'
import { courseMatches, EMPTY_FILTERS, parseFilters, sortCourses, writeFilters, type Filters } from './filters'
import { meetingSummary } from './summary'

const term = indexTerm(JSON.parse(readFileSync('public/data/S27.json', 'utf8')) as TermData)
const ctx = { bookmarks: new Set<string>(['15122']), fittingSections: () => [] }
const run = (f: Partial<Filters>) => term.courses.filter((c) => courseMatches(c, { ...EMPTY_FILTERS, ...f }, ctx))
const get = (id: string) => term.courseById.get(id)!

describe('explorer filters', () => {
  it('round-trips through URL params', () => {
    const f: Filters = { ...EMPTY_FILTERS, depts: ['CS', 'MSC'], levels: ['U'], units: ['9', 'var'], days: [1, 3], dayMode: 'any', after: 600, before: 1020, delivery: ['remote'], sessions: ['full', '3'], fits: true, saved: true, scheduledOnly: true }
    expect(parseFilters(writeFilters(new URLSearchParams('q=abc'), f))).toEqual(f)
    const withFce: Filters = { ...EMPTY_FILTERS, maxHours: 12, minRating: 4, withinUnits: true }
    expect(parseFilters(writeFilters(new URLSearchParams(), withFce))).toEqual(withFce)
    // Values outside the offered options are ignored rather than trusted from the URL.
    expect(parseFilters(new URLSearchParams('maxh=7&minrate=9')).maxHours).toBeNull()
    expect(writeFilters(new URLSearchParams('q=abc'), EMPTY_FILTERS).toString()).toBe('q=abc')
  })

  it('applies section-level filters to the same section', () => {
    const tr = run({ days: [1, 3], dayMode: 'only' })
    expect(tr.some((c) => c.id === '15150')).toBe(true)
    expect(tr.some((c) => c.id === '21127')).toBe(false)
    // 15-122 meets TR plus a T evening slot → only-TR passes, but ending by 5pm fails.
    expect(tr.some((c) => c.id === '15122')).toBe(true)
    expect(run({ days: [1, 3], before: 17 * 60 }).some((c) => c.id === '15122')).toBe(false)
    expect(run({ after: 9 * 60 }).some((c) => c.id === '21127')).toBe(true)
    expect(courseMatches(get('21127'), { ...EMPTY_FILTERS, after: 10 * 60, before: 11 * 60, days: [0, 2, 4] }, ctx)).toBe(true)
  })

  it('filters by dept, level, units, saved, session', () => {
    expect(run({ depts: ['CS'] }).every((c) => c.dept === 'CS')).toBe(true)
    expect(run({ levels: ['G'] }).every((c) => c.level === 'G')).toBe(true)
    expect(run({ units: ['var'] }).every((c) => c.units === null)).toBe(true)
    expect(run({ saved: true }).map((c) => c.id)).toEqual(['15122'])
    expect(run({ sessions: ['3'] }).every((c) => c.sections.some((s) => s.mini === 3))).toBe(true)
    expect(run({ scheduledOnly: true }).length).toBeLessThan(term.courses.length)
  })

  it('summarizes meetings', () => {
    expect(meetingSummary(get('15150')).primary).toBe('2 sections')
    expect(meetingSummary(get('15213')).primary).toBe('TR 2:00–3:20 PM')
  })

  it('filters and sorts by FCE workload', () => {
    const summary = (hours: number | null, courseRate: number | null): FceSummary => ({
      hours,
      courseRate,
      teachingRate: courseRate,
      responses: 10,
      terms: 2,
      totalTerms: 2,
      last: 'S26',
      hoursDelta: null,
      enrolled: 20,
      mini: { share: 0, half: null },
    })
    // 15-122 (12u): heavy; 15-150 (12u): light; 21-127 (12u): no FCE hours.
    const fce = new Map([
      ['15122', summary(16, 4.2)],
      ['15150', summary(9, 3.8)],
      ['21127', summary(null, 4.6)],
    ])
    const c = { ...ctx, fce }
    const pick = (f: Partial<Filters>) => ['15122', '15150', '21127'].filter((id) => courseMatches(get(id), { ...EMPTY_FILTERS, ...f }, c))
    expect(pick({ maxHours: 12 })).toEqual(['15150'])
    expect(pick({ minRating: 4 })).toEqual(['15122', '21127'])
    expect(pick({ withinUnits: true })).toEqual(['15150'])
    // Without FCE data the FCE filters don't hide anything.
    expect(['15122', '15150'].every((id) => courseMatches(get(id), { ...EMPTY_FILTERS, maxHours: 6 }, ctx))).toBe(true)

    const items = ['21127', '15122', '15150'].map((id) => ({ course: get(id), score: 1 }))
    expect(sortCourses(items, 'hours', fce).map((x) => x.id)).toEqual(['15150', '15122', '21127'])
    expect(sortCourses(items, 'hours-desc', fce).map((x) => x.id)).toEqual(['15122', '15150', '21127'])
    expect(sortCourses(items, 'rating', fce).map((x) => x.id)).toEqual(['21127', '15122', '15150'])
  })
})

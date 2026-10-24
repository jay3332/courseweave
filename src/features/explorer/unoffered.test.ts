import { describe, expect, it } from 'vitest'
import type { CatalogEntry, CatalogIndex } from '../../lib/catalog-types'
import type { FceSummary } from '../../lib/fce'
import type { Offering, Offerings } from '../../lib/offerings'
import { EMPTY_FILTERS, otherCourseMatches, sortOtherCourses, type Filters } from './filters'
import { buildUnoffered } from './unoffered'

const offering = (id: string, title: string, dept: string, level: string, terms: string[]): Offering => ({ id, title, dept, level, terms })
const offerings: Offerings = {
  byId: new Map(
    [
      offering('15122', 'Principles of Imperative Computation', 'CS', 'U', ['F26', 'S26']),
      offering('15411', 'Compiler Design', 'CS', 'U', ['F25']),
      offering('10601', 'Introduction to Machine Learning', 'MLG', 'G', ['S26']),
      offering('15999', 'Not in the Catalog', 'CS', 'U', ['S26']),
    ].map((o) => [o.id, o]),
  ),
  docs: [],
}

const entry = (id: string, title: string, units: number | null, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title,
  units,
  prereqs: null,
  coreqs: [],
  antireqs: [],
  equivalents: [],
  passFail: false,
  ...extra,
})
const catalog: CatalogIndex = {
  generatedAt: '',
  courses: Object.fromEntries(
    [
      entry('15122', 'Principles of Imperative Computation', 12),
      entry('15411', 'Compiler Design', 15),
      entry('10601', 'Introduction to Machine Learning', 12),
      entry('15466', 'Computer Game Programming', 12),
      entry('15700', 'Independent Study', 1, { unitsMax: 36 }),
      entry('15101', '15-101', 9),
    ].map((e) => [e.id, e]),
  ),
}

// F26 offers 15-122 only.
const docs = buildUnoffered((id) => id === '15122', offerings, catalog)
const byId = new Map(docs.map((d) => [d.course.id, d.course]))

describe('unoffered courses', () => {
  it('lists other semesters’ courses and catalog-only ones, not the semester’s own or number-only titles', () => {
    expect([...byId.keys()].sort()).toEqual(['10601', '15411', '15466', '15700', '15999'])
    expect(byId.get('15411')).toMatchObject({ code: '15-411', dept: 'CS', level: 'U', units: 15, unitsKnown: true, terms: ['F25'] })
    // Catalog-only: department from the number prefix, level from the number, variable units as VAR.
    expect(byId.get('15466')).toMatchObject({ dept: 'CS', level: 'U', terms: [] })
    expect(byId.get('15700')).toMatchObject({ dept: 'CS', level: 'G', units: null, unitsKnown: true })
    // Offered elsewhere but not in the catalog: units unknown.
    expect(byId.get('15999')).toMatchObject({ units: null, unitsKnown: false })
  })

  it('leaves catalog-only courses out without the offerings index', () => {
    expect(buildUnoffered(() => false, null, catalog)).toEqual([])
  })

  const ctx: Parameters<typeof otherCourseMatches>[2] = { bookmarks: new Set<string>(), fce: null }
  const pass = (f: Partial<Filters>, c = ctx) =>
    docs
      .map((d) => d.course)
      .filter((course) => otherCourseMatches(course, { ...EMPTY_FILTERS, ...f }, c))
      .map((course) => course.id)
      .sort()

  it('applies department, level, units, saved and requirement filters', () => {
    expect(pass({ depts: ['MLG'] })).toEqual(['10601'])
    expect(pass({ levels: ['G'] })).toEqual(['10601', '15700'])
    expect(pass({ units: ['13+'] })).toEqual(['15411'])
    expect(pass({ units: ['var'] })).toEqual(['15700'])
    expect(pass({ saved: true })).toEqual([])
    expect(pass({ req: { auditId: 1, nodeId: 2 } }, { ...ctx, reqAccepts: (id) => id.startsWith('15') })).toEqual(['15411', '15466', '15700', '15999'])
  })

  it('hides every course under a section filter', () => {
    expect(pass({ days: [1] })).toEqual([])
    expect(pass({ fits: true })).toEqual([])
    expect(pass({ scheduledOnly: true })).toEqual([])
  })

  it('applies FCE filters and sorts', () => {
    const summary = (hours: number, courseRate: number) => ({ hours, courseRate, teachingRate: null }) as unknown as FceSummary
    const fce = new Map([
      ['15411', summary(20, 4.5)],
      ['10601', summary(10, 3.9)],
    ])
    expect(pass({ maxHours: 12 }, { ...ctx, fce })).toEqual(['10601'])
    expect(pass({ minRating: 4 }, { ...ctx, fce })).toEqual(['15411'])
    const items = docs.map((d) => ({ course: d.course, score: 1 }))
    expect(sortOtherCourses(items, 'hours', fce).map((c) => c.id).slice(0, 2)).toEqual(['10601', '15411'])
    expect(sortOtherCourses(items, 'units').map((c) => c.id)).toEqual(['10601', '15466', '15411', '15700', '15999'])
    expect(sortOtherCourses(items, 'number').map((c) => c.id)).toEqual(['10601', '15411', '15466', '15700', '15999'])
  })
})

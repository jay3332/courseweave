import { describe, expect, it } from 'vitest'
import type { CatalogEntry, CatalogIndex } from './catalog-types'
import {
  academicYearLabel,
  checkPlan,
  currentTermCode,
  defaultTerms,
  incomingCredit,
  loadWarnings,
  nextTerm,
  offering,
  planColumns,
  planToAuditInput,
  isGeneralCredit,
  suggestTerm,
  termPhase,
  termTotals,
  type Plan,
  type RecordLike,
} from './plan'

const entry = (id: string, units: number, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
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
  courses: {
    '15112': entry('15112', 12, { offered: ['fall', 'spring', 'summer'] }),
    '15122': entry('15122', 12, { prereqs: { type: 'course', id: '15112', minGrade: 'C' }, coreqs: ['21127'], offered: ['fall', 'spring'] }),
    '21127': entry('21127', 12),
    '15213': entry('15213', 12, { prereqs: { type: 'course', id: '15122' }, offered: ['fall', 'spring'] }),
    '15251': entry('15251', 12, { prereqs: { type: 'all', items: [{ type: 'course', id: '15122' }, { type: 'course', id: '21127' }] }, offered: ['fall'] }),
    '99101': entry('99101', 3, { passFail: true }),
    '21120': entry('21120', 10),
  },
}

const plan = (terms: Record<string, string[]>): Plan => ({
  id: 'p',
  name: 'Plan',
  programs: [{ catalogId: 92, auditId: 19488 }],
  startTerm: 'F25',
  terms: Object.entries(terms).map(([term, ids]) => ({ term, courses: ids.map((courseId, i) => ({ id: `${term}-${i}`, courseId })) })),
  createdAt: 0,
  updatedAt: 0,
})

const emptyRecord: RecordLike = { entries: [], overrides: {} }

describe('terms', () => {
  it('lists fall/spring semesters', () => {
    expect(defaultTerms('F25', 4)).toEqual(['F25', 'S26', 'F26', 'S27'])
    expect(defaultTerms('M25', 2)).toEqual(['F25', 'S26'])
    expect(nextTerm('S26')).toBe('F26')
    expect(nextTerm('S26', true)).toBe('M26')
  })
  it('finds the current term from a date', () => {
    expect(currentTermCode(new Date(2026, 9, 21))).toBe('F26')
    expect(currentTermCode(new Date(2027, 1, 1))).toBe('S27')
    expect(currentTermCode(new Date(2027, 6, 1))).toBe('M27')
  })
  it('classifies phases and academic years', () => {
    expect(termPhase('S26', 'F26')).toBe('past')
    expect(termPhase('F26', 'F26')).toBe('current')
    expect(termPhase('S27', 'F26')).toBe('future')
    expect(academicYearLabel('S26')).toBe('2025–26')
    expect(academicYearLabel('F26')).toBe('2026–27')
  })
})

describe('planColumns', () => {
  it('puts record courses in their terms and adds record-only terms', () => {
    const record: RecordLike = {
      entries: [
        { id: 'a', courseId: '15112', source: 'taken', term: 'F25', grade: 'A' },
        { id: 'b', courseId: '21120', source: 'taken', term: 'M25', grade: 'B' },
        { id: 'c', courseId: '21127', source: 'exam', exam: { id: 'ap-calc', score: '5' } },
      ],
      overrides: {},
    }
    const cols = planColumns(plan({ F25: [], S26: ['15122'] }), record, 'F26')
    expect(cols.map((c) => c.term)).toEqual(['M25', 'F25', 'S26'])
    expect(cols[0].fromRecordOnly).toBe(true)
    expect(cols[1].recorded.map((e) => e.courseId)).toEqual(['15112'])
    expect(incomingCredit(record).map((e) => e.id)).toEqual(['c'])
  })
})

describe('planToAuditInput', () => {
  it('sends general transfer units without a CMU equivalent as credit', () => {
    const record: RecordLike = {
      entries: [
        { id: 'g1', courseId: null, source: 'transfer', units: 9, institution: 'Pitt' },
        { id: 'g2', courseId: null, source: 'transfer' },
      ],
      overrides: {},
    }
    const input = planToAuditInput(plan({ F25: [] }), record, catalog, { current: 'F26' })
    const general = input.courses.filter((c) => isGeneralCredit(c.courseId))
    expect(general).toEqual([{ courseId: 'credit:g1', term: null, status: 'credit', units: 9, passFail: true, source: 'Transfer: Pitt' }])
  })
  it('maps record and plan courses to statuses', () => {
    const record: RecordLike = {
      entries: [
        { id: 'a', courseId: '15112', source: 'taken', term: 'F25', grade: 'A' },
        { id: 'r', courseId: '21127', source: 'taken', term: 'F25', grade: 'R' },
        { id: 'x', courseId: '21120', source: 'exam', exam: { id: 'ap', score: '5' } },
      ],
      overrides: {},
    }
    const input = planToAuditInput(plan({ F25: ['15112'], F26: ['15122', '99101'], S27: ['15213'] }), record, catalog, { current: 'F26' })
    const byId = Object.fromEntries(input.courses.map((c) => [`${c.courseId}@${c.term}`, c]))
    expect(byId['15112@F25']).toMatchObject({ status: 'completed', grade: 'A', units: 12, passFail: false })
    expect(byId['21127@F25']).toBeUndefined()
    expect(byId['21120@null']).toMatchObject({ status: 'credit', passFail: true, units: 10 })
    expect(byId['15122@F26'].status).toBe('in-progress')
    expect(byId['99101@F26'].passFail).toBe(true)
    expect(byId['15213@S27'].status).toBe('planned')
    // The plan's duplicate of a recorded course isn't counted twice.
    expect(input.courses.filter((c) => c.courseId === '15112')).toHaveLength(1)
    expect(input.programs).toEqual([{ catalogId: 92, auditId: 19488 }])
  })
})

describe('termTotals', () => {
  it('splits factorable units and sums FCE hours', () => {
    const t = termTotals(
      [
        { courseId: '15122', units: 12, passFail: false },
        { courseId: '99101', units: 3, passFail: true },
        { courseId: '21127', units: 12, passFail: false },
      ],
      (id) => ({ '15122': 14, '21127': 10 })[id] ?? null,
    )
    expect(t).toMatchObject({ units: 27, factorable: 24, nonFactorable: 3, fceHours: 24, fceUnits: 24, missingFce: 1 })
    expect(loadWarnings(t)).toEqual([])
  })
  it('warns about heavy loads', () => {
    const t = termTotals(Array.from({ length: 5 }, (_, i) => ({ courseId: `c${i}`, units: 12, passFail: false })), () => 16)
    expect(loadWarnings(t)).toHaveLength(2)
  })
})

describe('checkPlan', () => {
  it('uses earlier terms for prerequisites and the same term for corequisites', () => {
    const record: RecordLike = { entries: [{ id: 'a', courseId: '15112', source: 'taken', term: 'F25', grade: 'B' }], overrides: {} }
    const p = plan({ F25: [], S26: ['15122', '21127'], F26: ['15213', '15251'] })
    const checks = checkPlan(p, record, catalog)
    const level = (id: string) => [...checks.values()].find((c) => c.courseId === id)!.check.level
    expect(level('15122')).toBe('planned') // prereq met by record, coreq taken alongside
    expect(level('15213')).toBe('planned') // prereq planned in S26
    expect(level('15251')).toBe('planned')
  })
  it('flags prerequisites planned too late', () => {
    const p = plan({ F25: ['15213'], S26: ['15122'] })
    const checks = checkPlan(p, emptyRecord, catalog)
    const c = checks.get('F25-0')!.check
    expect(c.level).toBe('problem')
    expect(c.issues[0].message).toContain('15-122')
  })
  it('honors waivers', () => {
    const p = plan({ F25: ['15213'] })
    const checks = checkPlan(p, { entries: [], overrides: { '15213': { prereqs: true } } }, catalog)
    expect(checks.get('F25-0')!.check.level).toBe('ok')
  })
})

describe('offering and suggestTerm', () => {
  it('prefers published schedules over catalog seasons', () => {
    expect(offering('15251', 'S27', catalog)).toBe('other-seasons')
    expect(offering('15251', 'F27', catalog)).toBe('usually')
    expect(offering('15251', 'S27', catalog, new Set(['15251']))).toBe('scheduled')
    expect(offering('21127', 'S27', catalog)).toBe('unknown')
  })
  it('suggests the first likely term with room', () => {
    const p = plan({ F25: [], S26: [], F26: ['15122'], S27: ['15213', '15112', '21127', '21120'], F27: [] })
    const unitsOf = (id: string) => catalog.courses[id]?.units
    expect(suggestTerm(p, '15251', catalog, 'S26', unitsOf)).toBe('F26')
    // S27 is full (46 + 12 > 54) and 15-213 isn't a fall-only course, so F27.
    expect(suggestTerm(p, '15213', catalog, 'S27', unitsOf)).toBe('F27')
  })
  it('waits until prerequisites are planned when given the record', () => {
    const p = plan({ F26: ['15122'], S27: [], F27: [] })
    const unitsOf = (id: string) => catalog.courses[id]?.units
    // Without the record it takes the first term with room; with it, the term after 15-122.
    expect(suggestTerm(p, '15213', catalog, 'F26', unitsOf)).toBe('F26')
    expect(suggestTerm(p, '15213', catalog, 'F26', unitsOf, undefined, undefined, emptyRecord)).toBe('S27')
  })
})

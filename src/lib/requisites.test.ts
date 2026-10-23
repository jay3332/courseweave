import { describe, expect, it } from 'vitest'
import type { CatalogEntry, CatalogIndex, Requisite } from './catalog-types'
import {
  buildEquivalence,
  checkCourse,
  createContext,
  describeRequisite,
  evaluateRequisite,
  gradePoints,
  isFactorableGrade,
  meetsMinGrade,
  missingParts,
  termLabel,
  termOrdinal,
  termRange,
  type CourseCredit,
} from './requisites'

const course = (id: string, minGrade?: string): Requisite => ({ type: 'course', id, ...(minGrade ? { minGrade } : {}) })
const all = (...items: Requisite[]): Requisite => ({ type: 'all', items })
const any = (...items: Requisite[]): Requisite => ({ type: 'any', items })
const done = (courseId: string, grade?: string): CourseCredit => ({ courseId, timing: 'completed', source: 'taken', grade })
const planned = (courseId: string): CourseCredit => ({ courseId, timing: 'planned', source: 'plan' })
const sameTerm = (courseId: string): CourseCredit => ({ courseId, timing: 'concurrent', source: 'schedule' })

const entry = (id: string, fields: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units: 12,
  prereqs: null,
  coreqs: [],
  antireqs: [],
  equivalents: [],
  passFail: false,
  ...fields,
})

describe('terms', () => {
  it('orders spring, summer, fall within a year', () => {
    expect(termOrdinal('S26')! < termOrdinal('M26')!).toBe(true)
    expect(termOrdinal('M26')! < termOrdinal('F26')!).toBe(true)
    expect(termOrdinal('F26')! < termOrdinal('S27')!).toBe(true)
    expect(termOrdinal('fall')).toBeNull()
  })
  it('labels and ranges terms', () => {
    expect(termLabel('F25')).toBe('Fall 2025')
    expect(termRange('F25', 'F26')).toEqual(['F25', 'S26', 'F26'])
    expect(termRange('F25', 'F26', true)).toEqual(['F25', 'S26', 'M26', 'F26'])
  })
})

describe('grades', () => {
  it('follows the CMU grade scale', () => {
    expect(gradePoints('A')).toBe(4)
    expect(gradePoints('b+')).toBe(3.33)
    expect(gradePoints('R')).toBe(0)
    expect(gradePoints('P')).toBeNull()
    expect(isFactorableGrade('R')).toBe(true)
    expect(isFactorableGrade('P')).toBe(false)
    expect(isFactorableGrade('AD')).toBe(false)
    expect(isFactorableGrade(undefined)).toBeNull()
  })
  it('compares against minimum grades', () => {
    expect(meetsMinGrade('B', 'C')).toBe('ok')
    expect(meetsMinGrade('C', 'C')).toBe('ok')
    expect(meetsMinGrade('D', 'C')).toBe('too-low')
    expect(meetsMinGrade('R', undefined)).toBe('too-low')
    expect(meetsMinGrade(undefined, 'C')).toBe('ok')
    expect(meetsMinGrade('P', 'C')).toBe('unverified')
    expect(meetsMinGrade('P', 'D')).toBe('ok')
  })
})

describe('evaluateRequisite', () => {
  it('handles a single course', () => {
    const ctx = createContext({ credits: [done('15122')] })
    expect(evaluateRequisite(course('15122'), ctx).status).toBe('met')
    expect(evaluateRequisite(course('15150'), ctx).status).toBe('missing')
  })

  it('combines all/any', () => {
    const req = all(course('15122'), any(course('21127'), course('21128'), course('15151')))
    expect(evaluateRequisite(req, createContext({ credits: [done('15122'), done('21128')] })).status).toBe('met')
    const partial = evaluateRequisite(req, createContext({ credits: [done('15122')] }))
    expect(partial.status).toBe('missing')
    expect(missingParts(partial)).toEqual(['one of 21-127, 21-128 or 15-151'])
  })

  it('reports planned when only planned courses satisfy it', () => {
    const req = all(course('15122'), course('21127'))
    const r = evaluateRequisite(req, createContext({ credits: [done('15122'), planned('21127')] }))
    expect(r.status).toBe('planned')
  })

  it('ignores same-term courses unless concurrency is allowed', () => {
    const ctx = createContext({ credits: [sameTerm('21127')] })
    expect(evaluateRequisite(course('21127'), ctx).status).toBe('missing')
    expect(evaluateRequisite(course('21127'), ctx, { allowConcurrent: true }).status).toBe('planned')
  })

  it('supports at-least-n', () => {
    const req: Requisite = { type: 'atLeast', n: 2, items: [course('1'), course('2'), course('3')] }
    expect(evaluateRequisite(req, createContext({ credits: [done('1'), done('3')] })).status).toBe('met')
    expect(evaluateRequisite(req, createContext({ credits: [done('1'), planned('2')] })).status).toBe('planned')
    const r = evaluateRequisite(req, createContext({ credits: [done('1')] }))
    expect(r.status).toBe('missing')
    expect(missingParts(r)).toEqual(['1 more of 1, 2 or 3'])
  })

  it('enforces minimum grades but assumes unknown grades are fine', () => {
    const req = course('15122', 'C')
    expect(evaluateRequisite(req, createContext({ credits: [done('15122', 'B')] })).status).toBe('met')
    expect(evaluateRequisite(req, createContext({ credits: [done('15122')] })).status).toBe('met')
    const low = evaluateRequisite(req, createContext({ credits: [done('15122', 'D')] }))
    expect(low.status).toBe('missing')
    expect(low.gradeTooLow).toEqual({ grade: 'D', minGrade: 'C' })
    expect(missingParts(low)).toEqual(['15-122 with C or better (you have D)'])
  })

  it('does not count failed or withdrawn courses', () => {
    expect(evaluateRequisite(course('15122'), createContext({ credits: [done('15122', 'R')] })).status).toBe('missing')
    expect(evaluateRequisite(course('15122'), createContext({ credits: [done('15122', 'W')] })).status).toBe('missing')
  })

  it('accepts transfer and exam credit regardless of minimum grade', () => {
    const ctx = createContext({ credits: [{ courseId: '21120', timing: 'completed', source: 'exam' }] })
    expect(evaluateRequisite(course('21120', 'C'), ctx).status).toBe('met')
  })

  it('accepts equivalent courses', () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { '15213': entry('15213', { equivalents: ['18213'] }), '18213': entry('18213') } }
    const ctx = createContext({ credits: [done('15513')], equivalents: buildEquivalence(catalog, [['15213', '15513', '18213']]) })
    const r = evaluateRequisite(course('18213'), ctx)
    expect(r.status).toBe('met')
    expect(r.match?.via).toBe('15513')
  })

  it('never blocks on text conditions', () => {
    const textOnly: Requisite = { type: 'text', text: 'Junior standing' }
    expect(evaluateRequisite(textOnly, createContext({ credits: [] })).status).toBe('unknown')
    const mixed = all(course('15122'), textOnly)
    expect(evaluateRequisite(mixed, createContext({ credits: [done('15122')] })).status).toBe('met')
    expect(evaluateRequisite(any(textOnly, course('1')), createContext({ credits: [] })).status).toBe('unknown')
  })

  it('describes expressions', () => {
    expect(describeRequisite(all(course('15122', 'C'), any(course('21127'), course('15151'))))).toBe('15-122 (C or better) and (21-127 or 15-151)')
  })
})

describe('buildEquivalence', () => {
  it('is symmetric but not transitive', () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { a: entry('a', { equivalents: ['b'] }), c: entry('c', { equivalents: ['b'] }) } }
    const eq = buildEquivalence(catalog)
    expect([...eq.get('a')!]).toEqual(['b'])
    expect([...eq.get('b')!].sort()).toEqual(['a', 'c'])
  })
  it('treats extra groups as cliques', () => {
    const eq = buildEquivalence(null, [['x', 'y', 'z']])
    expect([...eq.get('x')!].sort()).toEqual(['y', 'z'])
  })
  it('lets honors substitutes count one way, for the lower course and its catalog equivalents', () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { '21325': entry('21325', { equivalents: ['36225'] }) } }
    const eq = buildEquivalence(catalog)
    expect(eq.get('21325')?.has('21425')).toBe(true)
    expect(eq.get('36225')?.has('21425')).toBe(true)
    expect(eq.get('21425')?.has('21325') ?? false).toBe(false)
    // Chains: 21-269 > 21-268 > 21-266 > 21-259 > 21-256.
    expect([...eq.get('21256')!].sort()).toEqual(['21259', '21266', '21268', '21269'])
    expect(eq.get('21269')?.has('21256') ?? false).toBe(false)
  })
  it('counts honors substitutes for prerequisites, not the reverse', () => {
    const eq = buildEquivalence(null)
    expect(evaluateRequisite(course('21325', 'C'), createContext({ credits: [done('21425', 'B')], equivalents: eq })).status).toBe('met')
    expect(evaluateRequisite(course('21241'), createContext({ credits: [planned('21242')], equivalents: eq })).status).toBe('planned')
    expect(evaluateRequisite(course('21425'), createContext({ credits: [done('21325', 'A')], equivalents: eq })).status).toBe('missing')
  })
})

describe('checkCourse', () => {
  const e15213 = entry('15213', { prereqs: course('15122', 'C'), antireqs: ['18213'] })
  const e15122 = entry('15122', { prereqs: course('15112', 'C'), coreqs: ['21127', '21128', '15151'] })

  it('passes when everything is complete', () => {
    const r = checkCourse('15213', e15213, createContext({ credits: [done('15122', 'A')] }))
    expect(r.level).toBe('ok')
    expect(r.issues).toEqual([])
  })

  it('reports missing prerequisites', () => {
    const r = checkCourse('15213', e15213, createContext({ credits: [] }))
    expect(r.level).toBe('problem')
    expect(r.issues[0]).toMatchObject({ kind: 'prereq', severity: 'error', message: 'Missing prerequisite: 15-122 (C or better)' })
  })

  it('lets a corequisite be taken in the same term', () => {
    const r = checkCourse('15122', e15122, createContext({ credits: [done('15112'), sameTerm('21127')] }))
    expect(r.level).toBe('planned')
    expect(r.coreqs?.status).toBe('planned')
    const missing = checkCourse('15122', e15122, createContext({ credits: [done('15112')] }))
    expect(missing.issues.find((i) => i.kind === 'coreq')?.message).toBe('Needs one of 21-127, 21-128 or 15-151 before or in the same semester')
  })

  it('flags anti-requisites and repeats', () => {
    const r = checkCourse('15213', e15213, createContext({ credits: [done('15122'), done('18213'), done('15213', 'B')] }))
    expect(r.level).toBe('problem')
    expect(r.issues.map((i) => i.kind).sort()).toEqual(['antireq', 'repeat'])
  })

  it('honors overrides', () => {
    const ctx = createContext({ credits: [done('18213')], overrides: { '15213': { prereqs: true, antireqs: true } } })
    const r = checkCourse('15213', e15213, ctx)
    expect(r.level).toBe('ok')
    expect(r.waived).toEqual({ prereqs: true, coreqs: false, antireqs: true })
  })

  it('treats a waiver credit as satisfying prerequisites', () => {
    const ctx = createContext({ credits: [{ courseId: '15122', timing: 'completed', source: 'waiver' }] })
    expect(checkCourse('15213', e15213, ctx).level).toBe('ok')
  })

  it('warns when a pass/fail grade may not meet a minimum', () => {
    const r = checkCourse('15213', e15213, createContext({ credits: [done('15122', 'P')] }))
    expect(r.issues.map((i) => i.kind)).toEqual(['grade'])
  })

  it('has nothing to check for unknown courses', () => {
    expect(checkCourse('99999', undefined, createContext({ credits: [] })).level).toBe('ok')
  })
})

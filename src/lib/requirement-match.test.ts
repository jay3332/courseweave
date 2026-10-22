/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogEntry, CatalogIndex } from './catalog-types'
import type { ProgramVersion, ReqNode } from './degree-types'
import { compileAcceptor, flattenRequirements, nodeAccepts, requirementsForCourse } from './requirement-match'

let nextId = 1
const leaf = (course: string): ReqNode => ({ id: nextId++, name: `${course.slice(0, 2)}-${course.slice(2)}`, rule: { kind: 'all' }, children: [], course: { id: course }, notes: [] })
const group = (name: string, rule: ReqNode['rule'], children: ReqNode[], extra: Partial<ReqNode> = {}): ReqNode => ({ id: nextId++, name, rule, children, notes: [], ...extra })
const pool = (name: string, sets: NonNullable<ReqNode['pool']>[number]['sets'], extra: Partial<ReqNode> = {}): ReqNode => ({
  id: nextId++,
  name,
  rule: { kind: 'all' },
  children: [],
  pool: [{ sets, units: false, min: 1 }],
  notes: [],
  ...extra,
})
const version = (root: ReqNode, extra: Partial<ProgramVersion> = {}): ProgramVersion => ({
  auditId: 1,
  catalogId: 10,
  programName: 'BS in Testing',
  name: 'EY2025 Pittsburgh',
  kind: 'major',
  entryYear: 2025,
  campus: 'Pittsburgh',
  totalUnits: 360,
  attached: [],
  doubleCount: [],
  concentrations: [],
  root,
  ...extra,
})
const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, code: id, title: id, units: 9, prereqs: null, coreqs: [], antireqs: [], equivalents: [], passFail: false, ...extra })

describe('requirement matching', () => {
  const systems = group('Systems elective', { kind: 'any' }, [leaf('15410'), leaf('15440')])
  const hum = pool('Humanities electives', [{ depts: ['79', '80'], courses: ['73102'] }], { exclude: [{ courses: ['80210'] }] })
  const cat1 = group('Category 1', { kind: 'any' }, [pool('Category 1: CS', [{ courses: ['80130'] }, { courses: ['85100'], from: 'F25' }, { courses: ['85102'], to: 'M25' }]), pool('Category 1A: AI', [{ courses: ['85213'] }])], {
    programDependent: [{ programs: [10], children: [], include: true }],
  })
  // Category 1 is restricted per program below; fix the include list once ids exist.
  cat1.programDependent![0].children = [cat1.children[0].id]
  const anyCourse = pool('Free choice', [{ any: true }])
  const sci = group('Science', { kind: 'all' }, [pool('Any science', [{ depts: ['33', '09'] }])], { exclude: [{ courses: ['33100'] }] })
  const root = group('BS in Testing', { kind: 'all' }, [systems, group('Gen ed', { kind: 'all' }, [hum, cat1, sci, anyCourse])])
  const v = version(root)
  const catalog: CatalogIndex = { generatedAt: '', courses: { '15410': entry('15410', { equivalents: ['18410'] }), '18410': entry('18410') } }

  it('accepts named courses and their equivalents', () => {
    expect(nodeAccepts(systems, '15410', catalog)).toBe(true)
    expect(nodeAccepts(systems, '18410', catalog)).toBe(true)
    expect(nodeAccepts(systems, '15213', catalog)).toBe(false)
  })

  it('applies pool sets and exclusions', () => {
    expect(nodeAccepts(hum, '79104', null)).toBe(true)
    expect(nodeAccepts(hum, '73102', null)).toBe(true)
    expect(nodeAccepts(hum, '80210', null)).toBe(false)
    expect(nodeAccepts(hum, '15122', null)).toBe(false)
  })

  it('inherits exclusions from ancestors when compiling a requirement', () => {
    const anySci = sci.children[0]
    expect(nodeAccepts(anySci, '33100', null)).toBe(true)
    const accepts = compileAcceptor(v, anySci.id, null)!
    expect(accepts('33100')).toBe(false)
    expect(accepts('33141')).toBe(true)
  })

  it('honors term windows when a term is given', () => {
    const accepts = compileAcceptor(v, cat1.id, null, { term: 'S27' })!
    expect(accepts('85100')).toBe(true)
    expect(accepts('85102')).toBe(false)
    expect(compileAcceptor(v, cat1.id, null)!('85102')).toBe(true)
  })

  it('applies program-dependent options only for those programs', () => {
    expect(compileAcceptor(v, cat1.id, null)!('85213')).toBe(true)
    expect(compileAcceptor(v, cat1.id, null, { programIds: [10] })!('85213')).toBe(false)
  })

  it('ignores catch-all pools inside groups but accepts anything when one is chosen directly', () => {
    expect(compileAcceptor(v, root.id, null)!('99999')).toBe(false)
    expect(compileAcceptor(v, anyCourse.id, null)!('99999')).toBe(true)
  })

  it('flattens into selectable requirements with paths', () => {
    const flat = flattenRequirements(v)
    const names = flat.map((f) => f.name)
    expect(names).toContain('Systems elective')
    expect(names).toContain('Category 1: CS')
    expect(names).not.toContain('15-410')
    expect(flat.find((f) => f.name === 'Category 1: CS')!.path).toEqual(['Gen ed', 'Category 1'])
    expect(flat.find((f) => f.name === 'Free choice')!.broad).toBe(true)
  })

  it('lists the requirements one course counts toward', () => {
    const hits = requirementsForCourse([v], '15410', catalog)
    expect(hits.map((h) => h.name)).toEqual(['Systems elective'])
    const hum79 = requirementsForCourse([v], '80130', null, { programIds: [10] })
    expect(hum79.map((h) => h.name)).toEqual(['Humanities electives', 'Category 1: CS'])
    expect(hum79[1].path).toEqual(['Gen ed', 'Category 1'])
  })
})

// Real data: EY2023+ SCS General Education (built by npm run data from the Stellic export).
const GENED = 'public/data/programs/20440.json'
describe.skipIf(!existsSync(GENED))('SCS general education (real data)', () => {
  // Vitest runs a skipped suite's body while collecting it, so don't read the file when it isn't there (e.g. in CI).
  const present = existsSync(GENED)
  const v = (present ? JSON.parse(readFileSync(GENED, 'utf8')) : null) as ProgramVersion
  const flat = present ? flattenRequirements(v) : []
  const byName = (prefix: string) => flat.find((f) => f.name.startsWith(prefix))!

  it('exposes the gen-ed categories', () => {
    expect(byName('Category 1: Cognition')).toBeDefined()
    expect(byName('Category 2: Economic')).toBeDefined()
    expect(byName('Category 3: Cultural')).toBeDefined()
    expect(byName('Humanities/Arts Electives')).toBeDefined()
  })

  it('puts known courses in the right categories for a CS student in Spring 2027', () => {
    const opts = { term: 'S27', programIds: [92] }
    const cat1 = compileAcceptor(v, byName('Category 1').nodeId, null, opts)!
    expect(cat1('80130')).toBe(true)
    expect(cat1('85100')).toBe(true)
    // 85-102 only counted through Summer 2025.
    expect(cat1('85102')).toBe(false)
    const cat2 = compileAcceptor(v, byName('Category 2: Economic').nodeId, null, opts)!
    expect(cat2('73102')).toBe(true)
    expect(cat2('15122')).toBe(false)
    const cats = requirementsForCourse([v], '73102', null, opts).map((m) => m.name)
    expect(cats).toEqual(expect.arrayContaining(['Category 2: Economic, Political, and Social Institutions']))
    expect(requirementsForCourse([v], '15122', null, opts)).toEqual([])
  })
})

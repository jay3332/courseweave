/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { courseOptions, describeTarget, relatedAuditIds, runAudit } from './audit'
import type { CatalogEntry, CatalogIndex } from './catalog-types'
import type { DoubleCountRule, ProgramVersion, ReqNode } from './degree-types'
import type { AuditResult, PlannedCourse, RequirementResult } from './plan-types'

// ---------------------------------------------------------------------------
// Fixtures

let nextId = 1
const leaf = (id: string, extra: Partial<ReqNode> = {}): ReqNode => ({ id: nextId++, name: id, rule: { kind: 'all' }, children: [], course: { id }, notes: [], ...extra })
const group = (name: string, rule: ReqNode['rule'], children: ReqNode[], extra: Partial<ReqNode> = {}): ReqNode => ({ id: nextId++, name, rule, children, notes: [], ...extra })
const pool = (name: string, extra: Partial<ReqNode>): ReqNode => ({ id: nextId++, name, rule: { kind: 'all' }, children: [], notes: [], ...extra })

function version(catalogId: number, root: ReqNode, extra: Partial<ProgramVersion> = {}): ProgramVersion {
  return {
    auditId: catalogId * 10,
    catalogId,
    programName: root.name,
    name: 'EY2025 Pittsburgh',
    kind: 'major',
    entryYear: 2025,
    campus: 'Pittsburgh',
    totalUnits: null,
    attached: [],
    doubleCount: [],
    concentrations: [],
    root,
    ...extra,
  }
}

const done = (courseId: string, units = 12, grade?: string, term = 'F25'): PlannedCourse => ({ courseId, term, status: 'completed', units, passFail: false, ...(grade ? { grade } : {}) })
const planned = (courseId: string, units = 12, term = 'S27'): PlannedCourse => ({ courseId, term, status: 'planned', units, passFail: false })
// Matches planToAuditInput: credit is non-factorable (passFail: true) but still satisfies requirements.
const credit = (courseId: string, units = 10): PlannedCourse => ({ courseId, term: null, status: 'credit', units, passFail: true })

function audit(versions: ProgramVersion[], courses: PlannedCourse[], catalog: CatalogIndex | null = null, selected = versions.slice(0, 1)): AuditResult {
  return runAudit(
    { programs: selected.map((v) => ({ catalogId: v.catalogId, auditId: v.auditId })), courses },
    new Map(versions.map((v) => [v.auditId, v])),
    catalog,
  )
}

function find(r: RequirementResult, name: string): RequirementResult {
  if (r.name === name) return r
  for (const c of r.children) {
    try {
      return find(c, name)
    } catch {
      /* keep looking */
    }
  }
  throw new Error(`no node ${name}`)
}

const assignedIds = (r: RequirementResult): string[] => [...r.assigned.map((a) => a.courseId), ...r.children.flatMap(assignedIds)]

// ---------------------------------------------------------------------------

describe('runAudit: basics', () => {
  const root = group('Major', { kind: 'all' }, [leaf('15122'), leaf('15150')])
  const v = version(1, root)

  it('is complete when every course is done', () => {
    const r = audit([v], [done('15122'), done('15150')])
    expect(r.programs[0].state).toBe('complete')
    expect(r.unassigned).toEqual([])
  })

  it('is complete with plan when some are only planned', () => {
    const r = audit([v], [done('15122'), planned('15150')])
    expect(r.programs[0].state).toBe('complete-with-plan')
    expect(find(r.programs[0].root, '15150').state).toBe('complete-with-plan')
  })

  it('is in progress or missing otherwise', () => {
    expect(audit([v], [done('15122')]).programs[0].state).toBe('in-progress')
    expect(audit([v], []).programs[0].state).toBe('missing')
  })

  it('reports courses that count nowhere as unassigned', () => {
    expect(audit([v], [done('15122'), done('76101', 9)]).unassigned).toEqual(['76101'])
  })

  it('ignores failed and withdrawn courses', () => {
    const r = audit([v], [done('15122', 12, 'R'), done('15150', 12, 'W')])
    expect(r.programs[0].state).toBe('missing')
  })
})

describe('runAudit: alternatives', () => {
  it('commits only the best alternative and leaves the rest for later requirements', () => {
    const root = group('Major', { kind: 'all' }, [
      group('Elective', { kind: 'any' }, [leaf('15213'), leaf('18213')]),
      pool('Any 15-xxx', { pool: [{ sets: [{ depts: ['15'] }], units: false, min: 1 }] }),
    ])
    const r = audit([version(1, root)], [done('15213'), done('15251')])
    const elective = find(r.programs[0].root, 'Elective')
    expect(elective.state).toBe('complete')
    expect(find(elective, '18213').skipped).toBe(true)
    expect(assignedIds(find(r.programs[0].root, 'Any 15-xxx'))).toEqual(['15251'])
  })

  it('prefers a complete alternative over a planned one', () => {
    const root = group('Pick one', { kind: 'any' }, [leaf('21241'), leaf('21242')])
    const r = audit([version(1, root)], [planned('21241', 11), done('21242', 11)])
    expect(assignedIds(r.programs[0].root)).toEqual(['21242'])
    expect(r.programs[0].state).toBe('complete')
  })

  it('handles at-least-n groups', () => {
    const root = group('Two of three', { kind: 'atLeast', n: 2 }, [leaf('15410'), leaf('15411'), leaf('15418')])
    const v = version(1, root)
    expect(audit([v], [done('15410')]).programs[0].state).toBe('in-progress')
    const r = audit([v], [done('15410'), planned('15418'), done('15411')])
    expect(r.programs[0].state).toBe('complete')
    expect(r.programs[0].root.need).toEqual({ children: 2, of: 3 })
  })

  it('keeps taking children of an "any" group until its unit target is met', () => {
    const root = group('9 units of computing', { kind: 'any' }, [leaf('15110', { course: { id: '15110' } }), leaf('15112'), leaf('99101')], { minUnits: 18 })
    const r = audit([version(1, root)], [done('15110', 10), done('15112', 12)])
    expect(r.programs[0].state).toBe('complete')
    expect(r.programs[0].root.units).toEqual({ have: 22, planned: 0, need: 18 })
  })
})

describe('runAudit: honors substitutes', () => {
  it('counts an honors course where the regular one is named or pooled, but not the reverse', () => {
    const root = group('Major', { kind: 'all' }, [
      leaf('21241'),
      pool('Probability', { pool: [{ sets: [{ courses: ['21325', '36225'] }], units: false, min: 1 }] }),
      leaf('21425'),
    ])
    const r = audit([version(1, root)], [done('21242'), done('21425'), done('21325')])
    expect(find(r.programs[0].root, '21241').assigned.map((a) => a.courseId)).toEqual(['21242'])
    expect(find(r.programs[0].root, 'Probability').state).toBe('complete')
    // 21-325 can't stand in for 21-425, so the 21-425 slot keeps the real course.
    expect(find(r.programs[0].root, '21425').assigned.map((a) => a.courseId)).toEqual(['21425'])
    const onlyRegular = audit([version(2, group('Major', { kind: 'all' }, [leaf('21425')]))], [done('21325')])
    expect(find(onlyRegular.programs[0].root, '21425').state).not.toBe('complete')
  })
})

describe('runAudit: pools', () => {
  it('keeps "same subject code" pools to one department', () => {
    const sameDept = () =>
      group('Science', { kind: 'all' }, [pool('Same department', { pool: [{ sets: [{ depts: ['09', '33', '03'] }], units: false, min: 2, sameDept: true }] })])
    // Physics + chemistry: two departments, so not satisfied.
    const mixed = audit([version(1, sameDept())], [credit('33142', 12), credit('09105', 10)])
    expect(find(mixed.programs[0].root, 'Same department').state).not.toBe('complete')
    // Adding a second chemistry course completes it with the chemistry pair.
    const r = audit([version(2, sameDept())], [credit('33142', 12), credit('09105', 10), done('09106', 10)])
    const p = find(r.programs[0].root, 'Same department')
    expect(p.state).toBe('complete')
    expect(assignedIds(p).sort()).toEqual(['09105', '09106'])
  })

  it('spreads "different subject codes" pools across departments', () => {
    const root = group('Breadth', { kind: 'all' }, [pool('Different', { pool: [{ sets: [{ depts: ['09', '33'] }], units: false, min: 2, differentDepts: true }] })])
    const r = audit([version(1, root)], [done('09105', 10), done('09106', 10), done('33141', 12)])
    expect(assignedIds(find(r.programs[0].root, 'Different')).sort()).toEqual(['09105', '33141'])
  })

  it('fills unit targets from a pool, honoring exclusions', () => {
    const root = group('Major', { kind: 'all' }, [
      pool('SCS electives', {
        pool: [{ sets: [{ ranges: [['15200', '15999']] }], units: true, min: 18 }],
        exclude: [{ courses: ['15351'] }],
      }),
    ])
    const r = audit([version(1, root)], [done('15351', 9), done('15330', 9), planned('15440', 12)])
    const p = find(r.programs[0].root, 'SCS electives')
    expect(assignedIds(p)).toEqual(['15330', '15440'])
    expect(p.units).toEqual({ have: 9, planned: 12, need: 18 })
    expect(p.state).toBe('complete-with-plan')
  })

  it("prefers courses no specific requirement names", () => {
    const root = group('Major', { kind: 'all' }, [
      pool('Any CS', { pool: [{ sets: [{ depts: ['15'] }], units: false, min: 1 }] }),
      leaf('15251'),
    ])
    const r = audit([version(1, root)], [done('15251'), done('15330', 9)])
    expect(assignedIds(find(r.programs[0].root, 'Any CS'))).toEqual(['15330'])
    expect(find(r.programs[0].root, '15251').state).toBe('complete')
  })

  it('applies at-most caps across a subtree', () => {
    const root = group(
      'Major',
      { kind: 'all' },
      [pool('Electives', { pool: [{ sets: [{ depts: ['80'] }], units: false, min: 3 }] })],
      { caps: [{ sets: [{ ranges: [['80100', '80199']] }], units: false, max: 1 }] },
    )
    const r = audit([version(1, root)], [done('80100', 9), done('80150', 9), done('80250', 9)])
    const p = find(r.programs[0].root, 'Electives')
    expect(assignedIds(p).sort()).toEqual(['80100', '80250'])
    expect(p.state).toBe('in-progress')
  })

  it('handles wildcard patterns, any-department ranges, and windows', () => {
    const root = group('Major', { kind: 'all' }, [
      pool('300-level ML', { pool: [{ sets: [{ patterns: ['^103\\d\\d$'] }], units: false, min: 1 }] }),
      pool('Upper level', { pool: [{ sets: [{ anyDeptRanges: [[300, 999]], to: 'S26' }], units: false, min: 1 }] }),
    ])
    const r = audit([version(1, root)], [done('10301'), done('36401', 9, undefined, 'F26'), done('21355', 9, undefined, 'S26')])
    expect(assignedIds(find(r.programs[0].root, '300-level ML'))).toEqual(['10301'])
    expect(assignedIds(find(r.programs[0].root, 'Upper level'))).toEqual(['21355'])
  })

  it('counts repeats', () => {
    const root = pool('Convocation', { repeat: { courses: ['57100'], times: 3, sameCourse: true }, allowPassFail: true })
    const v = version(1, root)
    expect(audit([v], [done('57100', 0), done('57100', 0)]).programs[0].state).toBe('in-progress')
    const r = audit([v], [done('57100', 0), done('57100', 0, undefined, 'S26'), planned('57100', 0)])
    expect(r.programs[0].state).toBe('complete-with-plan')
    expect(r.programs[0].root.courses).toEqual({ have: 2, planned: 1, need: 3 })
  })
})

describe('runAudit: grades and grading', () => {
  const root = group('Math', { kind: 'any' }, [leaf('21127'), leaf('15151')], { minGrade: 'C' })
  const v = version(1, root)

  it('enforces minimum grades but accepts unknown grades and credit', () => {
    expect(audit([v], [done('21127', 12, 'D')]).programs[0].state).toBe('missing')
    expect(audit([v], [done('21127', 12, 'B')]).programs[0].state).toBe('complete')
    expect(audit([v], [done('21127', 12)]).programs[0].state).toBe('complete')
    expect(audit([v], [credit('21127')]).programs[0].state).toBe('complete')
  })

  it('counts transfer and exam credit toward requirements that exclude pass/fail work', () => {
    const strict = version(3, group('CS', { kind: 'all' }, [leaf('15122')]))
    expect(audit([strict], [credit('15122', 12)]).programs[0].state).toBe('complete')
  })

  it('keeps pass/fail work out unless allowed', () => {
    const pf = { ...done('21127'), passFail: true, grade: 'P' }
    expect(audit([v], [pf]).programs[0].state).toBe('missing')
    const allowed = version(2, { ...root, id: nextId++, allowPassFail: true })
    expect(audit([allowed], [pf]).programs[0].state).toBe('complete')
  })

  it('lets a named pass/fail-only course satisfy its own requirement', () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { '99101': entry('99101', { passFail: true, units: 3 }) } }
    const r = audit([version(1, group('Root', { kind: 'all' }, [leaf('99101')]))], [{ ...done('99101', 3), passFail: true }], catalog)
    expect(r.programs[0].state).toBe('complete')
  })

  it("doesn't spend a course named elsewhere on an equivalent requirement", () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { '21120': entry('21120', { equivalents: ['21122'], units: 10 }), '21122': entry('21122', { units: 10 }) } }
    const root = group('Calculus', { kind: 'all' }, [leaf('21120'), leaf('21122')])
    const r = audit([version(1, root)], [credit('21122')], catalog)
    const [calc120, calc122] = r.programs[0].root.children
    expect(calc120.state).toBe('missing')
    expect(calc122.state).toBe('complete')
  })

  it('counts equivalent courses for named requirements', () => {
    const catalog: CatalogIndex = { generatedAt: '', courses: { '15213': entry('15213', { equivalents: ['18213'] }), '18213': entry('18213') } }
    const r = audit([version(1, group('Systems', { kind: 'all' }, [leaf('15213')]))], [done('18213')], catalog)
    expect(r.programs[0].state).toBe('complete')
  })
})

describe('runAudit: double counting', () => {
  const genEdRoot = group('Gen ed', { kind: 'all' }, [pool('Any course', { pool: [{ sets: [{ any: true }], units: false, min: 1 }] })])
  const genEd = version(5, genEdRoot, { kind: 'requirements' })
  const majorRoot = group('Major', { kind: 'all' }, [leaf('15122')])

  it('auto-includes attached programs after the major', () => {
    const major = version(1, majorRoot, { attached: [{ catalogId: 5, name: 'Gen ed', auditId: genEd.auditId }] })
    const r = audit([major, genEd], [done('15122')])
    expect(r.programs.map((p) => p.catalogId)).toEqual([1, 5])
    expect(r.programs[1].attachedTo).toBe(1)
    expect(relatedAuditIds({ programs: [{ catalogId: 1, auditId: major.auditId }], courses: [] }, new Map([[major.auditId, major]]))).toEqual([genEd.auditId])
  })

  it('shares courses across programs when no rule forbids it', () => {
    const major = version(1, majorRoot, { attached: [{ catalogId: 5, name: 'Gen ed', auditId: genEd.auditId }] })
    const r = audit([major, genEd], [done('15122')])
    expect(r.programs[1].state).toBe('complete')
  })

  it("doesn't share when a double-counting rule says so", () => {
    const rule: DoubleCountRule = { programs: [5], programNames: ['Gen ed'], limit: 0, units: false, exceptions: [] }
    const major = version(1, majorRoot, { attached: [{ catalogId: 5, name: 'Gen ed', auditId: genEd.auditId }], doubleCount: [rule] })
    expect(audit([major, genEd], [done('15122')]).programs[1].state).toBe('missing')
    expect(audit([major, genEd], [done('15122'), done('76101', 9)]).programs[1].state).toBe('complete')
  })

  it('allows sharing up to a limit and within exception requirements', () => {
    const minorRoot = group('Minor', { kind: 'all' }, [leaf('15122'), leaf('15150')])
    const minor = version(7, minorRoot, { kind: 'minor' })
    const limited = version(1, group('Major', { kind: 'all' }, [leaf('15122'), leaf('15150')]), {
      doubleCount: [{ programs: [], programNames: [], kinds: ['minor'], limit: 1, units: false, exceptions: [] }],
    })
    const r = audit([limited, minor], [done('15122'), done('15150')], null, [limited, minor])
    expect(r.programs[1].state).toBe('in-progress')

    const excepted = version(1, limited.root, {
      doubleCount: [{ programs: [], programNames: [], limit: 0, units: false, exceptions: [{ nodes: [limited.root.id], limit: 99, units: false }] }],
    })
    expect(audit([excepted, minor], [done('15122'), done('15150')], null, [excepted, minor]).programs[1].state).toBe('complete')
  })

  it('lets a requirement share with others in the same program when allowed', () => {
    const shared = group('Pair', { kind: 'all' }, [leaf('05180')], { shareWithin: { limit: 5, units: true } })
    const root = group('Major', { kind: 'all' }, [shared, pool('HCI elective', { pool: [{ sets: [{ depts: ['05'] }], units: false, min: 1 }] })])
    const r = audit([version(1, root)], [done('05180', 5)])
    expect(r.programs[0].state).toBe('complete')
    const strict = group('Major', { kind: 'all' }, [group('Pair', { kind: 'all' }, [leaf('05180')]), pool('HCI elective', { pool: [{ sets: [{ depts: ['05'] }], units: false, min: 1 }] })])
    expect(audit([version(2, strict)], [done('05180', 5)]).programs[0].state).toBe('in-progress')
  })
})

describe('runAudit: conditional and manual rules', () => {
  it('restricts children for program-dependent requirements', () => {
    const a = leaf('85211')
    const b = leaf('85213')
    const cat = group('Category 1', { kind: 'any' }, [a, b], { programDependent: [{ programs: [1], children: [b.id], include: true }] })
    const genEd = version(5, group('Gen ed', { kind: 'all' }, [cat]), { kind: 'requirements' })
    const major = version(1, group('Major', { kind: 'all' }, []), { attached: [{ catalogId: 5, name: 'Gen ed', auditId: genEd.auditId }] })
    const r = audit([major, genEd], [done('85211', 9)])
    const c1 = find(r.programs[1].root, 'Category 1')
    expect(c1.state).toBe('missing')
    expect(find(c1, '85211').skipped).toBe(true)
  })

  it('leaves manual checks out of the rollup but counts them', () => {
    const root = group('Major', { kind: 'all' }, [leaf('15122'), pool('QPA Requirement', { manual: true, notes: ['Greater than or equal to 3.00 gpa'] })])
    const r = audit([version(1, root)], [done('15122')])
    expect(r.programs[0].state).toBe('complete')
    expect(r.programs[0].manualCount).toBe(1)
    expect(find(r.programs[0].root, 'QPA Requirement').manual).toBe(true)
  })

  it('skips hide-unless-attempted alternatives the student never started', () => {
    const optional = group('Alt path', { kind: 'all' }, [leaf('36002')], { onlyIfAttempted: true })
    const root = group('Major', { kind: 'all' }, [leaf('36200'), optional])
    const r = audit([version(1, root)], [done('36200', 9)])
    expect(r.programs[0].state).toBe('complete')
    expect(find(r.programs[0].root, 'Alt path').skipped).toBe(true)
  })

  it('checks the degree unit total', () => {
    const v = version(1, group('Major', { kind: 'all' }, [leaf('15122')]), { totalUnits: 30 })
    const r = audit([v], [done('15122'), done('76101', 9), planned('15150')])
    expect(r.programs[0].totalUnits).toEqual({ have: 21, credit: 0, planned: 12, inProgress: 0, need: 30 })
    expect(r.programs[0].state).toBe('complete-with-plan')
  })

  it("splits out credit and this semester's units, and leaves excluded courses out of the total", () => {
    const v = version(1, group('Major', { kind: 'all' }, [leaf('15122')], { exclude: [{ courses: ['98008'] }] }), { totalUnits: 60 })
    const now: PlannedCourse = { ...planned('15150'), term: 'F26', status: 'in-progress' }
    const r = audit([v], [done('15122'), credit('21120'), now, planned('21127', 10), planned('98008', 3)])
    expect(r.programs[0].totalUnits).toEqual({ have: 22, credit: 10, planned: 22, inProgress: 12, need: 60 })
  })
})

describe('helpers', () => {
  it('describes targets and lists options', () => {
    const n = pool('Electives', { pool: [{ sets: [{ depts: ['15'] }], units: true, min: 18 }], exclude: [{ courses: ['15351'] }], minGrade: 'C' })
    expect(describeTarget(n)).toBe('18 units, C or better')
    expect(describeTarget(group('x', { kind: 'atLeast', n: 2 }, [leaf('1'), leaf('2'), leaf('3')]))).toBe('2 of 3')
    const catalog: CatalogIndex = { generatedAt: '', courses: { '15351': entry('15351'), '15330': entry('15330'), '21127': entry('21127') } }
    expect(courseOptions(n, catalog)).toEqual(['15330'])
  })
})

function entry(id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, code: `${id.slice(0, 2)}-${id.slice(2)}`, title: id, units: 12, prereqs: null, coreqs: [], antireqs: [], equivalents: [], passFail: false, ...extra }
}

// ---------------------------------------------------------------------------
// Real data: BS in Computer Science, EY2025 Pittsburgh (audit 19488)

const programsDir = join(process.cwd(), 'public', 'data', 'programs')
const catalogPath = join(process.cwd(), 'public', 'data', 'catalog', 'index.json')
const haveReal = existsSync(join(programsDir, '19488.json')) && existsSync(catalogPath)

describe.skipIf(!haveReal)('runAudit: BS in Computer Science (EY2025)', () => {
  const load = (id: number): ProgramVersion => JSON.parse(readFileSync(join(programsDir, `${id}.json`), 'utf8'))
  const catalog: CatalogIndex = haveReal ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { generatedAt: '', courses: {} }
  const units = (id: string) => catalog.courses[id]?.units ?? 9

  const semesters: [string, string[]][] = [
    ['F25', ['15122', '21127', '21120', '76101', '07128', '99101']],
    ['S26', ['15150', '15151', '21122', '21241', '85211']],
    ['F26', ['15210', '15213', '21259', '36218', '79104']],
    ['S27', ['15251', '15259', '10301', '73102', '80180']],
    ['F27', ['15451', '15312', '17313', '33121', '76270']],
    ['S28', ['15410', '15330', '33122', '82101']],
    ['F28', ['15445', '15440', '57173', '48100']],
    ['S29', ['15462', '85213', '76106']],
  ]
  const courses: PlannedCourse[] = semesters.flatMap(([term, ids]) =>
    ids.map((id) => ({
      courseId: id,
      term,
      status: term < 'S27' || term === 'F25' || term === 'F26' ? ('completed' as const) : ('planned' as const),
      units: units(id),
      passFail: Boolean(catalog.courses[id]?.passFail),
      ...(term === 'F25' || term === 'S26' || term === 'F26' ? { grade: 'A' } : {}),
    })),
  )
  // Status by term order, not string order.
  for (const c of courses) c.status = ['F25', 'S26', 'F26'].includes(c.term!) ? 'completed' : 'planned'

  it('produces a sensible audit quickly', () => {
    const major = load(19488)
    const versions = new Map<number, ProgramVersion>([[major.auditId, major]])
    for (const id of relatedAuditIds({ programs: [{ catalogId: 92, auditId: 19488 }], courses }, versions)) versions.set(id, load(id))

    const started = performance.now()
    const r = runAudit({ programs: [{ catalogId: 92, auditId: 19488 }], courses }, versions, catalog)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(50)

    const [cs, genEd] = r.programs
    expect(cs.name).toBe('BS in Computer Science')
    expect(genEd.attachedTo).toBe(92)

    const core = find(cs.root, 'Computer Science')
    expect(find(core, '15-122').state).toBe('complete')
    expect(find(core, '15-451').state).toBe('complete-with-plan')
    expect(find(core, 'xx-213 Introduction to Computer Systems').state).toBe('complete')
    expect(find(core, 'Artificial Intelligence Elective').state).toBe('complete-with-plan')
    expect(find(core, 'Logics & Languages Elective').state).toBe('complete-with-plan')
    expect(find(core, 'Software Systems Elective').state).toBe('complete-with-plan')
    expect(find(cs.root, 'Mathematics and Probability').state).toBe('complete')
    expect(find(cs.root, 'Technical Communication').state).toBe('complete-with-plan')
    expect(find(cs.root, 'First-year Immigration Course').state).toBe('complete')
    expect(cs.totalUnits?.need).toBe(360)

    // Gen-ed may not reuse major courses: 15-xxx shouldn't appear there.
    expect(assignedIds(genEd.root).some((id) => id.startsWith('15'))).toBe(false)
    expect(find(genEd.root, 'First Year Writing').state).toBe('complete')
  })
})

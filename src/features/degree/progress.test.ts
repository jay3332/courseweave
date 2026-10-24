import { describe, expect, it } from 'vitest'
import type { AuditResult, PlannedCourse, ProgramAuditResult, RequirementResult } from '../../lib/plan-types'
import { degreeProgress, requirementShortfall, tallyRequirements } from './progress'

let id = 1
const req = (state: RequirementResult['state'], statuses: RequirementResult['assigned'][number]['status'][] = [], extra: Partial<RequirementResult> = {}): RequirementResult => ({
  nodeId: id++,
  name: 'R',
  state,
  assigned: statuses.map((status) => ({ courseId: '15122', units: 12, term: null, status })),
  notes: [],
  children: [],
  ...extra,
})
const program = (root: RequirementResult, extra: Partial<ProgramAuditResult> = {}): ProgramAuditResult => ({ catalogId: id++, auditId: id++, name: 'P', state: root.state, root, ...extra })
const result = (...programs: ProgramAuditResult[]): AuditResult => ({ programs, unassigned: [] })

describe('tallyRequirements', () => {
  it('sorts requirements by how far along they are, leaving out ones not needed and advisor checks', () => {
    const root = req('in-progress', [], {
      children: [
        req('complete', ['completed']),
        req('complete-with-plan', ['completed', 'in-progress']),
        req('complete-with-plan', ['in-progress', 'planned']),
        req('missing'),
        req('missing', [], { skipped: true }),
        req('missing', [], { manual: true }),
        req('in-progress', [], { skipped: true, children: [req('missing'), req('missing')] }),
      ],
    })
    expect(tallyRequirements(root)).toEqual({ done: 1, inProgress: 1, planned: 1, total: 4 })
  })
})

describe('requirementShortfall', () => {
  const unitsOf = (id: string) => ({ '15122': 12, '15150': 12, '76101': 9 })[id]
  const course = (courseId: string, state: RequirementResult['state'] = 'missing') => req(state, [], { kind: 'course', courseId })

  it('adds up the missing courses, the cheapest ones that complete a "pick some" group, and pools', () => {
    const root = req('in-progress', [], {
      children: [
        course('15122', 'complete'),
        course('15150'),
        // Pick 1 of 3: the cheapest open one.
        req('missing', [], { kind: 'group', need: { children: 1, of: 3 }, children: [course('15122'), course('76101'), course('15150')] }),
        // 36 units, 12 planned.
        req('in-progress', ['planned'], { kind: 'pool', units: { have: 0, planned: 12, need: 36 } }),
        // Two more courses, sized like the one it has (10 units).
        req('in-progress', [], { kind: 'pool', courses: { have: 1, planned: 0, need: 3 }, assigned: [{ courseId: '21120', units: 10, term: null, status: 'completed' }] }),
        course('99999', 'missing'),
      ],
    })
    expect(requirementShortfall(root, unitsOf)).toEqual({ units: 12 + 9 + 24 + 20 + 9, count: 5 })
  })

  it('needs nothing when every requirement is met or not needed', () => {
    const root = req('complete-with-plan', [], { children: [course('15122', 'complete'), course('15150', 'complete-with-plan')] })
    expect(requirementShortfall(root, unitsOf)).toEqual({ units: 0, count: 0 })
    expect(requirementShortfall(req('missing', [], { manual: true }), unitsOf)).toEqual({ units: 0, count: 0 })
  })
})

describe('degreeProgress', () => {
  const unitsOf = () => 12
  const missing = req('missing', [], { kind: 'course', courseId: '15451' })

  it('keeps going past the unit total until every requirement is met', () => {
    const p = program(req('in-progress', [], { children: [missing] }), { totalUnits: { have: 200, credit: 40, planned: 170, inProgress: 50, need: 360 } })
    expect(degreeProgress(result(p), [], unitsOf)).toEqual({
      done: 200,
      credit: 40,
      inProgress: 50,
      planned: 120,
      unitTarget: 360,
      needed: 12,
      requirementUnits: 12,
      unmet: 1,
    })
  })

  it('uses the largest unit total, and the units short of it when that is more', () => {
    const a = program(req('complete', []), { totalUnits: { have: 100, credit: 0, planned: 80, inProgress: 50, need: 360 } })
    const b = program(req('in-progress', [], { children: [missing] }), { totalUnits: { have: 100, credit: 0, planned: 90, inProgress: 50, need: 400 } })
    expect(degreeProgress(result(a, b), [], unitsOf)).toMatchObject({ unitTarget: 400, needed: 210, requirementUnits: 12 })
  })

  it("counts the plan's courses when no program has a unit total", () => {
    const minor = program(req('in-progress', [], { children: [missing] }))
    const courses: PlannedCourse[] = [
      { courseId: '15122', term: 'F25', status: 'completed', units: 12, passFail: false },
      { courseId: '21120', term: null, status: 'credit', units: 10, passFail: true },
      { courseId: '15150', term: 'S27', status: 'planned', units: 12, passFail: false },
    ]
    expect(degreeProgress(result(minor), courses, unitsOf)).toEqual({
      done: 22,
      credit: 10,
      inProgress: 0,
      planned: 12,
      unitTarget: null,
      needed: 12,
      requirementUnits: 12,
      unmet: 1,
    })
  })

  it('has nothing to show without programs', () => {
    expect(degreeProgress(null, [], unitsOf)).toBeNull()
    expect(degreeProgress(result(), [], unitsOf)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { AuditResult, ProgramAuditResult, RequirementResult } from '../../lib/plan-types'
import { degreeProgress, tallyRequirements } from './progress'

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

describe('degreeProgress', () => {
  it('uses the largest unit target, splitting this semester out of planned', () => {
    const a = program(req('in-progress'), { totalUnits: { have: 100, credit: 40, planned: 80, inProgress: 50, need: 360 } })
    const b = program(req('in-progress'), { totalUnits: { have: 100, credit: 40, planned: 90, inProgress: 50, need: 400 } })
    expect(degreeProgress(result(a, b))).toEqual({ basis: 'units', done: 100, credit: 40, inProgress: 50, planned: 40, need: 400 })
  })

  it('falls back to requirements when no program has a unit target', () => {
    const minor = program(req('in-progress', [], { children: [req('complete', ['credit']), req('complete-with-plan', ['planned']), req('missing')] }))
    expect(degreeProgress(result(minor))).toEqual({ basis: 'requirements', done: 1, credit: 0, inProgress: 0, planned: 1, need: 3 })
  })

  it('has nothing to show without programs', () => {
    expect(degreeProgress(null)).toBeNull()
    expect(degreeProgress(result())).toBeNull()
  })
})

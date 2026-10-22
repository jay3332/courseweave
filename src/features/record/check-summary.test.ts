import { describe, expect, it } from 'vitest'
import type { Requisite } from '../../lib/catalog-types'
import { createContext, evaluateRequisite } from '../../lib/requisites'
import { plannedConditions, plannedText } from './check-summary'

const ctx = (credits: Parameters<typeof createContext>[0]['credits']) => createContext({ credits, equivalents: new Map(), overrides: {} })

describe('planned prerequisite wording', () => {
  // 15-251: (15-122 or 15-150) and (15-151 or 21-127 or 21-128), each C or better.
  const req: Requisite = {
    type: 'all',
    items: [
      { type: 'any', items: [{ type: 'course', id: '15122', minGrade: 'C' }, { type: 'course', id: '15150', minGrade: 'C' }] },
      { type: 'any', items: [{ type: 'course', id: '15151', minGrade: 'C' }, { type: 'course', id: '21127', minGrade: 'C' }] },
    ],
  }

  it('names the planned courses, their term and the grade needed', () => {
    const result = evaluateRequisite(
      req,
      ctx([
        { courseId: '15122', timing: 'completed', source: 'taken', grade: 'A', term: 'F25' },
        { courseId: '15151', timing: 'planned', source: 'plan', term: 'F26' },
      ]),
    )
    expect(result.status).toBe('planned')
    const conditions = plannedConditions(result)
    expect(conditions).toEqual([{ courseId: '15151', via: undefined, term: 'F26', minGrade: 'C' }])
    expect(plannedText(conditions)).toBe('Met if you pass 15-151 (C or better, planned for Fall 2026)')
  })

  it('lists only the options a group needs', () => {
    const result = evaluateRequisite(
      req,
      ctx([
        { courseId: '15150', timing: 'planned', source: 'schedule', term: 'F26' },
        { courseId: '15122', timing: 'planned', source: 'plan', term: 'F26' },
        { courseId: '21127', timing: 'planned', source: 'plan', term: 'F26' },
      ]),
    )
    expect(plannedConditions(result).map((c) => c.courseId)).toEqual(['15122', '21127'])
  })
})

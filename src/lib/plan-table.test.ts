import { describe, expect, it } from 'vitest'
import type { AuditResult, RequirementResult } from './plan-types'
import { requirementsByCourse, seasonsLabel, semesterOrdinals } from './plan-table'

const node = (name: string, extra: Partial<RequirementResult> = {}): RequirementResult => ({
  nodeId: Math.random(),
  name,
  state: 'incomplete' as RequirementResult['state'],
  assigned: [],
  notes: [],
  children: [],
  ...extra,
})
const at = (courseId: string, term: string) => ({ courseId, units: 12, term, status: 'planned' as const })

describe('requirementsByCourse', () => {
  const audit: AuditResult = {
    programs: [
      {
        catalogId: 1,
        auditId: 1,
        name: 'BS in Computer Science',
        state: 'incomplete' as RequirementResult['state'],
        root: node('BS in Computer Science', {
          children: [
            node('Computer Science Core', { kind: 'group', children: [node('15-122', { kind: 'course', courseId: '15122', assigned: [at('15122', 'F26')] })] }),
            node('Mathematics', { kind: 'group', children: [node('Math electives', { kind: 'pool', assigned: [at('21242', 'F26')] })] }),
          ],
        }),
      },
      {
        catalogId: 2,
        auditId: 2,
        name: 'SCS General Education',
        state: 'incomplete' as RequirementResult['state'],
        root: node('SCS General Education', { children: [node('Category 1: Cognition', { kind: 'pool', assigned: [at('15122', 'F26')] })] }),
      },
    ],
    unassigned: ['99101'],
  }
  const reqs = requirementsByCourse(audit)

  it('labels course leaves by their parent and pools by their own name, across programs', () => {
    expect(reqs.get('15122', 'F26')).toEqual({
      labels: ['Computer Science Core', 'Category 1: Cognition'],
      paths: ['BS in Computer Science › Computer Science Core › 15-122', 'SCS General Education › Category 1: Cognition'],
    })
    expect(reqs.get('21242', 'F26')?.labels).toEqual(['Math electives'])
  })

  it('knows free electives and returns null for courses the audit has no place for', () => {
    expect(reqs.free.has('99101')).toBe(true)
    expect(reqs.get('15122', 'S27')).toBeNull()
    expect(requirementsByCourse(null).get('15122', 'F26')).toBeNull()
  })
})

describe('seasonsLabel and semesterOrdinals', () => {
  it('names offering seasons like a planning spreadsheet', () => {
    expect(seasonsLabel({ offered: ['fall'] })).toBe('Fall')
    expect(seasonsLabel({ offered: ['spring', 'fall'] })).toBe('Fall and Spring')
    expect(seasonsLabel({ offered: ['fall', 'spring', 'summer'] })).toBe('All semesters')
    expect(seasonsLabel({})).toBeNull()
  })
  it('numbers semesters, counting summers separately', () => {
    expect([...semesterOrdinals(['F26', 'S27', 'M27', 'F27'])]).toEqual([
      ['F26', 'S1'],
      ['S27', 'S2'],
      ['M27', 'Summer 1'],
      ['F27', 'S3'],
    ])
  })
})

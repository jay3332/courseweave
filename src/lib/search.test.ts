import { describe, expect, it } from 'vitest'
import { buildSearchDocs, codeQuery, searchCourses } from './search'
import type { Course } from './types'

const course = (id: string, title: string, instructors: string[] = [], dept = 'CS'): Course => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title,
  units: 12,
  dept,
  level: 'U',
  instructors,
  sections: [],
  crossListed: [],
})

const docs = buildSearchDocs([
  course('15122', 'Principles of Imperative Computation', ['Iliano Cervesato']),
  course('15150', 'Principles of Functional Programming', ['Zeliha Dilsun Kaynar']),
  course('15213', 'Introduction to Computer Systems', ['David Andersen']),
  course('21127', 'Concepts of Mathematics', ['Clive Newstead'], 'MSC'),
  course('76101', 'Interpretation and Argument', [], 'ENG'),
])
const ids = (q: string) => searchCourses(docs, q).map((c) => c.id)

describe('codeQuery', () => {
  it('accepts the common ways of writing a course number', () => {
    expect(codeQuery('15-122')).toBe('15122')
    expect(codeQuery('15122')).toBe('15122')
    expect(codeQuery('15 122')).toBe('15122')
    expect(codeQuery('15-1')).toBe('151')
    expect(codeQuery('15')).toBe('15')
  })
  it('rejects text', () => {
    expect(codeQuery('systems')).toBeNull()
    expect(codeQuery('15-122 lecture')).toBeNull()
  })
})

describe('searchCourses', () => {
  it('finds exact and prefix course numbers', () => {
    expect(ids('15-122')).toEqual(['15122'])
    expect(ids('15-1')).toEqual(['15122', '15150'])
    expect(ids('15')).toEqual(['15122', '15150', '15213'])
  })
  it('matches title words, all tokens required', () => {
    expect(ids('principles')).toEqual(['15122', '15150'])
    expect(ids('principles functional')).toEqual(['15150'])
    expect(ids('comp sys')).toEqual(['15213'])
  })
  it('matches instructors, ignoring accents and case', () => {
    expect(ids('newstead')).toEqual(['21127'])
    expect(ids('CERVESATO')).toEqual(['15122'])
  })
  it('ranks title-prefix matches above mid-title matches', () => {
    expect(ids('computation')[0]).toBe('15122')
  })
  it('returns everything for an empty query', () => {
    expect(ids('  ')).toHaveLength(5)
  })
})

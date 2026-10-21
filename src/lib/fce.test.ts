import { describe, expect, it } from 'vitest'
import { fceByTerm, instructorCourseStats, workloadRatio, workloadTone, type FceRow } from './fce'
import { NameIndex, displayFceName, fceNameKeys, fceTermCode, normalizeFceCourse, sameInstructor, scheduleNameCandidates, termName, termOrder } from './fce-names'

describe('instructor name matching', () => {
  it('keys FCE names on first given name and full last name', () => {
    expect(fceNameKeys('CERVESATO, ILIANO').full).toBe('iliano|cervesato')
    expect(fceNameKeys('LE GOUES, CLAIRE').full).toBe('claire|le goues')
    expect(fceNameKeys('KAYNAR, ZELIHA DILSUN').full).toBe('zeliha|kaynar')
    expect(fceNameKeys('COLE-RHODES, ARLENE').full).toBe('arlene|cole rhodes')
    expect(fceNameKeys('SEVER, S. DUYGU').full).toBe('s|sever')
    expect(fceNameKeys(' SLAUGH,  VINCENT').full).toBe('vincent|slaugh')
  })

  it('tries every first/last split of schedule names', () => {
    expect(scheduleNameCandidates('Claire Le Goues').map((c) => c.full)).toEqual(['claire|goues', 'claire|le goues'])
    expect(scheduleNameCandidates('José Martínez')[0].full).toBe('jose|martinez')
  })

  it('matches across formats, accents, hyphens and middle names', () => {
    const index = new NameIndex<string>()
    for (const n of ['CERVESATO, ILIANO', 'LE GOUES, CLAIRE', 'KAYNAR, ZELIHA DILSUN', 'COLE-RHODES, ARLENE', 'COLLIER, BENJAMIN', 'RAVI, R.', 'SMITH, JANE', 'MARTINEZ, JOSE'])
      index.add(n, n)
    expect(index.get('Iliano Cervesato')).toBe('CERVESATO, ILIANO')
    expect(index.get('Claire Le Goues')).toBe('LE GOUES, CLAIRE')
    expect(index.get('Zeliha Dilsun Kaynar')).toBe('KAYNAR, ZELIHA DILSUN')
    expect(index.get('Arlene Cole-Rhodes')).toBe('COLE-RHODES, ARLENE')
    expect(index.get('Ben Collier')).toBe('COLLIER, BENJAMIN')
    index.add('GARROD, CHARLES', 'GARROD, CHARLES')
    index.add('RANSEY, ELIZABETH', 'RANSEY, ELIZABETH')
    expect(index.get('Charlie Garrod')).toBe('GARROD, CHARLES')
    expect(index.get('Liz Ransey')).toBe('RANSEY, ELIZABETH')
    expect(index.get('R Ravi')).toBe('RAVI, R.')
    expect(index.get('José Martínez')).toBe('MARTINEZ, JOSE')
    // Different person with the same last name.
    expect(index.get('John Smith')).toBeUndefined()
  })

  it('compares one FCE name with one schedule name', () => {
    expect(sameInstructor('CERVESATO, ILIANO', 'Iliano Cervesato')).toBe(true)
    expect(sameInstructor('Epple, Dennis', 'Dennis Epple')).toBe(true)
    expect(sameInstructor('SMITH, JANE', 'John Smith')).toBe(false)
  })

  it('formats FCE names for display', () => {
    expect(displayFceName('CERVESATO, ILIANO')).toBe('Iliano Cervesato')
    expect(displayFceName('ABASCAL, Brooke')).toBe('Brooke Abascal')
    expect(displayFceName('COLE-RHODES, ARLENE')).toBe('Arlene Cole-Rhodes')
  })
})

describe('terms and course numbers', () => {
  it('codes and orders terms', () => {
    expect(fceTermCode(2026, 'Spring')).toBe('S26')
    expect(fceTermCode(2025, 'Summer')).toBe('M25')
    expect(termOrder('F25')).toBeGreaterThan(termOrder('M25'))
    expect(termOrder('S26')).toBeGreaterThan(termOrder('F25'))
    expect(termName('F25')).toBe('Fall 2025')
  })

  it('normalizes FCE course numbers', () => {
    expect(normalizeFceCourse('15122')).toBe('15122')
    expect(normalizeFceCourse('15-451')).toBe('15451')
    expect(normalizeFceCourse('6222')).toBe('06222')
    expect(normalizeFceCourse('FA14-12-100')).toBe('12100')
    expect(normalizeFceCourse('Email Testing')).toBeNull()
  })
})

const row = (term: string, instructor: string, responses: number, hours: number | null, teaching: number | null, courseRate: number | null, section = 'A'): FceRow => ({
  term,
  section,
  instructor,
  enrolled: responses * 2,
  responses,
  hours,
  teachingRate: teaching,
  courseRate,
  questions: [],
})

describe('workload and aggregates', () => {
  it('compares hours with units', () => {
    expect(workloadRatio(12, 12)).toBe(1)
    expect(workloadRatio(null, 12)).toBeNull()
    expect(workloadRatio(9, null)).toBeNull()
    expect(workloadTone(0.6)).toBe('light')
    expect(workloadTone(1.05)).toBe('even')
    expect(workloadTone(1.3)).toBe('heavy')
    expect(workloadTone(2)).toBe('very-heavy')
    expect(workloadTone(null)).toBeNull()
  })

  it('groups rows by term with response weighting, skipping empty responses', () => {
    const rows = [row('S26', 'A, B', 30, 10, 4, 4), row('S26', 'C, D', 10, 14, 3, 3, 'B'), row('S26', 'E, F', 0, null, null, null, 'C'), row('F25', 'A, B', 20, 9, 4.5, 4)]
    const byTerm = fceByTerm(rows)
    expect(byTerm.map((t) => t.term)).toEqual(['S26', 'F25'])
    expect(byTerm[0].hours).toBeCloseTo(11)
    expect(byTerm[0].responses).toBe(40)
  })

  it('computes one instructor’s stats from course rows', () => {
    const rows = [row('S26', 'CERVESATO, ILIANO', 30, 10, 4.4, 4), row('S26', 'KOHLBRENNER, ANNE', 30, 12, 4, 4), row('F25', 'CERVESATO, ILIANO', 10, 8, 4, 3.6)]
    const s = instructorCourseStats(rows, 'Iliano Cervesato')!
    expect(s.terms).toBe(2)
    expect(s.last).toBe('S26')
    expect(s.teachingRate).toBeCloseTo(4.3)
    expect(instructorCourseStats(rows, 'Nobody Here')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { rankConcentrationPrograms, type ConcentrationCandidate } from './concentrations.ts'

const candidate = (name: string, campuses: (string | null)[] = [null], department: string | null = null): ConcentrationCandidate => ({ name, campuses, department })
const top = (concentration: string, parent: { name: string; campus?: string | null; department?: string | null }, candidates: ConcentrationCandidate[]) =>
  rankConcentrationPrograms(concentration, { campus: null, department: null, ...parent }, candidates)[0]?.name

describe('rankConcentrationPrograms', () => {
  const ml = [
    candidate('CMU Africa - Applied Machine Learning Concentration', ['Africa']),
    candidate('Machine Learning SCS Concentration'),
    candidate('StatML Machine Learning Concentration Requirements', [null], 'Statistics'),
    candidate('Machine Learning Advanced Elective', [null], 'Statistics'),
  ]

  it("prefers the major's own concentration over other campuses' and other majors'", () => {
    expect(top('Machine Learning', { name: 'BS in Computer Science', campus: 'Pittsburgh', department: 'Computer Science' }, ml)).toBe(
      'Machine Learning SCS Concentration',
    )
    expect(top('Machine Learning', { name: 'BS in Statistics and Machine Learning', department: 'Statistics' }, ml)).toBe(
      'StatML Machine Learning Concentration Requirements',
    )
  })

  it('matches campuses, treating Kigali and Rwanda as CMU-Africa', () => {
    expect(top('Applied Machine Learning', { name: 'MS in Information Technology', campus: 'Kigali' }, ml)).toBe(
      'CMU Africa - Applied Machine Learning Concentration',
    )
    // Another campus's version is still used when it's the only one.
    expect(top('Information Security', { name: 'BS in Information Systems', campus: 'Pittsburgh' }, [candidate('Information Security Concentration - Qatar', ['Doha'])])).toBe(
      'Information Security Concentration - Qatar',
    )
  })

  it('prefers exact names and ignores version words', () => {
    const analytics = [candidate('Analytics Concentration', [null], 'Social and Decision Sciences'), candidate('Data Analytics Concentration - BS in Information Systems')]
    expect(top('Analytics Concentration', { name: 'BS in Policy and Management', department: 'Engineering and Public Policy' }, analytics)).toBe('Analytics Concentration')
    const econ = [candidate('EY2017 Economics (SHS) - Strategy and Markets Concentration'), candidate('EY2017 Economics - Strategy and Markets Concentration')]
    expect(top('Strategy and Markets', { name: 'BS in Economics' }, econ)).toBe('EY2017 Economics - Strategy and Markets Concentration')
  })
})

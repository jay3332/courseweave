import { describe, expect, it } from 'vitest'
import { reservationCodes, reservationSummary } from './reservations'

describe('reservationSummary', () => {
  it('groups places by class', () => {
    expect(
      reservationSummary([
        'Some reservations are for Students in CIT',
        'Some reservations are for Students in CFA',
        'Some reservations are for Students in DC',
        'Some reservations are for First-Year in SCS',
      ]),
    ).toBe('students in CIT, CFA and DC; first-years in SCS')
  })

  it('handles lines without a group and unexpected wording', () => {
    expect(reservationSummary(['Some reservations are for Students', 'Some reservations are for Students in SCS'])).toBe('students in SCS; other students')
    expect(reservationSummary(['All reservations are for First-Year in M00'])).toBe('first-years in M00')
    expect(reservationSummary(['Some reservations are for Sophomore'])).toBe('sophomores')
    expect(reservationSummary(['Reserved for BXA majors'])).toBe('Reserved for BXA majors')
  })

  it('words other classes and majors naturally', () => {
    expect(reservationSummary(['Some reservations are for Phd Candidates in CS', 'Some reservations are for Students with a primary major in ECE'])).toBe(
      'PhD candidates in CS; students with a primary major in ECE',
    )
    expect(reservationSummary(['Some reservations are for 5th YR Students in ARC'])).toBe('fifth-year students in ARC')
  })

  it('names the codes it knows', () => {
    expect(reservationCodes(['Some reservations are for Students in DC', 'Some reservations are for Students in QBA', 'Some reservations are for First-Year in M00'])).toBe(
      'DC: Dietrich College, M00: MCS, undeclared',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { manualExamEntry, parsePastedCourses, parseUnits, placementEntry, takenEntry, transferEntry, unitsError, type TransferDraft } from './forms'

const transfer = (patch: Partial<TransferDraft>): TransferDraft => ({ general: false, courseId: null, label: '', units: '', institution: '', term: '', ...patch })

describe('parseUnits', () => {
  it('reads whole and decimal units, with dot or comma', () => {
    expect(parseUnits('9')).toBe(9)
    expect(parseUnits(' 4.5 ')).toBe(4.5)
    expect(parseUnits('4,5')).toBe(4.5)
    expect(parseUnits('0')).toBe(0)
  })
  it('treats empty as "use the catalog" and garbage as invalid', () => {
    expect(parseUnits('')).toBeUndefined()
    expect(parseUnits('   ')).toBeUndefined()
    expect(parseUnits('abc')).toBeNull()
    expect(parseUnits('-3')).toBeNull()
    expect(parseUnits('9 units')).toBeNull()
    expect(parseUnits('1e3')).toBeNull()
    expect(unitsError('abc')).toMatch(/number/)
    expect(unitsError('')).toBeNull()
  })
})

describe('transferEntry', () => {
  it('needs a CMU course when there is an equivalent', () => {
    expect(transferEntry(transfer({}))).toBeNull()
    expect(transferEntry(transfer({ courseId: '21122', units: '10' }))).toEqual({ courseId: '21122', source: 'transfer', units: 10 })
  })
  it('lets the units default to the catalog', () => {
    expect(transferEntry(transfer({ courseId: '21122' }))).toEqual({ courseId: '21122', source: 'transfer' })
  })
  it('keeps institution and semester', () => {
    expect(transferEntry(transfer({ courseId: '21122', units: '10', institution: ' Pitt ', term: 'M26' }))).toEqual({
      courseId: '21122',
      source: 'transfer',
      units: 10,
      institution: 'Pitt',
      term: 'M26',
    })
  })
  it('needs a description and units for general credit, and stores no course', () => {
    expect(transferEntry(transfer({ general: true, label: 'Calc III at Pitt' }))).toBeNull()
    expect(transferEntry(transfer({ general: true, units: '9' }))).toBeNull()
    expect(transferEntry(transfer({ general: true, label: ' Calc III ', units: '9', courseId: '21259' }))).toEqual({
      courseId: null,
      source: 'transfer',
      units: 9,
      label: 'Calc III',
    })
  })
  it('blocks invalid units instead of silently dropping them', () => {
    expect(transferEntry(transfer({ courseId: '21122', units: 'ten' }))).toBeNull()
  })
})

describe('takenEntry', () => {
  it('stores units only when they differ from the catalog', () => {
    expect(takenEntry({ courseId: '15122', term: 'F25', grade: 'A', units: '12', catalogUnits: 12 })).toEqual({
      courseId: '15122',
      source: 'taken',
      term: 'F25',
      grade: 'A',
    })
    expect(takenEntry({ courseId: '15192', term: '', grade: '', units: '6', catalogUnits: null })).toEqual({ courseId: '15192', source: 'taken', units: 6 })
  })
  it('rejects missing courses and bad units', () => {
    expect(takenEntry({ courseId: null, term: 'F25', grade: '', units: '', catalogUnits: 12 })).toBeNull()
    expect(takenEntry({ courseId: '15122', term: 'F25', grade: '', units: 'x', catalogUnits: 12 })).toBeNull()
  })
})

describe('manual exam and placement entries', () => {
  it('builds exam credit with an optional name and units', () => {
    expect(manualExamEntry({ courseId: '33141', name: ' Dept review ', units: '12' })).toEqual({ courseId: '33141', source: 'exam', units: 12, note: 'Dept review' })
    expect(manualExamEntry({ courseId: '33141', name: '', units: '' })).toEqual({ courseId: '33141', source: 'exam' })
    expect(manualExamEntry({ courseId: null, name: '', units: '' })).toBeNull()
  })
  it('builds zero-unit placements', () => {
    expect(placementEntry('21120', ' placement exam ')).toEqual({ courseId: '21120', source: 'waiver', units: 0, note: 'placement exam' })
    expect(placementEntry(null, '')).toBeNull()
  })
})

describe('parsePastedCourses', () => {
  it('finds dashed and plain course numbers, once each', () => {
    expect(parsePastedCourses('15-122, 21127\n76-101 15-122')).toEqual(['15122', '21127', '76101'])
  })
  it('ignores longer numbers and dates', () => {
    expect(parsePastedCourses('id 1234567, 2026-10-21')).toEqual([])
  })
})

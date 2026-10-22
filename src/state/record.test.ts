import { beforeEach, describe, expect, it } from 'vitest'
import { buildRequisiteContext } from '../features/record/context'
import { checkCourse } from '../lib/requisites'
import type { CatalogIndex } from '../lib/catalog-types'
import { exportRecord, parseRecordExport, recordTotals, useRecord } from './record'

const units: Record<string, number> = { '15122': 12, '21122': 10, '21120': 10, '15213': 12 }
const unitsOf = (id: string) => units[id]

const catalog: CatalogIndex = {
  generatedAt: '',
  courses: {
    '15213': {
      id: '15213',
      code: '15-213',
      title: 'Introduction to Computer Systems',
      units: 12,
      prereqs: { type: 'course', id: '15122', minGrade: 'C' },
      coreqs: [],
      antireqs: [],
      equivalents: [],
      passFail: false,
    },
    '21259': {
      id: '21259',
      code: '21-259',
      title: 'Calculus in Three Dimensions',
      units: 10,
      prereqs: { type: 'course', id: '21122' },
      coreqs: [],
      antireqs: [],
      equivalents: [],
      passFail: false,
    },
  },
}

beforeEach(() => useRecord.getState().clearRecord())

describe('record store', () => {
  it('adds, updates and removes transfer credit', () => {
    const { addEntry } = useRecord.getState()
    const id = addEntry({ courseId: '21122', source: 'transfer', units: 10, institution: 'Pitt' })
    const general = addEntry({ courseId: null, source: 'transfer', units: 9, label: 'Calc III at Pitt' })
    expect(useRecord.getState().entries.map((e) => e.id)).toEqual([id, general])

    useRecord.getState().updateEntry(id, { term: 'M26' })
    expect(useRecord.getState().entries[0].term).toBe('M26')

    useRecord.getState().removeEntry(general)
    expect(useRecord.getState().entries).toHaveLength(1)
  })

  it('removes every entry from one exam', () => {
    useRecord.getState().addEntries([
      { courseId: '21120', source: 'exam', units: 10, exam: { id: 'ap-calc-bc', score: '5' } },
      { courseId: '21122', source: 'exam', units: 10, exam: { id: 'ap-calc-bc', score: '5' } },
      { courseId: '15122', source: 'taken', term: 'F25', grade: 'A' },
    ])
    useRecord.getState().removeExam('ap-calc-bc')
    expect(useRecord.getState().entries.map((e) => e.courseId)).toEqual(['15122'])
  })

  it('sets and clears overrides', () => {
    useRecord.getState().setOverride('15213', { prereqs: true, coreqs: false })
    expect(useRecord.getState().overrides['15213']).toMatchObject({ prereqs: true })
    expect(useRecord.getState().overrides['15213'].coreqs).toBeUndefined()
    useRecord.getState().setOverride('15213', { prereqs: false })
    expect(useRecord.getState().overrides['15213']).toBeUndefined()
  })
})

describe('recordTotals', () => {
  it('counts transfer and exam credit as earned, non-factorable units', () => {
    const { addEntries } = useRecord.getState()
    addEntries([
      { courseId: '15122', source: 'taken', term: 'F25', grade: 'A' },
      { courseId: '21122', source: 'transfer', institution: 'Pitt' },
      { courseId: null, source: 'transfer', units: 9, label: 'Free elective' },
      { courseId: '21120', source: 'exam', units: 10, exam: { id: 'ap-calc-bc', score: '5' } },
      { courseId: '21120', source: 'waiver', units: 0 },
    ])
    const t = recordTotals(useRecord.getState().entries, unitsOf)
    expect(t.bySource).toEqual({ taken: 12, transfer: 19, exam: 10, waiver: 0 })
    expect(t.earned).toBe(41)
    expect(t.factorable).toBe(12)
    expect(t.nonFactorable).toBe(29)
    expect(t.qpa).toBe(4)
  })
})

describe('import and export', () => {
  it('round-trips transfer credit, including general units with no course', () => {
    const { addEntries } = useRecord.getState()
    addEntries([
      { courseId: '21122', source: 'transfer', units: 10, institution: 'Pitt', term: 'M26' },
      { courseId: null, source: 'transfer', units: 9, label: 'Free elective' },
    ])
    const s = useRecord.getState()
    const parsed = parseRecordExport(JSON.parse(JSON.stringify(exportRecord(s))))
    expect('data' in parsed).toBe(true)
    if (!('data' in parsed)) return
    expect(parsed.data.entries.map((e) => [e.courseId, e.units, e.label ?? null, e.term ?? null])).toEqual([
      ['21122', 10, null, 'M26'],
      [null, 9, 'Free elective', null],
    ])

    useRecord.getState().clearRecord()
    useRecord.getState().importRecord(parsed.data, 'replace')
    expect(useRecord.getState().entries).toHaveLength(2)
    useRecord.getState().importRecord(parsed.data, 'merge')
    expect(useRecord.getState().entries).toHaveLength(2)
  })
})

describe('credit in requisite checks', () => {
  it('lets transfer credit satisfy prerequisites, ignoring minimum grades', () => {
    useRecord.getState().addEntry({ courseId: '15122', source: 'transfer', units: 12 })
    const { entries, overrides, profile } = useRecord.getState()
    const ctx = buildRequisiteContext({ record: { entries, overrides, profile }, catalog, term: 'S27' })
    expect(checkCourse('15213', catalog.courses['15213'], ctx).level).toBe('ok')
  })

  it('counts transfer credit from a later term only from then on', () => {
    useRecord.getState().addEntry({ courseId: '21122', source: 'transfer', units: 10, term: 'M27' })
    const { entries, overrides, profile } = useRecord.getState()
    const before = buildRequisiteContext({ record: { entries, overrides, profile }, catalog, term: 'S27' })
    const after = buildRequisiteContext({ record: { entries, overrides, profile }, catalog, term: 'F27' })
    expect(checkCourse('21259', catalog.courses['21259'], before).level).toBe('problem')
    expect(checkCourse('21259', catalog.courses['21259'], after).level).toBe('ok')
  })

  it('lets exam credit and placements satisfy prerequisites', () => {
    useRecord.getState().addEntries([{ courseId: '21122', source: 'waiver', units: 0 }])
    const { entries, overrides, profile } = useRecord.getState()
    const ctx = buildRequisiteContext({ record: { entries, overrides, profile }, catalog, term: 'S27' })
    expect(checkCourse('21259', catalog.courses['21259'], ctx).level).toBe('ok')
  })
})

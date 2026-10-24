import { describe, expect, it } from 'vitest'
import { planStellicImport, STELLIC_EXAM_NOTE, type StellicImportOptions } from '../features/record/StellicImportPlan'
import type { ProgramsIndex } from './plan-types'
import type { TextPiece } from './sio-record'
import { isStellicPlan, parseStellicPieces } from './stellic-plan'

// Synthetic pages laid out like Stellic's plan PDF (612 × 792, text placed from the top). Not a real student's plan.
const HEIGHT = 792
const at = (top: number, cells: [number, string][], size = 10): TextPiece[] =>
  cells.map(([x, str]) => ({ str, x, y: HEIGHT - top, width: str.length * size * 0.5, size }))
const footer = (top: number, page: string) => at(top, [[10, '10-23-2026, 08:16 pm'], [581, page]], 9)

const page1: TextPiece[] = [
  ...at(51, [[40, 'Name:'], [128, 'Sample Student'], [316, 'Andrew id:'], [404, 'sample']]),
  ...at(66, [[40, 'Level:'], [128, 'Sophomore'], [316, 'Campus:'], [404, 'Pittsburgh']]),
  ...at(81, [[40, 'Programs:'], [128, 'BS in Example Studies'], [316, 'Advisor:'], [404, 'An Advisor']]),
  ...at(92, [[128, 'Minor in a Rather Long Example Program in']]),
  ...at(103, [[128, 'Applied Things']]),
  ...at(118, [[40, 'Taken:'], [128, '2 courses (21 units)']]),
  // A summer activity: no units column.
  ...at(150, [[40, 'Summer 2024']], 12),
  ...at(174, [[45, 'Course or Activity'], [507, 'Status']]),
  ...at(190, [[45, '02-000 Summer Program in Examples'], [507, 'Taken']]),
  // A term with grades.
  ...at(216, [[40, 'Fall 2025 - 21 units attempted, 21 units earned']], 12),
  ...at(240, [[45, 'Course or Activity'], [389, 'Units'], [438, 'Grade'], [507, 'Status']]),
  ...at(256, [[45, '15-122 Principles of Imperative Computation (1, H)'], [389, '12'], [438, 'A'], [507, 'Taken']]),
  ...at(272, [[45, '98-008 Student Taught Courses (StuCo): Intro to Things (A)'], [389, '3'], [438, 'P'], [507, 'Taken']]),
  ...at(288, [[45, '21-127 Concepts of Mathematics'], [389, '10'], [438, 'W'], [507, 'Taken']]),
  ...at(304, [[45, '76-101 Interpretation and Argument (B)'], [389, '9'], [438, '-'], [507, 'Planned']]),
  // A term without grades, whose rows run onto the next page; one title wraps.
  ...at(330, [[40, 'Spring 2027 - 24 units attempted']], 12),
  ...at(354, [[45, 'Course or Activity'], [458, 'Units'], [507, 'Status']]),
  ...at(370, [[45, '15-213 Introduction to Computer Systems'], [458, '12'], [507, 'Planned']]),
  ...at(386, [[45, '10-999 A Very Long Course Title That Goes On and On Until It'], [458, '12'], [507, 'Planned']]),
  ...at(397, [[45, 'Wraps Onto a Second Line']]),
  ...footer(780, '1 of 2'),
]
const page2: TextPiece[] = [
  ...at(42, [[45, '15-251 Great Ideas in Theoretical Computer Science'], [458, '12'], [507, 'Planned']]),
  ...at(70, [[40, 'Transfer Credits - 40 units attempted, 40 units earned']], 12),
  ...at(94, [[45, 'Course'], [458, 'Units'], [507, 'Grade']]),
  ...at(110, [[45, '15-112 Fundamentals of Programming and Computer Science'], [458, '12'], [507, 'AP']]),
  ...at(126, [[45, '79-012 AP US HISTORY'], [458, '9'], [507, 'AP']]),
  ...at(142, [[45, '03-011 AP BIOLOGY'], [458, '9'], [507, 'TR']]),
  ...at(158, [[45, '73-102 Principles of Microeconomics'], [458, '10'], [507, 'TR']]),
  ...footer(780, '2 of 2'),
]

describe('parseStellicPieces', () => {
  const plan = parseStellicPieces([page1, page2])

  it('reads programs (joining wrapped lines), campus and level, and nothing personal', () => {
    expect(plan.programs).toEqual(['BS in Example Studies', 'Minor in a Rather Long Example Program in Applied Things'])
    expect(plan.campus).toBe('Pittsburgh')
    expect(plan.level).toBe('undergraduate')
    expect(JSON.stringify(plan)).not.toMatch(/Sample Student|An Advisor|"sample"/)
  })

  it('reads terms, units, grades, statuses and sections', () => {
    expect(plan.terms.map((t) => t.term)).toEqual(['M24', 'F25', 'S27'])
    const fall = plan.terms[1].rows
    expect(fall[0]).toEqual({ courseId: '15122', title: 'Principles of Imperative Computation', sections: ['1', 'H'], units: 12, grade: 'A', status: 'Taken' })
    expect(fall[1]).toMatchObject({ courseId: '98008', title: 'Student Taught Courses (StuCo): Intro to Things', sections: ['A'], grade: 'P' })
    expect(fall[3]).toEqual({ courseId: '76101', title: 'Interpretation and Argument', sections: ['B'], units: 9, status: 'Planned' })
    expect(plan.terms[0].rows[0]).toMatchObject({ courseId: '02000', units: null, status: 'Taken' })
  })

  it('joins wrapped titles and follows a term onto the next page, skipping footers', () => {
    const spring = plan.terms[2].rows
    expect(spring.map((r) => r.courseId)).toEqual(['15213', '10999', '15251'])
    expect(spring[1].title).toBe('A Very Long Course Title That Goes On and On Until It Wraps Onto a Second Line')
    expect(plan.skipped).toEqual([])
  })

  it('reads transfer credits', () => {
    expect(plan.credits.map((r) => [r.courseId, r.units, r.grade, r.status])).toEqual([
      ['15112', 12, 'AP', null],
      ['79012', 9, 'AP', null],
      ['03011', 9, 'TR', null],
      ['73102', 10, 'TR', null],
    ])
  })

  it('tells a Stellic plan from other PDFs', () => {
    expect(isStellicPlan([page1])).toBe(true)
    expect(isStellicPlan([at(40, [[40, 'Sample Student :: Unofficial Academic Record as of 21 Oct 2026']])])).toBe(false)
    expect(() => parseStellicPieces([[]])).toThrow(/no readable text/)
  })
})

describe('planStellicImport', () => {
  const pdf = parseStellicPieces([page1, page2])
  const catalog: Record<string, number | null> = { '02000': null, '15122': 12, '98008': 3, '21127': 10, '76101': 9, '15213': 12, '15251': 12, '15112': 12, '73102': 9 }
  const programs: ProgramsIndex = {
    generatedAt: '',
    programs: [
      {
        catalogId: 1,
        name: 'BS in Example Studies',
        kind: 'major',
        versions: [
          { auditId: 11, name: 'EY2026 Pittsburgh', entryYear: 2026, campus: 'Pittsburgh' },
          { auditId: 10, name: 'EY2025 Pittsburgh', entryYear: 2025, campus: 'Pittsburgh' },
        ],
      },
      { catalogId: 2, name: 'BS in Example Studies', kind: 'major', versions: [{ auditId: 20, name: 'EY2025 Doha', entryYear: 2025, campus: 'Doha' }] },
    ],
  }
  const opts: StellicImportOptions = {
    knows: (id) => id in catalog,
    catalogUnits: (id) => catalog[id],
    programs,
    existingPlanNames: ['Plan 1', 'Stellic plan'],
    currentTerm: 'F26',
    profile: {},
  }
  const result = planStellicImport(pdf, [], opts)

  it('drafts a plan from the first fall or spring, with the default semesters and every term that has courses', () => {
    const d = result.draft
    expect(d.name).toBe('Stellic plan 2')
    expect(d.startTerm).toBe('F25')
    expect(d.terms.map((t) => t.term)).toEqual(['F25', 'S26', 'F26', 'S27', 'F27', 'S28', 'F28', 'S29'])
    // The withdrawn course and the summer activity stay out; units are kept only where they differ from the catalog.
    expect(d.terms[0].courses).toEqual([{ courseId: '15122' }, { courseId: '98008' }, { courseId: '76101' }])
    expect(d.terms[3].courses).toEqual([{ courseId: '15213' }, { courseId: '10999', units: 12 }, { courseId: '15251' }])
    expect(d.courseCount).toBe(6)
    expect(result.skipped).toEqual(['02-000 Summer Program in Examples (Summer 2024): not a course'])
  })

  it('matches programs by name, preferring the PDF campus and the entry-year version', () => {
    expect(result.draft.programs).toEqual([{ catalogId: 1, auditId: 10 }])
    expect(result.draft.programNames).toEqual([
      { name: 'BS in Example Studies', found: true },
      { name: 'Minor in a Rather Long Example Program in Applied Things', found: false },
    ])
  })

  it('offers credit and taken courses for the record', () => {
    const byKey = Object.fromEntries(result.groups.map((g) => [g.key, g.items.map((i) => i.entry)]))
    expect(byKey.exam).toEqual([
      { courseId: '15112', source: 'exam', units: 12, note: STELLIC_EXAM_NOTE },
      { courseId: '79012', source: 'exam', units: 9, note: STELLIC_EXAM_NOTE, label: 'AP US HISTORY' },
      { courseId: '03011', source: 'exam', units: 9, note: STELLIC_EXAM_NOTE, label: 'AP BIOLOGY' },
    ])
    expect(byKey.transfer).toEqual([{ courseId: '73102', source: 'transfer', units: 10 }])
    expect(byKey['term:F25']).toEqual([
      { courseId: '15122', source: 'taken', term: 'F25', units: 12, grade: 'A' },
      { courseId: '98008', source: 'taken', term: 'F25', units: 3, grade: 'P' },
      { courseId: '21127', source: 'taken', term: 'F25', units: 10, grade: 'W' },
    ])
    expect(result.groups.some((g) => g.key === 'term:M24' || g.key === 'term:S27')).toBe(false)
    expect(result.profile).toEqual({ entryTerm: 'F25' })
  })

  it('marks what the record already has, whichever kind of credit it was recorded as', () => {
    const again = planStellicImport(
      pdf,
      [
        { id: 'a', courseId: '15112', source: 'transfer', addedAt: 0 },
        { id: 'b', courseId: '15122', source: 'taken', term: 'F25', grade: 'A', addedAt: 0 },
      ],
      { ...opts, profile: { entryTerm: 'F25' } },
    )
    const items = again.groups.flatMap((g) => g.items)
    expect(items.filter((i) => i.already).map((i) => i.entry.courseId)).toEqual(['15112', '15122'])
    expect(again.profile).toEqual({})
  })
})

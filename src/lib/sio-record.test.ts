import { describe, expect, it } from 'vitest'
import { planSioImport, SIO_EXAM_NOTE } from '../features/record/SioImportPlan'
import type { RecordEntry } from '../state/record'
import { NotSioRecordError, pageLines, parseCourseRow, parseSioLines, parseSioPieces, termCode, titleCase, type TextPiece } from './sio-record'

// A made-up student; the layout mirrors SIO's unofficial academic record PDF.
const PAGE_1 = [
  'Jane Doe :: Unofficial Academic Record as of 3 Feb 2027',
  'Name: Doe, Jane',
  'College: Mellon College of Science',
  'Department: Mathematical Sciences',
  'Major: Mathematical Sciences',
  '=============================================',
  'Beginning of Undergraduate Record',
  'Advanced Placement / Transfer Credits',
  'ADVANCED PLACEMENT CREDIT',
  'DPT CRS # COURSE TITLE UNITS FINAL',
  'GRADE',
  'CS 15112 FNDMTLS OF PGMG & CS 12.0 AD',
  'MSC 21120 DIFFERENTIAL INT CAL 10.0 AD',
  '82012 AP SPANISH: LANG 9.0 AD',
  'TRANSFER CREDIT FROM EXAMPLE COMMUNITY COLLEGE',
  'MSC 21241 MATRICES & LIN TRANS 11.0 TR',
  'TOTAL AP / TRANSFER CREDIT 42.0',
  'Carnegie Mellon University :: Unofficial Academic Record issued by the University Registrar\'s Office Page 1 of 2',
]
const PAGE_2 = [
  'Jane Doe :: Unofficial Academic Record as of 3 Feb 2027',
  '2025 / 2026',
  'Fall 2025',
  'DPT CRS # COURSE TITLE UNITS FINAL QUALITY',
  'GRADE POINTS',
  'MSC 21127 CONCEPTS OF MATH 12.0 B 36.0',
  'CS 15122 PRIN IMPERATIVE COMP 12.0 A 48.0',
  'PE 69103 YOGA: LEVEL 1 3.0 P 0.0',
  'Semester 27.0 24.0 3.50 84.0',
  'Cumulative 69.0 24.0 3.50 84.0',
  'Spring 2026',
  'ENG 76101 INTERPRETATION & ARG 9.0 W 0.0',
  'MSC 21259 CALCULUS IN 3-D 10.0 0.0',
  'Summer One 2026',
  'STU 98242 STUCO: 3D PRINTING 101 3.0 0.0',
  '=============================================',
  'End of Undergraduate Record',
]

describe('parseCourseRow', () => {
  it('reads rows with and without department, grade and quality points', () => {
    expect(parseCourseRow('CS 15122 PRIN IMPERATIVE COMP 12.0 A 48.0')).toEqual({ courseId: '15122', title: 'PRIN IMPERATIVE COMP', units: 12, grade: 'A', dept: 'CS' })
    expect(parseCourseRow('82012 AP SPANISH: LANG 9.0 AD')).toEqual({ courseId: '82012', title: 'AP SPANISH: LANG', units: 9, grade: 'AD' })
    expect(parseCourseRow('MSC 21259 CALCULUS IN 3-D 10.0 0.0')).toEqual({ courseId: '21259', title: 'CALCULUS IN 3-D', units: 10, dept: 'MSC' })
    // Titles can end in numbers.
    expect(parseCourseRow('STU 98242 STUCO: 3D PRINTING 101 3.0 0.0')).toMatchObject({ title: 'STUCO: 3D PRINTING 101', units: 3 })
    expect(parseCourseRow('ENG 76106 WRTNG ABT LIT/ART 4.5 A 18.0')).toMatchObject({ units: 4.5, grade: 'A' })
    expect(parseCourseRow('Semester 27.0 24.0 3.50 84.0')).toBeNull()
  })
})

describe('termCode and titleCase', () => {
  it('maps term headings to app codes', () => {
    expect(termCode('Fall 2025')).toBe('F25')
    expect(termCode('Spring 2026')).toBe('S26')
    expect(termCode('Summer One 2026')).toBe('M26')
    expect(termCode('Summer 2026')).toBe('M26')
    expect(termCode('2025 / 2026')).toBeNull()
  })
  it('title-cases institutions', () => {
    expect(titleCase('UNIVERSITY OF THE EXAMPLE STATE')).toBe('University of the Example State')
  })
})

describe('parseSioLines', () => {
  const r = parseSioLines([PAGE_1, PAGE_2])

  it('reads the profile', () => {
    expect(r.asOf).toBe('3 Feb 2027')
    expect(r.profile).toMatchObject({ name: 'Doe, Jane', college: 'Mellon College of Science', collegeCode: 'MCS', major: 'Mathematical Sciences', level: 'undergraduate' })
  })

  it('splits exam credit, transfer credit and terms', () => {
    expect(r.exam.map((x) => x.courseId)).toEqual(['15112', '21120', '82012'])
    expect(r.transfer).toEqual([{ institution: 'Example Community College', rows: [{ courseId: '21241', title: 'MATRICES & LIN TRANS', units: 11, grade: 'TR', dept: 'MSC' }] }])
    expect(r.terms.map((t) => [t.term, t.rows.map((x) => `${x.courseId}:${x.grade ?? '-'}`)])).toEqual([
      ['F25', ['21127:B', '15122:A', '69103:P']],
      ['S26', ['76101:W', '21259:-']],
      ['M26', ['98242:-']],
    ])
    expect(r.warnings).toEqual([])
  })

  it('rejects other documents', () => {
    expect(() => parseSioLines([['Some other PDF', 'CS 15122 PRIN IMPERATIVE COMP 12.0 A 48.0']])).toThrow(NotSioRecordError)
    expect(() => parseSioLines([[]])).toThrow(/no readable text/)
  })

  it('reports rows it could not read', () => {
    const bad = parseSioLines([[...PAGE_2.slice(0, 3), 'CS 15122 PRIN IMPERATIVE COMP twelve A']])
    expect(bad.warnings).toEqual(['CS 15122 PRIN IMPERATIVE COMP twelve A'])
  })
})

describe('pageLines', () => {
  const piece = (str: string, x: number, y: number, size = 10): TextPiece => ({ str, x, y, width: str.length * size * 0.5, size })

  it('groups by line, orders by x, and drops the FERPA sidebar', () => {
    const pieces = [
      piece('NOTE', 500, 700),
      piece('Fall 2025', 40, 700),
      piece('As required by the', 500, 680),
      piece('CS', 40, 680),
      piece('15122', 80, 680.6),
      piece('PRIN IMPERATIVE COMP', 120, 680),
      piece('12.0', 330, 680),
      piece('A', 380, 680),
      piece('48.0', 430, 680),
    ]
    expect(pageLines(pieces)).toEqual(['Fall 2025', 'CS 15122 PRIN IMPERATIVE COMP 12.0 A 48.0'])
  })

  it('parses straight from pieces', () => {
    const pieces = [
      piece('Jane Doe :: Unofficial Academic Record as of 3 Feb 2027', 40, 760),
      piece('Spring 2026', 40, 700),
      piece('MSC', 40, 680),
      piece('21259', 80, 680),
      piece('CALCULUS IN 3-D', 120, 680),
      piece('10.0', 330, 680),
      piece('0.0', 430, 680),
    ]
    expect(parseSioPieces([pieces]).terms[0]).toMatchObject({ term: 'S26', rows: [{ courseId: '21259', units: 10 }] })
  })
})

describe('planSioImport', () => {
  const record = parseSioLines([PAGE_1, PAGE_2])
  const existing: RecordEntry[] = [
    { id: 'a', courseId: '21120', source: 'exam', units: 10, exam: { id: 'ap-calc-bc', score: '5' }, addedAt: 0 },
    { id: 'b', courseId: '15122', source: 'taken', term: 'F25', grade: 'A', addedAt: 0 },
  ]
  const plan = planSioImport(record, existing, { knows: (id) => id !== '82012', currentTerm: 'S26', profile: {} })
  const items = plan.groups.flatMap((g) => g.items)
  const item = (id: string) => items.find((i) => i.row.courseId === id)!

  it('builds entries per source', () => {
    expect(item('15112').entry).toEqual({ courseId: '15112', source: 'exam', units: 12, note: SIO_EXAM_NOTE })
    // Unknown AP elective numbers keep the PDF title as a label.
    expect(item('82012').entry).toMatchObject({ source: 'exam', label: 'AP SPANISH: LANG' })
    expect(item('21241').entry).toEqual({ courseId: '21241', source: 'transfer', units: 11, institution: 'Example Community College' })
    expect(item('21127').entry).toEqual({ courseId: '21127', source: 'taken', term: 'F25', units: 12, grade: 'B' })
  })

  it('marks what is already recorded and what is in progress', () => {
    expect(item('21120').already).toBe(true)
    expect(item('15122').already).toBe(true)
    expect(item('21127').already).toBe(false)
    expect(item('21259').status).toBe('in-progress')
    expect(item('76101').status).toBe('graded')
  })

  it('orders groups and suggests profile values', () => {
    expect(plan.groups.map((g) => g.key)).toEqual(['exam', 'transfer:0', 'term:F25', 'term:S26', 'term:M26'])
    expect(plan.profile).toEqual({ college: 'MCS', entryTerm: 'F25' })
    expect(planSioImport(record, [], { knows: () => true, currentTerm: 'S26', profile: { college: 'MCS', entryTerm: 'F25' } }).profile).toEqual({})
  })
})

// Records vary: sections can be missing, repeated, split across pages, or use headings this parser hasn't seen.
// Each case below is a made-up record shaped like a real SIO PDF.
describe('parseSioLines: layout variations', () => {
  const header = (asOf = '1 Mar 2027') => [`Alex Roe :: Unofficial Academic Record as of ${asOf}`, 'Name: Roe, Alex', 'College: College of Engineering']
  const ids = (rows: { courseId: string }[]) => rows.map((r) => r.courseId)

  it('reads a record with no AP or transfer credit at all', () => {
    const r = parseSioLines([[...header(), '2025 / 2026', 'Fall 2025', 'ECE 18100 INTRO TO ECE 12.0 A 48.0', 'Semester 12.0 12.0 4.00 48.0']])
    expect(r.exam).toEqual([])
    expect(r.transfer).toEqual([])
    expect(r.terms.map((t) => [t.term, ids(t.rows)])).toEqual([['F25', ['18100']]])
    expect(r.warnings).toEqual([])
  })

  it('reads transfer credit only, from several institutions', () => {
    const r = parseSioLines([
      [
        ...header(),
        'Advanced Placement / Transfer Credits',
        'TRANSFER CREDIT FROM FIRST STATE COLLEGE',
        'MSC 21120 DIFF & INT CALCULUS 10.0 TR',
        'TRANSFER CREDIT FROM UNIVERSITY OF SOMEWHERE',
        'ECO 73102 PRIN MICROECONOMICS 9.0 TR',
        'TOTAL AP / TRANSFER CREDIT 19.0',
      ],
    ])
    expect(r.exam).toEqual([])
    expect(r.transfer.map((g) => [g.institution, ids(g.rows)])).toEqual([
      ['First State College', ['21120']],
      ['University of Somewhere', ['73102']],
    ])
  })

  it('reads IB and other exam credit headings, and rows before any sub-heading', () => {
    const r = parseSioLines([
      [
        ...header(),
        'Advanced Placement / Transfer Credits',
        'CMY 09105 INTRO MOD CHEMSTRY I 10.0 AD',
        'INTERNATIONAL BACCALAUREATE CREDIT',
        'PHY 33141 PHY I ENG 12.0 AD',
        'OTHER CREDIT',
        '82101 ELEM FRENCH I 12.0 AD',
        'TOTAL AP / TRANSFER CREDIT 34.0',
        'Fall 2026',
        'CS 15122 PRIN IMPERATIVE COMP 12.0 0.0',
      ],
    ])
    expect(ids(r.exam)).toEqual(['09105', '33141', '82101'])
    expect(r.terms.map((t) => [t.term, ids(t.rows)])).toEqual([['F26', ['15122']]])
  })

  it('keeps reading a term that continues onto the next page', () => {
    const r = parseSioLines([
      [...header(), '2025 / 2026', 'Spring 2026', 'MSC 21241 MATRICES & LIN TRANS 11.0 B+ 36.3', 'Page 1 of 2'],
      [
        'Alex Roe :: Unofficial Academic Record as of 1 Mar 2027',
        '2025 / 2026',
        'Spring 2026 (continued)',
        'DPT CRS # COURSE TITLE UNITS FINAL QUALITY',
        'S3D 17313 FNDTNS SOFTWARE ENG 12.0 A- 44.4',
        'H00 65101 HUMANITIES SCHOLAR 9.0 A 36.0',
        'Semester 32.0 32.0 3.68 116.7',
        'Page 2 of 2',
      ],
    ])
    expect(r.terms).toHaveLength(1)
    expect(r.terms[0].rows.map((x) => [x.courseId, x.dept, x.grade])).toEqual([
      ['21241', 'MSC', 'B+'],
      ['17313', 'S3D', 'A-'],
      ['65101', 'H00', 'A'],
    ])
  })

  it('reads graduate and undergraduate records, summers and many years', () => {
    const r = parseSioLines([
      [
        ...header(),
        'Beginning of Undergraduate Record',
        '2023 / 2024',
        'Fall 2023',
        'CS 15112 FNDMTLS OF PGMG & CS 12.0 A 48.0',
        'Summer Two 2024',
        'MSC 21122 INTEGRTN & APPROX 10.0 P 0.0',
        '2024 / 2025',
        'Spring 2025',
        'ENG 76101 INTERPRETATION & ARG 9.0 W 0.0',
        'End of Undergraduate Record',
        'Beginning of Graduate Record',
        'Fall 2026',
        'CS 15640 DISTRIBUTED SYSTEMS 12.0 0.0',
        'End of Graduate Record',
      ],
    ])
    expect(r.profile.level).toBe('undergraduate')
    expect(r.terms.map((t) => t.term)).toEqual(['F23', 'M24', 'S25', 'F26'])
    expect(r.terms.find((t) => t.term === 'S25')!.rows[0].grade).toBe('W')
    expect(r.terms.find((t) => t.term === 'F26')!.rows[0].grade).toBeUndefined()
  })

  it('tolerates dashed course numbers, large units, markers and stray notes', () => {
    const r = parseSioLines([
      [
        ...header(),
        'Fall 2026',
        "Dean's List",
        'CS 15-213 INTR CMPUTER SYSTEMS 12.0 A 48.0 *',
        'CS 15400 RESEARCH PRACTICUM 100.0 P 0.0',
        'Bachelor of Science in Electrical and Computer Engineering conferred',
        'Academic Action: Good Standing',
      ],
    ])
    expect(r.terms[0].rows.map((x) => [x.courseId, x.units, x.grade])).toEqual([
      ['15213', 12, 'A'],
      ['15400', 100, 'P'],
    ])
    expect(r.warnings).toEqual([])
  })

  it('returns an empty record (not an error) when an SIO record has no courses yet', () => {
    const r = parseSioLines([[...header(), 'Beginning of Undergraduate Record', 'End of Undergraduate Record']])
    expect([r.exam, r.transfer, r.terms]).toEqual([[], [], []])
    expect(r.profile.college).toBe('College of Engineering')
  })

  it('maps continued and session term headings', () => {
    expect(termCode('Fall 2026 (continued)')).toBe('F26')
    expect(termCode('Spring 2027 - cont.')).toBe('S27')
    expect(termCode('Summer Session I 2027')).toBe('M27')
    expect(termCode('Fall Semester')).toBeNull()
  })
})

describe('pageLines: layout variations', () => {
  const at = (str: string, x: number, y: number, size = 10): TextPiece => ({ str, x, y, width: str.length * size * 0.5, size })

  it('works on pages without the FERPA sidebar and joins split pieces', () => {
    const lines = pageLines([at('CS', 40, 700), at('151', 80, 700), at('22', 95, 700), at('PRIN IMPERATIVE COMP', 140, 700.4), at('12.0', 380, 699.7)])
    expect(lines).toEqual(['CS 15122 PRIN IMPERATIVE COMP 12.0'])
  })
})

// CMU credit for AP, IB and Cambridge/EdExcel A-Level exams.
//
// Transcribed from the University Registrar's official charts, each "Updated 16 March 2026":
//   AP:        https://www.cmu.edu/hub/registrar/docs/ap-credit.pdf
//   IB (HL):   https://www.cmu.edu/hub/registrar/docs/ib-credit.pdf
//   A-Level:   https://www.cmu.edu/hub/registrar/docs/cambridge-credit.pdf
// Linked from https://www.cmu.edu/hub/registrar/registration/ap-transfer-credit.html
//
// Every row below appears in those charts; exams and scores not listed receive no credit.
// Exam credit is recorded with the non-factorable grade AD: it earns units but never counts toward QPA
// (University Grading Policy, https://www.cmu.edu/policies/student-and-student-life/grading.html).

export type ExamBoard = 'AP' | 'IB' | 'A-Level'

export interface ExamCourse {
  /** Five-digit CMU course id. */
  courseId: string
  title: string
  units: number
}

export interface ExamAward {
  /** Scores (AP 1–5, IB 1–7) or grades (A-Level A/B) this award applies to. */
  scores: string[]
  courses: ExamCourse[]
  /** Only students in these colleges (see COLLEGES in state/record.ts) receive it. */
  colleges?: string[]
  /** Placement out of the course without credit (counts for prerequisites only). */
  waiverOnly?: boolean
  /** No credit when the student also has credit from this exam. */
  unlessExam?: string
  note?: string
}

export interface Exam {
  id: string
  board: ExamBoard
  name: string
  /** Scores offered in the picker, best first. */
  scores: string[]
  awards: ExamAward[]
  note?: string
}

export const EXAM_SOURCES: Record<ExamBoard, { url: string; updated: string; policy: string }> = {
  AP: {
    url: 'https://www.cmu.edu/hub/registrar/docs/ap-credit.pdf',
    updated: '2026-03-16',
    policy: 'Credit for scores of 4 or 5 where listed; exams and scores not listed receive no credit.',
  },
  IB: {
    url: 'https://www.cmu.edu/hub/registrar/docs/ib-credit.pdf',
    updated: '2026-03-16',
    policy: 'Credit only for Higher Level (HL) exams.',
  },
  'A-Level': {
    url: 'https://www.cmu.edu/hub/registrar/docs/cambridge-credit.pdf',
    updated: '2026-03-16',
    policy: 'A-Level/H2/H3 may be eligible upon department review. No credit for AS, AICE, O-Level, H1 or GCSE.',
  },
}

const c = (courseId: string, title: string, units: number): ExamCourse => ({ courseId, title, units })

const AP_SCORES = ['5', '4', '3', '2', '1']
const IB_SCORES = ['7', '6', '5', '4', '3', '2', '1']
const AL_GRADES = ['A*', 'A', 'B', 'C', 'D', 'E']

const CFA_NOTE = "Can't replace College of Fine Arts major or minor requirements."
const BIO_NOTE = 'You can take an attainment exam during Orientation; passing it earns 03-121 instead.'
const ENGLISH_NOTE = 'You still take 76-101, or two of the half-semester minis 76-106, 76-107 and 76-108.'
const LANG_NOTE = 'To keep studying the language, take the placement exam and contact Languages, Cultures & Applied Linguistics.'

const CALC_120 = c('21120', 'Differential and Integral Calculus', 10)
const CALC_122 = c('21122', 'Integration, Differential Equations and Approximation', 10)

/** Exams with a lower-score and higher-score course, the common language pattern. */
function tiered(
  board: ExamBoard,
  id: string,
  name: string,
  low: [string, ExamCourse],
  high: [string, ExamCourse],
  note?: string,
): Exam {
  return {
    id,
    board,
    name,
    scores: board === 'AP' ? AP_SCORES : board === 'IB' ? IB_SCORES : AL_GRADES,
    awards: [
      { scores: [low[0]], courses: [low[1]] },
      { scores: [high[0]], courses: [high[1]] },
    ],
    note,
  }
}

function single(board: ExamBoard, id: string, name: string, scores: string[], course: ExamCourse, note?: string): Exam {
  return {
    id,
    board,
    name,
    scores: board === 'AP' ? AP_SCORES : board === 'IB' ? IB_SCORES : AL_GRADES,
    awards: [{ scores, courses: [course] }],
    note,
  }
}

const AP: Exam[] = [
  single('AP', 'ap-2d-art', '2-D Art and Design', ['4', '5'], c('51011', 'AP 2-D Art and Design', 9), CFA_NOTE),
  single('AP', 'ap-3d-art', '3-D Art and Design', ['4', '5'], c('51012', 'AP 3-D Art and Design', 9), CFA_NOTE),
  single('AP', 'ap-african-american-studies', 'African American Studies', ['5'], c('79017', 'AP African American Studies', 9)),
  single('AP', 'ap-art-history', 'Art History', ['5'], c('60011', 'AP Art History', 9), CFA_NOTE),
  tiered('AP', 'ap-biology', 'Biology', ['4', c('03011', 'AP Biology', 9)], ['5', c('03110', 'AP Biology', 9)], BIO_NOTE),
  {
    id: 'ap-calculus-ab',
    board: 'AP',
    name: 'Calculus AB (or the AB subscore)',
    scores: AP_SCORES,
    awards: [
      {
        scores: ['4'],
        courses: [c('21111', 'Calculus', 10)],
        colleges: ['DC', 'CFA', 'BHA'],
        note: 'Only for Dietrich College, CFA, Information Systems and Bachelor of Humanities and Arts students.',
      },
      { scores: ['5'], courses: [CALC_120] },
    ],
    note: 'Use this row for the AB subscore on the BC exam too.',
  },
  {
    id: 'ap-calculus-bc',
    board: 'AP',
    name: 'Calculus BC',
    scores: AP_SCORES,
    awards: [{ scores: ['5'], courses: [CALC_120, CALC_122] }],
    note: 'Below a 5, add your AB subscore under Calculus AB instead.',
  },
  {
    id: 'ap-capstone',
    board: 'AP',
    name: 'Capstone (Seminar + Research)',
    scores: ['Seminar 5, Research 5', 'Seminar 4, Research 5'],
    awards: [
      { scores: ['Seminar 4, Research 5'], courses: [c('99005', 'AP Capstone Senior Research Project', 9)] },
      {
        scores: ['Seminar 5, Research 5'],
        courses: [c('99004', 'AP Capstone Junior Seminar', 9), c('99005', 'AP Capstone Senior Research Project', 9)],
      },
    ],
  },
  single('AP', 'ap-chemistry', 'Chemistry', ['5'], c('09105', 'Introduction to Modern Chemistry I', 10)),
  tiered('AP', 'ap-chinese', 'Chinese Language & Culture', ['4', c('82011', 'AP Chinese', 12)], ['5', c('82012', 'AP Chinese', 12)], LANG_NOTE),
  {
    id: 'ap-cs-a',
    board: 'AP',
    name: 'Computer Science A',
    scores: AP_SCORES,
    awards: [
      { scores: ['4'], courses: [c('15110', 'Principles of Computing', 10)] },
      { scores: ['5'], courses: [c('15112', 'Fundamentals of Programming', 12)] },
    ],
  },
  {
    id: 'ap-cs-principles',
    board: 'AP',
    name: 'Computer Science Principles',
    scores: AP_SCORES,
    awards: [
      {
        scores: ['4', '5'],
        courses: [c('15110', 'Principles of Computing', 10)],
        unlessExam: 'ap-cs-a',
        note: 'Only if Computer Science A earned no credit.',
      },
    ],
  },
  single('AP', 'ap-drawing', 'Drawing', ['4', '5'], c('60012', 'AP Drawing', 9), CFA_NOTE),
  single('AP', 'ap-microeconomics', 'Economics: Micro', ['4', '5'], c('73011', 'AP Economics', 9), 'Enroll in 73-104 next.'),
  single('AP', 'ap-macroeconomics', 'Economics: Macro', ['4', '5'], c('73012', 'AP Economics-Macro', 9)),
  single('AP', 'ap-english-language', 'English Language and Composition', ['4', '5'], c('76011', 'AP English', 9), ENGLISH_NOTE),
  single('AP', 'ap-english-literature', 'English Literature and Composition', ['5'], c('76012', 'AP English Lit & Comp', 9), ENGLISH_NOTE),
  single('AP', 'ap-environmental-science', 'Environmental Science', ['4', '5'], c('38012', 'AP Environmental Science', 9)),
  single('AP', 'ap-european-history', 'European History', ['5'], c('79011', 'AP European History', 9)),
  tiered('AP', 'ap-french', 'French Language & Culture', ['4', c('82013', 'AP French', 9)], ['5', c('82014', 'AP French', 9)], LANG_NOTE),
  tiered('AP', 'ap-german', 'German Language & Culture', ['4', c('82015', 'AP German', 9)], ['5', c('82016', 'AP German', 9)], LANG_NOTE),
  single('AP', 'ap-gov-comparative', 'Government & Politics: Comparative', ['4', '5'], c('84011', 'AP Government & Politics: Comparative', 9)),
  single('AP', 'ap-gov-us', 'Government & Politics: US', ['4', '5'], c('84012', 'AP Government & Politics: US', 9)),
  single('AP', 'ap-human-geography', 'Human Geography', ['4', '5'], c('66011', 'AP Human Geography', 9)),
  tiered('AP', 'ap-italian', 'Italian Language & Culture', ['4', c('82017', 'AP Italian', 9)], ['5', c('82018', 'AP Italian', 9)], LANG_NOTE),
  tiered('AP', 'ap-japanese', 'Japanese Language & Culture', ['4', c('82019', 'AP Japanese', 12)], ['5', c('82020', 'AP Japanese', 12)], LANG_NOTE),
  {
    id: 'ap-latin',
    board: 'AP',
    name: 'Latin',
    scores: AP_SCORES,
    awards: [
      { scores: ['4'], courses: [c('66019', 'AP Latin', 9)] },
      { scores: ['5'], courses: [c('66019', 'AP Latin', 9), c('66020', 'AP 5 Latin', 9)] },
    ],
  },
  single('AP', 'ap-music-theory', 'Music Theory', ['4', '5'], c('57012', 'AP Music Theory', 9), CFA_NOTE),
  single('AP', 'ap-physics-c-em', 'Physics C: Electricity and Magnetism', ['5'], c('33142', 'Physics II for Engineering Students', 12)),
  single('AP', 'ap-physics-c-mech', 'Physics C: Mechanics', ['5'], c('33141', 'Physics I for Engineering Students', 12)),
  single('AP', 'ap-psychology', 'Psychology', ['4', '5'], c('85011', 'AP Psychology', 9)),
  single('AP', 'ap-anthropology', 'Social & Cultural Anthropology', ['4', '5'], c('79016', 'AP Anthropology', 9)),
  tiered('AP', 'ap-spanish-language', 'Spanish Language', ['4', c('82021', 'AP Spanish', 9)], ['5', c('82022', 'AP Spanish', 9)], LANG_NOTE),
  tiered('AP', 'ap-spanish-literature', 'Spanish Literature & Culture', ['4', c('82023', 'AP Spanish', 9)], ['5', c('82024', 'AP Spanish', 9)], LANG_NOTE),
  {
    id: 'ap-spanish-both',
    board: 'AP',
    name: 'Spanish Language and Spanish Literature (both)',
    scores: ['Both 5'],
    awards: [
      {
        scores: ['Both 5'],
        courses: [c('82022', 'AP Spanish Language', 9), c('82341', 'AP Spanish Literature & Culture', 9)],
        note: 'The chart lists 9 units for this pair without a per-course split; confirm the units with the registrar. Use instead of the two single rows.',
      },
    ],
  },
  single(
    'AP',
    'ap-statistics',
    'Statistics',
    ['5'],
    c('36200', 'Reasoning with Data', 9),
    'For Tepper students, this also fulfills 70-207, Probability and Statistics for Business Applications.',
  ),
  single('AP', 'ap-us-history', 'United States History', ['5'], c('79012', 'AP United States History', 9)),
  single('AP', 'ap-world-history', 'World History: Modern', ['5'], c('79015', 'AP World History: Modern', 9)),
]

const IB: Exam[] = [
  tiered('IB', 'ib-biology', 'Biology HL', ['6', c('03011', 'AP Biology', 9)], ['7', c('03110', 'General Biology', 9)], BIO_NOTE),
  single('IB', 'ib-chemistry', 'Chemistry HL', ['7'], c('09105', 'Introduction to Modern Chemistry I', 10)),
  tiered('IB', 'ib-chinese', 'Chinese A or B HL', ['6', c('82025', 'IB Chinese', 12)], ['7', c('82026', 'IB Chinese', 12)], LANG_NOTE),
  {
    id: 'ib-greek',
    board: 'IB',
    name: 'Classical Languages: Ancient Greek HL',
    scores: IB_SCORES,
    awards: [
      { scores: ['6'], courses: [c('66021', 'IB Classical Languages: Greek', 9)] },
      { scores: ['7'], courses: [c('66021', 'IB Classical Languages: Greek', 9), c('66022', 'IB Classical Languages: Greek', 9)] },
    ],
  },
  {
    id: 'ib-latin',
    board: 'IB',
    name: 'Classical Languages: Latin HL',
    scores: IB_SCORES,
    awards: [
      { scores: ['6'], courses: [c('66023', 'IB Classical Languages: Latin', 9)] },
      { scores: ['7'], courses: [c('66023', 'IB Classical Languages: Latin', 9), c('66024', 'IB Classical Languages: Latin', 9)] },
    ],
  },
  single('IB', 'ib-computer-science', 'Computer Science HL', ['6', '7'], c('15112', 'Fundamentals of Programming', 12), 'Subsumes 15-110.'),
  single('IB', 'ib-design-technology', 'Design Technology HL', ['6', '7'], c('51013', 'IB Design Technology', 9)),
  single('IB', 'ib-economics', 'Economics HL', ['6', '7'], c('73011', 'AP Economics', 9), 'Take 73-104 next.'),
  single('IB', 'ib-english-lang-lit', 'English A: Language and Literature HL', ['7'], c('76013', 'IB English A Language & Lit', 9), ENGLISH_NOTE),
  single('IB', 'ib-english-literature', 'English A: Literature HL', ['7'], c('76014', 'IB English A Literature', 9), ENGLISH_NOTE),
  single('IB', 'ib-film', 'Film HL', ['7'], c('76017', 'IB Film', 9)),
  tiered('IB', 'ib-french', 'French A or B HL', ['6', c('82027', 'IB French A', 9)], ['7', c('82028', 'IB French A', 9)], LANG_NOTE),
  single('IB', 'ib-geography', 'Geography HL', ['6', '7'], c('66012', 'IB Geography', 9)),
  tiered('IB', 'ib-german', 'German HL', ['6', c('82029', 'IB German', 9)], ['7', c('82030', 'IB German', 9)], LANG_NOTE),
  single('IB', 'ib-global-politics', 'Global Politics HL', ['7'], c('84013', 'IB Global Politics', 9)),
  single('IB', 'ib-history', 'History HL', ['7'], c('79014', 'IB History', 9)),
  single('IB', 'ib-itgs', 'Information Technology in a Global Society HL', ['7'], c('67011', 'IB Information Technology in a Global Society', 9)),
  single('IB', 'ib-islamic-history', 'Islamic History HL', ['7'], c('79013', 'IB Islamic History', 9)),
  tiered('IB', 'ib-italian', 'Italian A or B HL', ['6', c('82031', 'IB Italian', 9)], ['7', c('82032', 'IB Italian', 9)], LANG_NOTE),
  tiered('IB', 'ib-japanese', 'Japanese HL', ['6', c('82033', 'IB Japanese', 12)], ['7', c('82034', 'IB Japanese', 12)], LANG_NOTE),
  {
    id: 'ib-mathematics',
    board: 'IB',
    name: 'Mathematics HL',
    scores: IB_SCORES,
    awards: [
      { scores: ['6'], courses: [CALC_120] },
      { scores: ['7'], courses: [CALC_120, CALC_122] },
    ],
  },
  single('IB', 'ib-music', 'Music HL', ['6', '7'], c('57013', 'IB Music', 9), "Can't count as a School of Music theory course."),
  single('IB', 'ib-philosophy', 'Philosophy HL', ['6', '7'], c('80011', 'IB Philosophy', 9)),
  single('IB', 'ib-physics', 'Physics HL', ['7'], c('33141', 'Physics I for Engineering Students', 12)),
  single('IB', 'ib-psychology', 'Psychology HL', ['6', '7'], c('85012', 'IB Psychology', 9)),
  tiered('IB', 'ib-russian', 'Russian A or B HL', ['6', c('82035', 'IB Russian', 12)], ['7', c('82036', 'IB Russian', 12)], LANG_NOTE),
  single('IB', 'ib-anthropology', 'Social & Cultural Anthropology HL', ['6', '7'], c('79016', 'IB Anthropology', 9)),
  tiered('IB', 'ib-spanish', 'Spanish A or B HL', ['6', c('82037', 'IB Spanish', 9)], ['7', c('82038', 'IB Spanish', 9)], LANG_NOTE),
]

const ALEVEL: Exam[] = [
  single('A-Level', 'al-accounting', 'Accounting', ['A*', 'A', 'B'], c('70122', 'Introduction to Accounting', 9)),
  tiered('A-Level', 'al-arabic', 'Arabic', ['B', c('82039', 'CMBR Arabic', 12)], ['A', c('82040', 'CMBR Arabic', 12)], LANG_NOTE),
  tiered('A-Level', 'al-biology', 'Biology / Advanced Biology (9Bi07)', ['B', c('03011', 'AP Biology', 9)], ['A', c('03110', 'General Biology', 9)], BIO_NOTE),
  single('A-Level', 'al-chemistry', 'Chemistry / Advanced Chemistry (9Ch07)', ['A*', 'A'], c('09105', 'Introduction to Modern Chemistry I', 10)),
  tiered('A-Level', 'al-chinese', 'Chinese', ['B', c('82041', 'CMBR Chinese', 12)], ['A', c('82042', 'CMBR Chinese', 12)], LANG_NOTE),
  single('A-Level', 'al-classical-studies', 'Classical Studies', ['A*', 'A', 'B'], c('66013', 'CMBR Classical Studies', 9)),
  single('A-Level', 'al-computer-science', 'Computer Science', ['A*', 'A'], c('15112', 'Fundamentals of Programming', 12), 'Subsumes 15-110.'),
  single('A-Level', 'al-divinity', 'Divinity', ['A*', 'A', 'B'], c('66014', 'CMBR Divinity', 9)),
  single('A-Level', 'al-economics', 'Economics', ['A*', 'A'], c('73011', 'AP Economics', 9), 'Take 73-104 next.'),
  single('A-Level', 'al-english-language', 'English: Language', ['A*', 'A'], c('76015', 'CMBR English Language', 9), ENGLISH_NOTE),
  single('A-Level', 'al-english-literature', 'English: Literature', ['A*', 'A'], c('76016', 'CMBR English Literature', 9), ENGLISH_NOTE),
  tiered('A-Level', 'al-french', 'French', ['B', c('82043', 'CMBR French', 9)], ['A', c('82044', 'CMBR French', 9)], LANG_NOTE),
  single('A-Level', 'al-geography', 'Geography', ['A*', 'A', 'B'], c('66015', 'CMBR Geography', 9)),
  tiered('A-Level', 'al-german', 'German', ['B', c('82045', 'CMBR German', 9)], ['A', c('82046', 'CMBR German', 9)], LANG_NOTE),
  single('A-Level', 'al-hinduism', 'Hinduism', ['A*', 'A', 'B'], c('66016', 'CMBR Hinduism', 9)),
  single('A-Level', 'al-islamic-studies', 'Islamic Studies', ['A*', 'A', 'B'], c('66017', 'CMBR Islamic Studies', 9)),
  tiered('A-Level', 'al-japanese', 'Japanese', ['B', c('82047', 'CMBR Japanese', 12)], ['A', c('82048', 'CMBR Japanese', 12)], LANG_NOTE),
  single('A-Level', 'al-law', 'Law', ['A*', 'A', 'B'], c('66018', 'CMBR Law', 9)),
  {
    id: 'al-mathematics',
    board: 'A-Level',
    name: 'Mathematics (9371, 9758, 9709)',
    scores: AL_GRADES,
    awards: [
      { scores: ['B'], courses: [CALC_120] },
      { scores: ['A*', 'A'], courses: [CALC_120, CALC_122] },
    ],
  },
  {
    id: 'al-further-mathematics',
    board: 'A-Level',
    name: 'Further Mathematics',
    scores: AL_GRADES,
    awards: [
      {
        scores: ['A*', 'A'],
        courses: [c('36225', 'Introduction to Probability and Statistics I', 9)],
        waiverOnly: true,
        note: 'Places you out of 36-225 without credit. Passing 36-226 later earns 9 units for 36-225.',
      },
    ],
  },
  {
    id: 'al-physics',
    board: 'A-Level',
    name: 'Physics / Advanced Physics (9Ph07)',
    scores: AL_GRADES,
    awards: [
      {
        scores: ['A*', 'A', 'B'],
        courses: [c('33141', 'Physics I for Engineering Students', 12), c('33142', 'Physics II for Engineering Students', 12)],
      },
    ],
  },
  single('A-Level', 'al-sociology', 'Sociology', ['A*', 'A', 'B'], c('88011', 'CMBR Sociology', 9)),
  tiered('A-Level', 'al-spanish', 'Spanish', ['B', c('82049', 'CMBR Spanish', 9)], ['A', c('82050', 'CMBR Spanish', 9)], LANG_NOTE),
]

// The charts list grade "A" for A-Level; A* is treated as A. Tiered rows above take "A" only, so add A*.
for (const exam of ALEVEL) for (const award of exam.awards) if (award.scores.includes('A') && !award.scores.includes('A*')) award.scores.unshift('A*')

export const EXAMS: Exam[] = [...AP, ...IB, ...ALEVEL]

const BY_ID = new Map(EXAMS.map((e) => [e.id, e]))

export function examById(id: string): Exam | undefined {
  return BY_ID.get(id)
}

export function examLabel(exam: Exam): string {
  return `${exam.board} ${exam.name}`
}

export interface AwardResult {
  /** The matching award row, or null when the score earns nothing. */
  award: ExamAward | null
  /** False when the row is limited to colleges that don't include the student's. */
  eligible: boolean
  /** Why it isn't granted, or other caveats to show. */
  notes: string[]
}

/**
 * What an exam score earns. `college` is the student's college code; when unknown, college-limited
 * rows count as eligible with a note so the student can decide.
 * `otherExams` are the student's other exam ids (for "only if no credit from X" rows).
 */
export function awardFor(exam: Exam, score: string, college?: string, otherExams: string[] = []): AwardResult {
  const award = exam.awards.find((a) => a.scores.includes(score)) ?? null
  const notes: string[] = []
  if (exam.note) notes.push(exam.note)
  if (!award) return { award: null, eligible: false, notes: [`No CMU credit for a ${score} on this exam.`, ...notes] }
  if (award.note) notes.push(award.note)
  let eligible = true
  if (award.colleges && college && !award.colleges.includes(college)) {
    eligible = false
    notes.unshift('Not available to students in your college.')
  }
  if (award.unlessExam && otherExams.includes(award.unlessExam)) {
    eligible = false
    notes.unshift(`No credit because you already have credit from ${examById(award.unlessExam)?.name ?? 'another exam'}.`)
  }
  return { award, eligible, notes }
}

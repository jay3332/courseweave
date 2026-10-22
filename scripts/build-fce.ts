// Builds FCE (Faculty Course Evaluation) data from the ScottyLabs SmartEvals export (<scottylabs>/data/fces.csv).
//
// Output (public/data/fce/, gitignored: FCE results are CMU-internal, so keep them local):
//   summary.json            per-course recent averages, for list views, sorting and the hours-vs-units chart
//   courses/<NN>.json       full per-section history for course numbers starting with NN
//   instructors.json        per-instructor teaching history
//
// "Recent" = the course's last RECENT_TERMS terms with at least one response. Averages are weighted by
// responses. Rows with no responses are kept in the history but never averaged.
//
// Hours: the FCE question is "On average, how many hours per week have you spent on this class, including
// attending classes, doing readings, reviewing notes, writing papers and any other course related work?",
// so it's directly comparable to units (1 unit ≈ 1 hour of work a week over a full semester). It wasn't collected
// before 2014. Minis run for half a semester, so their in-session hours compare with 2 × units.
//
// Minis are detected from FCE section names (fall A1/B2, spring A3/B4, summer A5/B6). Each history row carries
// its mini number; the summary carries the share of recent sections that were minis and which half they ran in.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NameIndex, displayFceName, fceNameKeys, fceSectionMini, fceTermCode, miniHalf, normalizeFceCourse, termOrder, type FceSeason } from '../src/lib/fce-names.ts'
import type { TermData } from '../src/lib/types.ts'
import { publicDataDir, readCsvRecords, scottylabsDir, updateRefreshRecord } from './lib/common.ts'

export const RECENT_TERMS = 4

const QUESTIONS = [
  'Interest in student learning',
  'Clearly explain course requirements',
  'Clear learning objectives & goals',
  'Instructor provides feedback to students to improve',
  'Demonstrate importance of subject matter',
  'Explains subject matter of course',
  'Show respect for all students',
]

interface Row {
  course: string
  term: string
  order: number
  section: string
  /** Mini number from the section name, or null for full-semester sections. */
  mini: number | null
  instructor: string
  enrolled: number
  responses: number
  hours: number | null
  teaching: number | null
  courseRate: number | null
  questions: (number | null)[]
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const round = (n: number | null, digits = 2) => (n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits)

/** Response-weighted mean of `pick` over rows that have it. */
function weighted<T>(items: T[], pick: (x: T) => number | null, weight: (x: T) => number): number | null {
  let sum = 0
  let w = 0
  for (const x of items) {
    const v = pick(x)
    const wt = weight(x)
    if (v === null || wt <= 0) continue
    sum += v * wt
    w += wt
  }
  return w ? sum / w : null
}

const csvPath = join(scottylabsDir(), 'data', 'fces.csv')
const outDir = join(publicDataDir, 'fce')

if (!existsSync(csvPath)) {
  console.warn(`fce: ${csvPath} not found; skipping (set SCOTTYLABS_DIR to the ScottyLabs courses checkout)`)
  process.exit(0)
}

const rows: Row[] = []
let dropped = 0
for (const r of readCsvRecords(csvPath)) {
  const course = normalizeFceCourse(r['Num'] ?? '')
  const year = Number(r['Year'])
  const sem = r['Sem'] as FceSeason
  if (!course || !year || !['Spring', 'Summer', 'Fall'].includes(sem)) {
    dropped++
    continue
  }
  const term = fceTermCode(year, sem)
  rows.push({
    course,
    term,
    order: termOrder(term),
    section: r['Section'] ?? '',
    mini: fceSectionMini(r['Section'] ?? '', sem),
    instructor: (r['Instructor'] ?? '').replace(/\s+/g, ' ').trim(),
    enrolled: num(r['Total # Students']) ?? 0,
    responses: num(r['# Responses']) ?? 0,
    hours: num(r['Hrs Per Week']),
    teaching: num(r['Overall teaching rate']),
    courseRate: num(r['Overall course rate']),
    questions: QUESTIONS.map((q) => num(r[q])),
  })
}

// ---- Per course ----

interface Section {
  term: string
  order: number
  mini: number | null
  responses: number
  enrolled: number
  hours: number | null
  courseRate: number | null
}

/** Co-taught sections have one row per instructor; course-level questions are averaged once per section. */
function sectionsOf(courseRows: Row[]): Section[] {
  const groups = new Map<string, Row[]>()
  for (const r of courseRows) {
    const key = `${r.term}|${r.section}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()].map((g) => ({
    term: g[0].term,
    order: g[0].order,
    mini: g[0].mini,
    responses: Math.max(...g.map((r) => r.responses)),
    enrolled: Math.max(...g.map((r) => r.enrolled)),
    hours: weighted(g, (r) => r.hours, (r) => r.responses),
    courseRate: weighted(g, (r) => r.courseRate, (r) => r.responses),
  }))
}

const byCourse = new Map<string, Row[]>()
for (const r of rows) byCourse.set(r.course, [...(byCourse.get(r.course) ?? []), r])

/**
 * [hours, courseRate, teachingRate, responses, recentTerms, totalTerms, lastTerm, hoursDelta, enrolledPerTerm,
 *  miniShare (0–1, recent sections that were minis), miniHalf (0 none, 1 first half, 2 second half, 3 both)]
 */
type SummaryTuple = [number | null, number | null, number | null, number, number, number, string, number | null, number | null, number, number]
const summary: Record<string, SummaryTuple> = {}
const chunks = new Map<string, Record<string, unknown[]>>()

for (const [course, courseRows] of byCourse) {
  courseRows.sort((a, b) => b.order - a.order || a.section.localeCompare(b.section) || a.instructor.localeCompare(b.instructor))

  const chunk = chunks.get(course.slice(0, 2)) ?? {}
  chunk[course] = courseRows.map((r) => [
    r.term,
    r.section,
    r.instructor,
    r.enrolled,
    r.responses,
    r.hours,
    r.teaching,
    r.courseRate,
    r.questions,
    r.mini,
  ])
  chunks.set(course.slice(0, 2), chunk)

  const answered = courseRows.filter((r) => r.responses > 0)
  const terms = [...new Set(answered.map((r) => r.term))].sort((a, b) => termOrder(b) - termOrder(a))
  if (!terms.length) continue
  const recent = new Set(terms.slice(0, RECENT_TERMS))
  const previous = new Set(terms.slice(RECENT_TERMS, RECENT_TERMS * 2))
  const sections = sectionsOf(answered)
  const recentSections = sections.filter((s) => recent.has(s.term))
  const recentRows = answered.filter((r) => recent.has(r.term))
  const hours = weighted(recentSections, (s) => s.hours, (s) => s.responses)
  const prevHours = weighted(
    sections.filter((s) => previous.has(s.term)),
    (s) => s.hours,
    (s) => s.responses,
  )
  const enrolledPerTerm = recentSections.reduce((n, s) => n + s.enrolled, 0) / recent.size
  const recentMinis = recentSections.filter((s) => s.mini !== null)
  const halves = new Set(recentMinis.map((s) => miniHalf(s.mini!)))
  const halfCode = halves.size === 2 ? 3 : halves.has('first') ? 1 : halves.has('second') ? 2 : 0

  summary[course] = [
    round(hours, 1),
    round(weighted(recentSections, (s) => s.courseRate, (s) => s.responses)),
    round(weighted(recentRows, (r) => r.teaching, (r) => r.responses)),
    recentSections.reduce((n, s) => n + s.responses, 0),
    recent.size,
    terms.length,
    terms[0],
    hours !== null && prevHours !== null ? round(hours - prevHours, 1) : null,
    Math.round(enrolledPerTerm),
    Math.round((recentMinis.length / recentSections.length) * 100) / 100,
    halfCode,
  ]
}

// ---- Per instructor ----

interface InstructorOut {
  name: string
  /** courseId → [terms, responses, teachingRate, courseRate, hours, lastTerm, firstTerm] */
  courses: Record<string, [number, number, number | null, number | null, number | null, string, string]>
  /** [term, teachingRate, responses] oldest first */
  terms: [string, number | null, number][]
}

const byInstructor = new Map<string, Row[]>()
const nameVariants = new Map<string, Map<string, number>>()
for (const r of rows) {
  if (!r.instructor) continue
  const key = fceNameKeys(r.instructor).full
  byInstructor.set(key, [...(byInstructor.get(key) ?? []), r])
  const variants = nameVariants.get(key) ?? new Map()
  variants.set(r.instructor, (variants.get(r.instructor) ?? 0) + 1)
  nameVariants.set(key, variants)
}

const instructors: Record<string, InstructorOut> = {}
for (const [key, list] of byInstructor) {
  // Prefer a mixed-case spelling ("ABASCAL, Brooke") when one exists; otherwise the most common.
  const variants = [...nameVariants.get(key)!.entries()].sort((a, b) => Number(/[a-z]/.test(b[0])) - Number(/[a-z]/.test(a[0])) || b[1] - a[1])
  const out: InstructorOut = { name: displayFceName(variants[0][0]), courses: {}, terms: [] }

  const courses = new Map<string, Row[]>()
  for (const r of list) courses.set(r.course, [...(courses.get(r.course) ?? []), r])
  for (const [course, cr] of courses) {
    const answered = cr.filter((r) => r.responses > 0)
    const termsTaught = [...new Set(cr.map((r) => r.term))].sort((a, b) => termOrder(a) - termOrder(b))
    out.courses[course] = [
      termsTaught.length,
      answered.reduce((n, r) => n + r.responses, 0),
      round(weighted(answered, (r) => r.teaching, (r) => r.responses)),
      round(weighted(answered, (r) => r.courseRate, (r) => r.responses)),
      round(weighted(answered, (r) => r.hours, (r) => r.responses), 1),
      termsTaught.at(-1)!,
      termsTaught[0],
    ]
  }

  const terms = new Map<string, Row[]>()
  for (const r of list) if (r.responses > 0) terms.set(r.term, [...(terms.get(r.term) ?? []), r])
  out.terms = [...terms.entries()]
    .sort((a, b) => termOrder(a[0]) - termOrder(b[0]))
    .map(([term, tr]) => [term, round(weighted(tr, (r) => r.teaching, (r) => r.responses)), tr.reduce((n, r) => n + r.responses, 0)])
  instructors[key] = out
}

// ---- Write ----

const latest = rows.reduce((best, r) => (r.order > best.order ? r : best), rows[0])
mkdirSync(outDir, { recursive: true })
rmSync(join(outDir, 'courses'), { recursive: true, force: true })
mkdirSync(join(outDir, 'courses'), { recursive: true })
const generatedAt = new Date().toISOString()
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ generatedAt, latest: latest.term, recentTerms: RECENT_TERMS, courses: summary }))
for (const [prefix, chunk] of chunks) writeFileSync(join(outDir, 'courses', `${prefix}.json`), JSON.stringify(chunk))
writeFileSync(join(outDir, 'instructors.json'), JSON.stringify({ generatedAt, instructors }))

const earliest = rows.reduce((best, r) => (r.order < best.order ? r : best), rows[0])
const miniCourses = Object.values(summary).filter((t) => t[9] >= 0.5).length
console.log(
  `fce: ${miniCourses} courses mostly taught as minis, ${rows.filter((r) => r.mini !== null).length} mini rows`,
)
console.log(
  `fce: ${rows.length} rows (${dropped} unparseable), ${earliest.term}–${latest.term}, ${Object.keys(summary).length} courses with responses, ${Object.keys(instructors).length} instructors`,
)

// Record which upstream export this build used, so the weekly data check can tell when ScottyLabs publishes a newer one.
try {
  const [commit, date] = execFileSync('git', ['-C', scottylabsDir(), 'log', '-1', '--format=%H %cI', '--', 'data/fces.csv'], { encoding: 'utf8' }).trim().split(' ')
  if (commit && date) updateRefreshRecord((r) => void (r.fce = { upstreamCommit: commit, upstreamDate: date }))
} catch {
  // Not a git checkout (e.g. a copied CSV): nothing to record.
}

// ---- Diagnostics: how many instructors in built terms have FCE history ----

const index = new NameIndex<string>()
for (const r of rows) if (r.instructor) index.add(r.instructor, r.instructor)
for (const file of existsSync(publicDataDir) ? readdirSync(publicDataDir) : []) {
  if (!/^[SMF]\d\d\.json$/.test(file)) continue
  const data = JSON.parse(readFileSync(join(publicDataDir, file), 'utf8')) as TermData
  const names = new Set(data.courses.flatMap((c) => c.instructors))
  if (!names.size) continue
  const matched = [...names].filter((n) => index.get(n) !== undefined).length
  const covered = data.courses.filter((c) => summary[c.id]).length
  console.log(
    `fce: ${data.term.id}: ${matched}/${names.size} instructors matched (${((matched / names.size) * 100).toFixed(1)}%), ${covered}/${data.courses.length} courses have FCEs`,
  )
}

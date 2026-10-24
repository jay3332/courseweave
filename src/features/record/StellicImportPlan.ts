// Turns a parsed Stellic plan PDF into a new degree plan and importable record items (credit and taken courses).
import { academicYearStart, compareTerms, defaultTerms, isSummer, nextTerm } from '../../lib/plan'
import type { ProgramInfo, ProgramSelection, ProgramsIndex } from '../../lib/plan-types'
import { defaultVersion } from '../../lib/programs'
import { earnsCredit, normalizeGrade, termLabel } from '../../lib/requisites'
import type { SioCourseRow } from '../../lib/sio-record'
import type { StellicPlan, StellicRow } from '../../lib/stellic-plan'
import type { RecordEntry } from '../../state/record'
import type { ImportGroup, ImportItem, ImportPlan } from './SioImportPlan'

/** Groups exam credit from a Stellic plan together in the AP / IB section of the record page. */
export const STELLIC_EXAM_NOTE = 'Advanced placement credit from your Stellic plan'

export interface DegreePlanDraft {
  name: string
  startTerm: string
  /** Every semester the new plan gets, oldest first: the default eight plus any with courses. */
  terms: { term: string; courses: { courseId: string; units?: number }[] }[]
  programs: ProgramSelection[]
  /** Stellic's program names, and whether each was found here. */
  programNames: { name: string; found: boolean }[]
  courseCount: number
}

export interface StellicImport extends ImportPlan {
  draft: DegreePlanDraft
  /** Rows left out: activities and lines that couldn't be read. */
  skipped: string[]
}

export interface StellicImportOptions {
  /** Whether the catalog or term data knows this course. */
  knows(courseId: string): boolean
  /** The catalog's units for a course (the minimum for variable-unit courses); null or undefined when unknown. */
  catalogUnits(courseId: string): number | null | undefined
  programs: ProgramsIndex | null
  existingPlanNames: string[]
  /** The routed term; used for the first semester when the PDF has no fall or spring courses. */
  currentTerm: string
  profile: { entryTerm?: string }
}

const EXAM = /^(?:AP|IB|AL|A-?LEVEL|EXAM|CLEP)$/i
const isExam = (r: StellicRow) => EXAM.test(r.grade ?? '') || /^(?:AP|IB)\s/.test(r.title)
const isTaken = (r: StellicRow) => /^(?:taken|completed)$/i.test(r.status ?? '')

/** "PLAN" → "PLAN", taken → "PLAN 2", … */
function uniqueName(base: string, taken: string[]): string {
  const names = new Set(taken)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Stellic program name → this app's program and version, preferring the PDF's campus. */
export function matchProgram(name: string, index: ProgramsIndex | null, entryYear: number, campus: string | null): ProgramSelection | null {
  if (!index) return null
  const wanted = norm(name)
  const matches = index.programs.filter((p) => norm(p.name) === wanted && p.versions.length)
  if (!matches.length) return null
  const local = (p: ProgramInfo) => p.versions.some((v) => (v.campus ?? 'Pittsburgh') === (campus ?? 'Pittsburgh'))
  const program = matches.find(local) ?? matches[0]
  const version = defaultVersion(program, entryYear, campus ?? undefined)
  return version ? { catalogId: program.catalogId, auditId: version.auditId } : null
}

export function planStellicImport(pdf: StellicPlan, existing: RecordEntry[], opts: StellicImportOptions): StellicImport {
  const skipped = [...pdf.skipped]
  const label = (r: StellicRow) => (opts.knows(r.courseId) ? {} : { label: r.title })
  const units = (r: StellicRow) => r.units ?? opts.catalogUnits(r.courseId) ?? 0
  const asRow = (r: StellicRow): SioCourseRow => ({ courseId: r.courseId, title: r.title, units: units(r), ...(r.grade ? { grade: r.grade } : {}) })
  // Activities (pre-college programs and the like) are listed without units; every course has them.
  const isActivity = (r: StellicRow) => r.units === null

  // ---- The degree plan
  const byTerm = new Map<string, { courseId: string; units?: number }[]>()
  for (const t of pdf.terms) {
    for (const r of t.rows) {
      if (isActivity(r)) {
        skipped.push(`${r.courseId.slice(0, 2)}-${r.courseId.slice(2)} ${r.title} (${termLabel(t.term)}): not a course`)
        continue
      }
      // Withdrawn and failed courses stay on the record only.
      if (!earnsCredit(normalizeGrade(r.grade))) continue
      const list = byTerm.get(t.term) ?? []
      if (list.some((c) => c.courseId === r.courseId)) continue
      list.push({ courseId: r.courseId, ...(r.units !== null && r.units !== opts.catalogUnits(r.courseId) ? { units: r.units } : {}) })
      byTerm.set(t.term, list)
    }
  }
  const withCourses = [...byTerm.keys()].sort(compareTerms)
  const firstRegular = withCourses.find((t) => !isSummer(t))
  const entry = opts.profile.entryTerm?.toUpperCase()
  const startTerm = firstRegular ?? (entry && !isSummer(entry) ? entry : null) ?? (withCourses[0] ? nextTerm(withCourses[0]) : academicYearStart(opts.currentTerm))
  const terms = [...new Set([...defaultTerms(startTerm), ...withCourses])].sort(compareTerms)
  const entryYear = 2000 + Number(academicYearStart(startTerm).slice(1))
  const programNames = pdf.programs.map((name) => ({ name, selection: matchProgram(name, opts.programs, entryYear, pdf.campus) }))
  const draft: DegreePlanDraft = {
    name: uniqueName('Stellic plan', opts.existingPlanNames),
    startTerm,
    terms: terms.map((term) => ({ term, courses: byTerm.get(term) ?? [] })),
    programs: programNames.flatMap((p) => (p.selection ? [p.selection] : [])).filter((p, i, all) => all.findIndex((q) => q.catalogId === p.catalogId) === i),
    programNames: programNames.map((p) => ({ name: p.name, found: p.selection !== null })),
    courseCount: [...byTerm.values()].reduce((n, l) => n + l.length, 0),
  }

  // ---- Record items: credit, and courses marked taken
  const groups: ImportGroup[] = []
  const credited = (courseId: string) => existing.some((e) => (e.source === 'exam' || e.source === 'transfer') && e.courseId === courseId)
  const exam = pdf.credits.filter(isExam)
  const transfer = pdf.credits.filter((r) => !isExam(r))
  if (exam.length) {
    groups.push({
      key: 'exam',
      title: 'AP and exam credit',
      items: exam.map((r, i) => ({
        key: `exam:${i}`,
        row: asRow(r),
        entry: { courseId: r.courseId, source: 'exam', units: units(r), note: STELLIC_EXAM_NOTE, ...label(r) },
        status: 'credit',
        already: credited(r.courseId),
      })),
    })
  }
  if (transfer.length) {
    groups.push({
      key: 'transfer',
      title: 'Transfer credit',
      items: transfer.map((r, i) => ({
        key: `transfer:${i}`,
        row: asRow(r),
        entry: { courseId: r.courseId, source: 'transfer', units: units(r), ...label(r) },
        status: 'credit',
        already: credited(r.courseId),
      })),
    })
  }
  for (const t of [...pdf.terms].sort((a, b) => compareTerms(a.term, b.term))) {
    const items: ImportItem[] = t.rows
      .filter((r) => isTaken(r) && !isActivity(r))
      .map((r, i) => {
        const grade = normalizeGrade(r.grade)
        return {
          key: `term:${t.term}:${i}`,
          row: asRow(r),
          entry: { courseId: r.courseId, source: 'taken', term: t.term, units: units(r), ...(grade ? { grade } : {}), ...label(r) },
          status: grade ? 'graded' : 'no-grade',
          already: existing.some((e) => e.source === 'taken' && e.courseId === r.courseId && (e.term ?? '').toUpperCase() === t.term),
        }
      })
    if (items.length) groups.push({ key: `term:${t.term}`, title: termLabel(t.term), items })
  }

  const profile: ImportPlan['profile'] = {}
  if (firstRegular && firstRegular !== entry) profile.entryTerm = firstRegular

  return { groups, profile, draft, skipped }
}

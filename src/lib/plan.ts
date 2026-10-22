// Degree plan model and pure helpers: term arithmetic, merging the record into plan columns,
// building the audit input, per-term totals, requisite checks with plan timing, and course placement.
// The persisted store lives in src/state/plan.ts; the UI in src/features/degree.

import type { CatalogIndex } from './catalog-types'
import { fceMiniOf, isMostlyMini, splitHalves, type FceMiniInfo, type LoadItem } from './fce-minis'
import type { AuditInput, PlannedCourse, ProgramSelection } from './plan-types'
import {
  buildEquivalence,
  checkCourse,
  createContext,
  earnsCredit,
  isFactorableGrade,
  normalizeGrade,
  termOrdinal,
  type CourseCheck,
  type CourseCredit,
  type RequisiteContext,
  type RequisiteOverride,
} from './requisites'

// ---------------------------------------------------------------------------
// Model

export interface PlanCourse {
  /** Unique within the plan, so a repeatable course can appear twice. */
  id: string
  courseId: string
  /** The student elects pass/fail. */
  passFail?: boolean
  /** Units to count for a variable-unit course. */
  units?: number
}

export interface PlanTerm {
  /** Term code, e.g. "F25". */
  term: string
  courses: PlanCourse[]
}

export interface Plan {
  id: string
  name: string
  programs: ProgramSelection[]
  /** First semester of the plan, e.g. "F25". */
  startTerm: string
  /** Oldest first. */
  terms: PlanTerm[]
  createdAt: number
  updatedAt: number
}

/** The slice of a record entry the plan needs (structurally matches state/record RecordEntry). */
export interface RecordEntryLike {
  id: string
  courseId: string | null
  source: 'taken' | 'transfer' | 'exam' | 'waiver'
  term?: string
  grade?: string
  units?: number
  label?: string
  institution?: string
  exam?: { id: string; score: string }
}

export interface RecordLike {
  entries: RecordEntryLike[]
  overrides: Record<string, RequisiteOverride | undefined>
}

// ---------------------------------------------------------------------------
// Terms

export type Season = 'fall' | 'spring' | 'summer'

const SEASON_OF = { F: 'fall', S: 'spring', M: 'summer' } as const

export function seasonOf(term: string): Season {
  return SEASON_OF[term[0].toUpperCase() as keyof typeof SEASON_OF] ?? 'fall'
}

export function isSummer(term: string): boolean {
  return seasonOf(term) === 'summer'
}

function termFromOrdinal(o: number): string {
  const season = (['S', 'M', 'F'] as const)[o % 3]
  return `${season}${String(Math.floor(o / 3) % 100).padStart(2, '0')}`
}

/** The term after `term`; skips summer unless `summers`. */
export function nextTerm(term: string, summers = false): string {
  let o = termOrdinal(term)
  if (o === null) return term
  do o++
  while (!summers && o % 3 === 1)
  return termFromOrdinal(o)
}

export function previousTerm(term: string, summers = false): string {
  let o = termOrdinal(term)
  if (o === null) return term
  do o--
  while (!summers && o % 3 === 1)
  return termFromOrdinal(o)
}

/** `count` fall/spring semesters starting at `start` (a summer start rolls forward to fall). */
export function defaultTerms(start: string, count = 8): string[] {
  let t = isSummer(start) ? nextTerm(start) : start.toUpperCase()
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(t)
    t = nextTerm(t)
  }
  return out
}

/** The term in progress on `now` (Jan–May spring, Jun–Aug summer, Sep–Dec fall). */
export function currentTermCode(now: Date = new Date()): string {
  const m = now.getMonth()
  const yy = String(now.getFullYear() % 100).padStart(2, '0')
  return `${m <= 4 ? 'S' : m <= 7 ? 'M' : 'F'}${yy}`
}

/** The fall that starts the academic year containing `term` ("S26" → "F25"). */
export function academicYearStart(term: string): string {
  const o = termOrdinal(term)
  if (o === null) return term
  const year = Math.floor(o / 3)
  return termFromOrdinal(o % 3 === 2 ? o : (year - 1) * 3 + 2)
}

/** "F25" → "2025–26". */
export function academicYearLabel(term: string): string {
  const start = academicYearStart(term)
  const y = 2000 + Number(start.slice(1))
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`
}

export type TermPhase = 'past' | 'current' | 'future'

export function termPhase(term: string, current: string): TermPhase {
  const a = termOrdinal(term)
  const b = termOrdinal(current)
  if (a === null || b === null) return 'future'
  return a < b ? 'past' : a === b ? 'current' : 'future'
}

export function compareTerms(a: string, b: string): number {
  return (termOrdinal(a) ?? 0) - (termOrdinal(b) ?? 0)
}

// ---------------------------------------------------------------------------
// Record → plan

/** Effective grade: transfer and exam credit carry AD (credit without a grade). */
function recordGrade(e: RecordEntryLike): string | undefined {
  if (e.source === 'transfer' || e.source === 'exam') return 'AD'
  return normalizeGrade(e.grade)
}

/** Record entries shown inside a term column: CMU courses with a term. */
export function isTermEntry(e: RecordEntryLike): boolean {
  return e.source === 'taken' && !!e.term && termOrdinal(e.term) !== null
}

/** Everything else on the record: exam, transfer and placement credit, and terms-less courses. */
export function incomingCredit(record: RecordLike): RecordEntryLike[] {
  return record.entries.filter((e) => !isTermEntry(e))
}

export interface PlanColumn {
  term: string
  phase: TermPhase
  /** Courses the student placed in this term in the plan. */
  planned: PlanCourse[]
  /** Courses on the record for this term (read-only in the plan). */
  recorded: RecordEntryLike[]
  /** True when the term isn't in the plan's own list (it only exists because of the record). */
  fromRecordOnly: boolean
}

/** Plan terms plus any record terms, oldest first. */
export function planColumns(plan: Plan, record: RecordLike, current: string): PlanColumn[] {
  const byTerm = new Map<string, PlanColumn>()
  for (const t of plan.terms) {
    byTerm.set(t.term, { term: t.term, phase: termPhase(t.term, current), planned: t.courses, recorded: [], fromRecordOnly: false })
  }
  for (const e of record.entries) {
    if (!isTermEntry(e)) continue
    const term = e.term!.toUpperCase()
    let col = byTerm.get(term)
    if (!col) {
      col = { term, phase: termPhase(term, current), planned: [], recorded: [], fromRecordOnly: true }
      byTerm.set(term, col)
    }
    col.recorded.push(e)
  }
  return [...byTerm.values()].sort((a, b) => compareTerms(a.term, b.term))
}

// ---------------------------------------------------------------------------
// Units

/** Catalog (then fallback) units for a course; variable-unit courses use their minimum. */
export type UnitsOf = (courseId: string) => number | null | undefined

export function planCourseUnits(c: PlanCourse, unitsOf: UnitsOf): number {
  return c.units ?? unitsOf(c.courseId) ?? 0
}

export function isVariableUnits(courseId: string, catalog: CatalogIndex | null): boolean {
  const e = catalog?.courses[courseId]
  return !!e && (e.unitsMax !== undefined || e.units === null)
}

export function planCoursePassFail(c: PlanCourse, catalog: CatalogIndex | null): boolean {
  return !!c.passFail || !!catalog?.courses[c.courseId]?.passFail
}

// ---------------------------------------------------------------------------
// Audit input

export interface AuditOptions {
  /** Term in progress; defaults to today's. */
  current?: string
  unitsOf?: UnitsOf
  /** Display label for exam credit, e.g. "AP Calculus BC (5)". */
  examLabel?: (examId: string, score: string) => string
}

export function planToAuditInput(plan: Plan, record: RecordLike, catalog: CatalogIndex | null, opts: AuditOptions = {}): AuditInput {
  const current = opts.current ?? currentTermCode()
  const unitsOf: UnitsOf = opts.unitsOf ?? ((id) => catalog?.courses[id]?.units)
  const courses: PlannedCourse[] = []
  const seen = new Set<string>()

  for (const e of record.entries) {
    if (!e.courseId) continue
    const grade = recordGrade(e)
    // Failing, withdrawn and incomplete grades earn nothing toward the degree.
    if (e.source !== 'waiver' && !earnsCredit(grade)) continue
    const units = e.source === 'waiver' ? 0 : (e.units ?? unitsOf(e.courseId) ?? 0)
    if (e.source === 'taken') {
      const term = e.term && termOrdinal(e.term) !== null ? e.term.toUpperCase() : null
      const phase = term ? termPhase(term, current) : 'past'
      courses.push({
        courseId: e.courseId,
        term,
        status: phase === 'past' ? 'completed' : phase === 'current' ? 'in-progress' : 'planned',
        ...(grade ? { grade } : {}),
        units,
        passFail: isFactorableGrade(grade) === false || !!catalog?.courses[e.courseId]?.passFail,
        source: 'Record',
      })
      if (term) seen.add(`${e.courseId}@${term}`)
    } else {
      courses.push({
        courseId: e.courseId,
        term: null,
        status: 'credit',
        ...(grade ? { grade } : {}),
        units,
        passFail: true,
        source: creditSource(e, opts.examLabel),
      })
    }
  }

  for (const t of plan.terms) {
    const phase = termPhase(t.term, current)
    for (const c of t.courses) {
      // The record wins when the same course is listed for the same term in both places.
      if (seen.has(`${c.courseId}@${t.term}`)) continue
      courses.push({
        courseId: c.courseId,
        term: t.term,
        status: phase === 'past' ? 'completed' : phase === 'current' ? 'in-progress' : 'planned',
        units: planCourseUnits(c, unitsOf),
        passFail: planCoursePassFail(c, catalog),
        source: 'Plan',
      })
    }
  }

  return { programs: plan.programs, courses }
}

function creditSource(e: RecordEntryLike, examLabel?: (examId: string, score: string) => string): string {
  if (e.source === 'exam' && e.exam) return examLabel ? examLabel(e.exam.id, e.exam.score) : `Exam credit (${e.exam.score})`
  if (e.source === 'transfer') return e.institution ? `Transfer: ${e.institution}` : 'Transfer credit'
  if (e.source === 'waiver') return 'Placement (no units)'
  return e.label ?? 'Credit'
}

// ---------------------------------------------------------------------------
// Per-term totals

export interface TermTotalsInput {
  courseId: string
  units: number
  passFail: boolean
  /** Variable-unit course counted at its minimum (or chosen) units. */
  variable?: boolean
  /**
   * Which half of the term the course runs in, when known (e.g. from a schedule): null for full semester.
   * When absent, the course's FCE history decides (mostly-mini courses count as minis).
   */
  half?: 'first' | 'second' | 'either' | null
}

export interface TermTotals {
  /** Official units: minis count their real units. */
  units: number
  factorable: number
  nonFactorable: number
  hasVariable: boolean
  /** Sum of FCE hours/week for courses that have them (minis included at their in-session hours). */
  fceHours: number
  /** Units of the courses that have FCE hours (to compare like with like). */
  fceUnits: number
  /** Courses without FCE hours. */
  missingFce: number
  /**
   * FCE hours/week in the busier half of the term, over courses with FCE hours. Full-semester courses count in
   * both halves and minis only in theirs, so this is the load to compare. Equals fceHours without minis.
   */
  peakHours: number
  /** Hours/week the units of those courses suggest in that half: full units + 2 × mini units. */
  peakExpected: number
  /** Which half peaks; null when no course with FCE hours is a mini. */
  peakHalf: 'first' | 'second' | null
  /** FCE hours/week in the other half (equals peakHours without minis). */
  otherHalfHours: number
  /** Courses counted as minis (estimated from FCE history unless the input says). */
  minis: number
  count: number
}

/**
 * Totals for one plan term. `fceMini` says how each course is usually taught (defaults to the loaded FCE
 * summary); a mostly-mini course counts as a mini in its usual half for the per-half peak.
 */
export function termTotals(
  items: TermTotalsInput[],
  fceHours: (courseId: string) => number | null | undefined,
  fceMini: (courseId: string) => FceMiniInfo | null = fceMiniOf,
): TermTotals {
  const t: TermTotals = {
    units: 0,
    factorable: 0,
    nonFactorable: 0,
    hasVariable: false,
    fceHours: 0,
    fceUnits: 0,
    missingFce: 0,
    peakHours: 0,
    peakExpected: 0,
    peakHalf: null,
    otherHalfHours: 0,
    minis: 0,
    count: items.length,
  }
  const loads: LoadItem[] = []
  for (const i of items) {
    t.units += i.units
    if (i.passFail) t.nonFactorable += i.units
    else t.factorable += i.units
    if (i.variable) t.hasVariable = true
    const info = fceMini(i.courseId)
    const half = i.half !== undefined ? i.half : isMostlyMini(info) ? (info!.half ?? 'either') : null
    if (half !== null) t.minis++
    const h = fceHours(i.courseId)
    if (h === null || h === undefined) t.missingFce++
    else {
      t.fceHours += h
      t.fceUnits += i.units
      loads.push({ hours: h, units: i.units, half })
    }
  }
  const { first, second, hasMinis } = splitHalves(loads)
  const [peak, other, peakHalf] = second.hours > first.hours ? [second, first, 'second' as const] : [first, second, 'first' as const]
  t.peakHours = peak.hours
  t.peakExpected = peak.expected
  t.otherHalfHours = other.hours
  t.peakHalf = hasMinis ? peakHalf : null
  return t
}

/**
 * Load guidance for a semester. Not policy: colleges set their own limits and approvals.
 * CMU's overload limit counts factorable units only; pass/fail units never count toward it.
 */
export const HEAVY_UNITS = 54

export function loadWarnings(t: TermTotals): string[] {
  const out: string[] = []
  if (t.factorable > HEAVY_UNITS) out.push(`Over ${HEAVY_UNITS} factorable units, which usually needs your college's approval`)
  // Only compare hours when most of the load has FCE data. Minis count double per week in their half.
  if (t.fceUnits >= 24 && t.fceUnits >= t.units * 0.6 && t.peakHours > t.peakExpected * 1.2) {
    out.push(
      t.peakHalf
        ? `FCE hours peak at ${Math.round(t.peakHours)}/week in the ${t.peakHalf} half, well above the ${Math.round(t.peakExpected)} its units suggest`
        : `FCE hours (${Math.round(t.peakHours)}/week) run well above the ${t.fceUnits} units they cover`,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Requisite checks with plan timing

export interface PlanCheck {
  planCourseId: string
  courseId: string
  term: string
  check: CourseCheck
}

/**
 * Requisite context for courses in `term`: record work before `term` is completed; same-term record and
 * plan courses are concurrent (corequisites only); plan courses in earlier terms are planned.
 */
export function planRequisiteContext(plan: Plan, record: RecordLike, catalog: CatalogIndex | null, term: string, equivalents = buildEquivalence(catalog)): RequisiteContext {
  const target = termOrdinal(term)
  const credits: CourseCredit[] = []
  for (const e of record.entries) {
    if (!e.courseId) continue
    const at = e.term ? termOrdinal(e.term) : null
    if (target !== null && at !== null && at > target) continue
    const timing = target !== null && at !== null && at === target ? 'concurrent' : 'completed'
    credits.push({ courseId: e.courseId, timing, source: e.source, grade: recordGrade(e), term: e.term })
  }
  for (const t of plan.terms) {
    const at = termOrdinal(t.term)
    if (target === null || at === null || at > target) continue
    const timing = at === target ? 'concurrent' : 'planned'
    for (const c of t.courses) credits.push({ courseId: c.courseId, timing, source: 'plan', term: t.term })
  }
  return createContext({ credits, equivalents, overrides: record.overrides })
}

/** Checks every planned course against what comes before it in the plan (and the record). */
export function checkPlan(plan: Plan, record: RecordLike, catalog: CatalogIndex | null): Map<string, PlanCheck> {
  const out = new Map<string, PlanCheck>()
  const equivalents = buildEquivalence(catalog)
  for (const t of plan.terms) {
    if (!t.courses.length) continue
    const ctx = planRequisiteContext(plan, record, catalog, t.term, equivalents)
    for (const c of t.courses) {
      // The course itself is "concurrent" in its own term; checkCourse ignores concurrent self-credits.
      const check = checkCourse(c.courseId, catalog?.courses[c.courseId], ctx)
      out.set(c.id, { planCourseId: c.id, courseId: c.courseId, term: t.term, check })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Offerings and placement

export type Offering =
  /** In this term's published schedule. */
  | 'scheduled'
  /** A term with published data that doesn't list the course. */
  | 'not-scheduled'
  /** No schedule yet; the catalog says it's normally offered this season. */
  | 'usually'
  /** No schedule yet; the catalog lists other seasons only. */
  | 'other-seasons'
  /** Nothing to go on. */
  | 'unknown'

/**
 * Whether a course is likely offered in `term`. `scheduled` is the set of course ids in that term's
 * published data (undefined when the term has none).
 */
export function offering(courseId: string, term: string, catalog: CatalogIndex | null, scheduled?: Set<string> | null): Offering {
  if (scheduled) return scheduled.has(courseId) ? 'scheduled' : 'not-scheduled'
  const seasons = catalog?.courses[courseId]?.offered
  if (!seasons?.length) return 'unknown'
  return seasons.includes(seasonOf(term)) ? 'usually' : 'other-seasons'
}

export const OFFERING_LABEL: Record<Offering, string> = {
  scheduled: 'On the schedule',
  'not-scheduled': 'Not on this semester’s schedule',
  usually: 'Usually offered this season',
  'other-seasons': 'Not usually offered this season',
  unknown: 'Offering pattern unknown',
}

/**
 * Suggests a term for a course: the first term from `from` on (current or later) where it's likely
 * offered and the load stays at or under `maxUnits`. Falls back to the first future term with room.
 */
export function suggestTerm(
  plan: Plan,
  courseId: string,
  catalog: CatalogIndex | null,
  current: string,
  unitsOf: UnitsOf,
  scheduledByTerm: (term: string) => Set<string> | null | undefined = () => undefined,
  maxUnits = HEAVY_UNITS,
  /** When given, prefer the earliest semester whose prerequisites are met (or planned) by then. */
  record?: RecordLike,
): string | null {
  // The overload limit counts factorable units only, so pass/fail courses (catalog or elected) don't fill a term.
  const units = catalog?.courses[courseId]?.passFail ? 0 : (unitsOf(courseId) ?? 9)
  const candidates = plan.terms.filter((t) => termPhase(t.term, current) !== 'past')
  const entry = catalog?.courses[courseId]
  const equivalents = record && entry?.prereqs ? buildEquivalence(catalog) : null
  const prereqsReady = (t: PlanTerm) => {
    if (!record || !entry?.prereqs || !equivalents) return true
    const check = checkCourse(courseId, entry, planRequisiteContext(plan, record, catalog, t.term, equivalents))
    return !check.issues.some((i) => i.kind === 'prereq' && i.severity === 'error')
  }
  const load = (t: PlanTerm) => t.courses.reduce((n, c) => n + (planCoursePassFail(c, catalog) ? 0 : planCourseUnits(c, unitsOf)), 0)
  const fits = (t: PlanTerm) => load(t) + units <= maxUnits
  const offered = (t: PlanTerm) => {
    const o = offering(courseId, t.term, catalog, scheduledByTerm(t.term))
    return o === 'scheduled' || o === 'usually' || o === 'unknown'
  }
  return (
    candidates.find((t) => offered(t) && fits(t) && prereqsReady(t))?.term ??
    candidates.find((t) => offered(t) && fits(t))?.term ??
    candidates.find((t) => fits(t) && !isSummer(t.term))?.term ??
    candidates[0]?.term ??
    null
  )
}

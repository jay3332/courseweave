// Requisite evaluation: prerequisites, corequisites and anti-requisites against what a student
// has completed, has planned in earlier terms, and is taking in the same term.
// Pure logic; the record store and planners build a RequisiteContext and call checkCourse().

import type { CatalogEntry, CatalogIndex, Requisite } from './catalog-types'
import { substitutesFor } from './substitutes'

// ---------------------------------------------------------------------------
// Terms

const SEASON_INDEX = { S: 0, M: 1, F: 2 } as const
const SEASON_NAME = { S: 'Spring', M: 'Summer', F: 'Fall' } as const

/** "F25" → sortable number (Spring < Summer < Fall within a year). Null if not a term code. */
export function termOrdinal(term: string): number | null {
  const m = /^([SMF])(\d{2})$/.exec(term.trim().toUpperCase())
  if (!m) return null
  return (2000 + Number(m[2])) * 3 + SEASON_INDEX[m[1] as keyof typeof SEASON_INDEX]
}

/** "F25" → "Fall 2025". */
export function termLabel(term: string): string {
  const m = /^([SMF])(\d{2})$/.exec(term.trim().toUpperCase())
  return m ? `${SEASON_NAME[m[1] as keyof typeof SEASON_NAME]} 20${m[2]}` : term
}

/** Term codes from `from` to `to` inclusive, oldest first. Summers included only if `summers`. */
export function termRange(from: string, to: string, summers = false): string[] {
  const a = termOrdinal(from)
  const b = termOrdinal(to)
  if (a === null || b === null) return []
  const out: string[] = []
  for (let o = a; o <= b; o++) {
    const season = (['S', 'M', 'F'] as const)[o % 3]
    if (season === 'M' && !summers) continue
    out.push(`${season}${String(Math.floor(o / 3) % 100).padStart(2, '0')}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Grades

/** CMU letter grades, best first. Undergraduate grades are A–D/R; graduate grades add +/−. */
const LETTER_POINTS: Record<string, number> = {
  'A+': 4.33,
  A: 4,
  'A-': 3.67,
  'B+': 3.33,
  B: 3,
  'B-': 2.67,
  'C+': 2.33,
  C: 2,
  'C-': 1.67,
  'D+': 1.33,
  D: 1,
  R: 0,
}

/** Grades that earn credit without quality points. */
const NON_FACTORABLE_PASSING = new Set(['P', 'S', 'AD'])
/** Grades that earn no credit and don't satisfy requisites. */
const NO_CREDIT = new Set(['R', 'N', 'W', 'I', 'O', 'X'])

export function normalizeGrade(grade: string | undefined | null): string | undefined {
  const g = grade?.trim().toUpperCase().replace('−', '-')
  return g ? g : undefined
}

/** Quality points for a factorable grade, or null (P, N, W, I, …). */
export function gradePoints(grade: string | undefined): number | null {
  const g = normalizeGrade(grade)
  return g !== undefined && g in LETTER_POINTS ? LETTER_POINTS[g] : null
}

/** Whether units with this grade count toward QPA (letter grades A+–D and R). Unknown grade → null. */
export function isFactorableGrade(grade: string | undefined): boolean | null {
  const g = normalizeGrade(grade)
  if (g === undefined) return null
  return g in LETTER_POINTS
}

/** Whether a completed course with this grade earns credit. Unknown grade is assumed to pass. */
export function earnsCredit(grade: string | undefined): boolean {
  const g = normalizeGrade(grade)
  return g === undefined || !NO_CREDIT.has(g)
}

export type GradeCheck = 'ok' | 'too-low' | 'unverified'

/**
 * Does `grade` meet `minGrade`? Unknown grades are assumed fine; P/S/AD pass without a letter,
 * so they're "unverified" against a minimum above D.
 */
export function meetsMinGrade(grade: string | undefined, minGrade: string | undefined): GradeCheck {
  const min = normalizeGrade(minGrade)
  const g = normalizeGrade(grade)
  if (g === undefined) return 'ok'
  if (!earnsCredit(g)) return 'too-low'
  if (!min) return 'ok'
  if (NON_FACTORABLE_PASSING.has(g)) return (LETTER_POINTS[min] ?? 0) <= 1 ? 'ok' : 'unverified'
  const have = LETTER_POINTS[g]
  const need = LETTER_POINTS[min]
  if (have === undefined || need === undefined) return 'ok'
  return have + 1e-9 >= need ? 'ok' : 'too-low'
}

// ---------------------------------------------------------------------------
// Context

export type CreditTiming =
  /** Taken or credited before the term being checked (record, transfer, exam, waiver). */
  | 'completed'
  /** Planned for an earlier term; satisfies requisites, but isn't done yet. */
  | 'planned'
  /** In the same term as the course being checked; counts for corequisites only. */
  | 'concurrent'

export type CreditSource = 'taken' | 'transfer' | 'exam' | 'waiver' | 'plan' | 'schedule'

export interface CourseCredit {
  courseId: string
  timing: CreditTiming
  source: CreditSource
  grade?: string
  /** Term code, when known. */
  term?: string
}

export interface RequisiteOverride {
  prereqs?: boolean
  coreqs?: boolean
  antireqs?: boolean
  note?: string
}

export interface RequisiteContext {
  /** courseId → credits for exactly that course. */
  credits: Map<string, CourseCredit[]>
  /** courseId → ids that count as it (equivalents and cross-listings), excluding itself. */
  equivalents: Map<string, Set<string>>
  /** courseId → requisite waivers/permissions for that course. */
  overrides: Record<string, RequisiteOverride | undefined>
}

export function createContext(input: {
  credits: CourseCredit[]
  equivalents?: Map<string, Set<string>>
  overrides?: Record<string, RequisiteOverride | undefined>
}): RequisiteContext {
  const credits = new Map<string, CourseCredit[]>()
  for (const c of input.credits) {
    const list = credits.get(c.courseId) ?? []
    list.push(c)
    credits.set(c.courseId, list)
  }
  return { credits, equivalents: input.equivalents ?? new Map(), overrides: input.overrides ?? {} }
}

/**
 * For each course, the courses that count for it (`map.get(required)` → satisfying ids, excluding itself): the
 * catalog's `equivalents` lists (made symmetric), extra groups such as a term's cross-listings, and one-way honors
 * substitutes (21-425 counts for 21-325 and for what the catalog lists as equivalent to 21-325, not the reverse).
 * Catalog equivalence is deliberately not transitive: chains (36-201 ~ 36-225 ~ 21-325 …) would otherwise merge
 * unrelated courses.
 */
export function buildEquivalence(catalog: CatalogIndex | null, extraGroups: string[][] = [], substitutes = substitutesFor()): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (required: string, by: string) => {
    if (required === by) return
    let s = out.get(required)
    if (!s) out.set(required, (s = new Set()))
    s.add(by)
  }
  const link = (a: string, b: string) => {
    add(a, b)
    add(b, a)
  }
  if (catalog) for (const entry of Object.values(catalog.courses)) for (const e of entry.equivalents) link(entry.id, e)
  for (const group of extraGroups) for (const a of group) for (const b of group) link(a, b)
  // A substitute counts for its lower course and for whatever that course counts for (one step, like the catalog).
  const counted = invert(out)
  for (const [lower, highers] of substitutes) {
    const targets = [lower, ...(counted.get(lower) ?? [])]
    for (const higher of highers) for (const t of targets) add(t, higher)
  }
  return out
}

function invert(eq: Map<string, Set<string>>): Map<string, Set<string>> {
  const inv = new Map<string, Set<string>>()
  for (const [required, satisfiers] of eq)
    for (const by of satisfiers) {
      let s = inv.get(by)
      if (!s) inv.set(by, (s = new Set()))
      s.add(required)
    }
  return inv
}

const inverseCache = new WeakMap<Map<string, Set<string>>, Map<string, Set<string>>>()

/** The other direction of an equivalence map: for a course taken, the courses it counts for. Don't mutate `eq` after. */
export function countsAs(eq: Map<string, Set<string>>): Map<string, Set<string>> {
  let inv = inverseCache.get(eq)
  if (!inv) inverseCache.set(eq, (inv = invert(eq)))
  return inv
}

// ---------------------------------------------------------------------------
// Evaluation

export type RequisiteStatus =
  /** Satisfied by completed work. */
  | 'met'
  /** Satisfied only by planned (or same-term, for corequisites) courses. */
  | 'planned'
  /** Not satisfied. */
  | 'missing'
  /** Can't be checked automatically (text conditions). Never blocks. */
  | 'unknown'

export interface CourseMatch {
  credit: CourseCredit
  /** Set when an equivalent course satisfied the node. */
  via?: string
  grade: GradeCheck
}

export interface RequisiteResult {
  status: RequisiteStatus
  node: Requisite
  children?: RequisiteResult[]
  /** Course nodes: the credit that satisfies it, if any. */
  match?: CourseMatch
  /** Course nodes: a credit exists but its grade is below the minimum. */
  gradeTooLow?: { grade: string; minGrade: string }
}

export interface EvaluateOptions {
  /** Same-term credits count (corequisites). Default false. */
  allowConcurrent?: boolean
}

const RANK: Record<RequisiteStatus, number> = { met: 3, planned: 2, unknown: 1, missing: 0 }

function bestCredit(courseId: string, minGrade: string | undefined, ctx: RequisiteContext, opts: EvaluateOptions) {
  const ids = [courseId, ...(ctx.equivalents.get(courseId) ?? [])]
  let best: { match: CourseMatch; status: RequisiteStatus } | null = null
  let tooLow: { grade: string; minGrade: string } | undefined
  for (const id of ids) {
    for (const credit of ctx.credits.get(id) ?? []) {
      if (credit.timing === 'concurrent' && !opts.allowConcurrent) continue
      if (credit.source !== 'waiver' && !earnsCredit(credit.grade) && credit.timing === 'completed') continue
      // Transfer, exam and waiver credit isn't graded at CMU; minimum grades don't apply.
      const grade = credit.source === 'taken' || credit.source === 'plan' || credit.source === 'schedule' ? meetsMinGrade(credit.grade, minGrade) : 'ok'
      if (grade === 'too-low') {
        tooLow ??= { grade: normalizeGrade(credit.grade)!, minGrade: normalizeGrade(minGrade)! }
        continue
      }
      const status: RequisiteStatus = credit.timing === 'completed' ? 'met' : 'planned'
      const candidate = { match: { credit, via: id === courseId ? undefined : id, grade }, status }
      if (!best || RANK[status] > RANK[best.status] || (RANK[status] === RANK[best.status] && grade === 'ok' && best.match.grade !== 'ok')) {
        best = candidate
      }
    }
  }
  return { best, tooLow }
}

export function evaluateRequisite(node: Requisite, ctx: RequisiteContext, opts: EvaluateOptions = {}): RequisiteResult {
  switch (node.type) {
    case 'course': {
      const { best, tooLow } = bestCredit(node.id, node.minGrade, ctx, opts)
      if (best) return { status: best.status, node, match: best.match }
      return { status: 'missing', node, ...(tooLow ? { gradeTooLow: tooLow } : {}) }
    }
    case 'text':
      return { status: 'unknown', node }
    case 'all':
    case 'any':
    case 'atLeast': {
      const children = node.items.map((c) => evaluateRequisite(c, ctx, opts))
      const need = node.type === 'all' ? children.length : node.type === 'any' ? Math.min(1, children.length) : Math.min(node.n, children.length)
      const count = (s: RequisiteStatus[]) => children.filter((c) => s.includes(c.status)).length
      let status: RequisiteStatus
      if (need === 0) status = 'met'
      else if (count(['met']) >= need) status = 'met'
      else if (count(['met', 'planned']) >= need) status = 'planned'
      else if (count(['met', 'planned', 'unknown']) >= need) status = 'unknown'
      else status = 'missing'
      // "All of" with only text conditions unmet: the checkable part is satisfied, so don't block on it.
      if (node.type === 'all' && status === 'unknown' && count(['missing']) === 0 && count(['met', 'planned']) > 0) {
        status = count(['planned']) > 0 ? 'planned' : 'met'
      }
      return { status, node, children }
    }
  }
}

// ---------------------------------------------------------------------------
// Plain-language summaries

export type CodeOf = (courseId: string) => string

export const defaultCode: CodeOf = (id) => (/^\d{5}$/.test(id) ? `${id.slice(0, 2)}-${id.slice(2)}` : id)

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}`
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** Describes a requisite expression, e.g. "15-122 and (21-127 or 21-128)". */
export function describeRequisite(node: Requisite, code: CodeOf = defaultCode, nested = false): string {
  switch (node.type) {
    case 'course':
      return node.minGrade ? `${code(node.id)} (${node.minGrade} or better)` : code(node.id)
    case 'text':
      return node.text
    case 'all':
    case 'any': {
      const parts = node.items.map((c) => describeRequisite(c, code, true))
      const s = node.type === 'all' ? joinAnd(parts) : joinOr(parts)
      return nested && node.items.length > 1 ? `(${s})` : s
    }
    case 'atLeast': {
      const s = `${node.n} of ${node.items.map((c) => describeRequisite(c, code, true)).join(', ')}`
      return nested ? `(${s})` : s
    }
  }
}

/**
 * What's still needed, as short phrases: ["15-122", "one of 21-127, 21-128 or 15-151"].
 * Only describes missing branches; planned and met parts are omitted.
 */
export function missingParts(result: RequisiteResult, code: CodeOf = defaultCode): string[] {
  if (result.status !== 'missing') return []
  const node = result.node
  switch (node.type) {
    case 'course':
      return [result.gradeTooLow ? `${code(node.id)} with ${node.minGrade} or better (you have ${result.gradeTooLow.grade})` : describeRequisite(node, code)]
    case 'text':
      return []
    case 'all':
      return (result.children ?? []).flatMap((c) => missingParts(c, code))
    case 'any': {
      const opts = node.items.map((c) => describeRequisite(c, code, true))
      return [opts.length === 1 ? opts[0] : `one of ${joinOr(opts)}`]
    }
    case 'atLeast': {
      const have = (result.children ?? []).filter((c) => c.status === 'met' || c.status === 'planned').length
      const opts = node.items.map((c) => describeRequisite(c, code, true))
      return [`${node.n - have} more of ${joinOr(opts)}`]
    }
  }
}

/** Courses mentioned in a requisite expression. */
export function requisiteCourses(node: Requisite | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'course') return [node.id]
  if (node.type === 'text') return []
  return [...new Set(node.items.flatMap(requisiteCourses))]
}

// ---------------------------------------------------------------------------
// Course checks

export type IssueKind = 'prereq' | 'coreq' | 'antireq' | 'repeat' | 'grade'

export interface RequisiteIssue {
  kind: IssueKind
  /** error: blocks enrollment; warning: needs attention; info: worth knowing. */
  severity: 'error' | 'warning' | 'info'
  message: string
  courses: string[]
}

export type CheckLevel =
  /** Everything checkable is satisfied by completed work. */
  | 'ok'
  /** Satisfied, but relies on planned/same-term courses. */
  | 'planned'
  /** Only uncheckable (text) conditions remain. */
  | 'unknown'
  /** Something is missing or conflicts. */
  | 'problem'

export interface CourseCheck {
  courseId: string
  /** Null when the course has no prerequisites. */
  prereqs: RequisiteResult | null
  /** Null when the course has no corequisites. */
  coreqs: RequisiteResult | null
  /** Anti-requisites the student has (or plans) credit for. */
  antireqs: { courseId: string; credit: CourseCredit }[]
  /** Credits for this very course already on record (repeat). */
  already: CourseCredit[]
  waived: { prereqs: boolean; coreqs: boolean; antireqs: boolean }
  level: CheckLevel
  issues: RequisiteIssue[]
}

export interface CheckOptions {
  code?: CodeOf
  /** Treat the course as repeatable (no repeat warning). Defaults to the catalog flag. */
  repeatable?: boolean
}

/** Checks one course's requisites. `entry` undefined = not in the catalog: nothing to check. */
export function checkCourse(courseId: string, entry: CatalogEntry | undefined, ctx: RequisiteContext, options: CheckOptions = {}): CourseCheck {
  const code = options.code ?? defaultCode
  const override = ctx.overrides[courseId] ?? {}
  const waived = { prereqs: !!override.prereqs, coreqs: !!override.coreqs, antireqs: !!override.antireqs }
  const issues: RequisiteIssue[] = []

  const prereqs = entry?.prereqs ? evaluateRequisite(entry.prereqs, ctx) : null
  const coreqIds = (entry?.coreqs ?? []).filter((id) => id !== courseId)
  const coreqs = coreqIds.length
    ? evaluateRequisite({ type: 'any', items: coreqIds.map((id) => ({ type: 'course' as const, id })) }, ctx, { allowConcurrent: true })
    : null

  const antireqs: CourseCheck['antireqs'] = []
  for (const id of entry?.antireqs ?? []) {
    if (id === courseId) continue
    const credit = (ctx.credits.get(id) ?? []).find((c) => c.source !== 'waiver' && earnsCredit(c.grade))
    if (credit) antireqs.push({ courseId: id, credit })
  }

  const already = (ctx.credits.get(courseId) ?? []).filter((c) => c.timing !== 'concurrent' && c.source !== 'waiver' && earnsCredit(c.grade))

  if (prereqs && !waived.prereqs) {
    if (prereqs.status === 'missing') {
      const parts = missingParts(prereqs, code)
      issues.push({
        kind: 'prereq',
        severity: 'error',
        message: parts.length ? `Missing prerequisite${parts.length > 1 ? 's' : ''}: ${joinAnd(parts)}` : 'Prerequisites not met',
        courses: requisiteCourses(entry!.prereqs),
      })
    } else if (prereqs.status === 'planned') {
      issues.push({ kind: 'prereq', severity: 'info', message: 'Prerequisites met by planned courses', courses: [] })
    } else if (prereqs.status === 'unknown') {
      issues.push({ kind: 'prereq', severity: 'info', message: `Check prerequisite: ${describeRequisite(entry!.prereqs!, code)}`, courses: [] })
    }
    const unverified = collectMatches(prereqs).filter((m) => m.grade === 'unverified')
    if (unverified.length) {
      issues.push({
        kind: 'grade',
        severity: 'warning',
        message: `Pass/fail grade may not meet the minimum grade for ${joinAnd(unverified.map((m) => code(m.credit.courseId)))}`,
        courses: unverified.map((m) => m.credit.courseId),
      })
    }
  }
  if (coreqs && !waived.coreqs && coreqs.status === 'missing') {
    issues.push({
      kind: 'coreq',
      severity: 'error',
      message: `Needs ${coreqIds.length === 1 ? code(coreqIds[0]) : `one of ${joinOr(coreqIds.map(code))}`} before or in the same semester`,
      courses: coreqIds,
    })
  }
  if (antireqs.length && !waived.antireqs) {
    issues.push({
      kind: 'antireq',
      severity: 'error',
      message: `No credit alongside ${joinAnd(antireqs.map((a) => code(a.courseId)))}`,
      courses: antireqs.map((a) => a.courseId),
    })
  }
  const repeatable = options.repeatable ?? entry?.repeatable ?? false
  if (already.length && !repeatable) {
    issues.push({ kind: 'repeat', severity: 'warning', message: `Already ${already.some((c) => c.timing === 'completed') ? 'on your record' : 'planned earlier'}`, courses: [courseId] })
  }

  const effective = (r: RequisiteResult | null, isWaived: boolean): RequisiteStatus => (!r || isWaived ? 'met' : r.status)
  const statuses = [effective(prereqs, waived.prereqs), effective(coreqs, waived.coreqs)]
  let level: CheckLevel
  if (statuses.includes('missing') || (antireqs.length && !waived.antireqs)) level = 'problem'
  else if (statuses.includes('unknown')) level = 'unknown'
  else if (statuses.includes('planned')) level = 'planned'
  else level = 'ok'

  return { courseId, prereqs, coreqs, antireqs, already, waived, level, issues }
}

function collectMatches(r: RequisiteResult): CourseMatch[] {
  if (r.status !== 'met' && r.status !== 'planned') return []
  if (r.match) return [r.match]
  return (r.children ?? []).flatMap(collectMatches)
}

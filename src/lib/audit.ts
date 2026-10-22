// Degree requirement audit: assigns a student's courses (taken, credited, planned) to the
// requirement trees of their programs and reports progress per requirement.
//
// Assignment is greedy and deterministic, in this order of preference:
//   - within an "all" group, subtrees made only of specific courses go before subtrees with pools,
//     so electives don't take courses a named requirement needs;
//   - pools prefer courses that aren't named anywhere in the program;
//   - within an "any"/"at least n" group, children are tried tentatively and the best is committed;
//   - completed work is used before planned work, earlier terms before later ones.
// A course counts once per program unless a "may double count" rule allows sharing, and across
// programs according to each program's double-counting rules (default: allowed).

import type { CatalogIndex } from './catalog-types'
import type { CountRule, DoubleCountRule, PoolSet, ProgramVersion, ReqNode } from './degree-types'
import type { AuditInput, AuditResult, PlannedCourse, ProgramAuditResult, RequirementResult, RequirementState } from './plan-types'
import { buildEquivalence, earnsCredit, meetsMinGrade, normalizeGrade, termOrdinal } from './requisites'

// ---------------------------------------------------------------------------
// Course instances

interface Inst {
  key: number
  course: PlannedCourse
  id: string
  units: number
  /** Term ordinal; null for credit without a term. */
  ord: number | null
  /** Completed or credited: counts as "have" rather than "planned". */
  done: boolean
  /** Graded pass/fail (elected, P/F-only, or a P/S grade). */
  passFail: boolean
  /** The catalog only offers it pass/fail. */
  pfOnly: boolean
}

const NON_LETTER_PASS = new Set(['P', 'S'])

function toInstances(courses: PlannedCourse[], catalog: CatalogIndex | null): Inst[] {
  const out: Inst[] = []
  courses.forEach((course, key) => {
    if (course.status !== 'credit' && !earnsCredit(course.grade)) return
    const grade = normalizeGrade(course.grade)
    const pfOnly = Boolean(catalog?.courses[course.courseId]?.passFail)
    out.push({
      key,
      course,
      id: course.courseId,
      units: course.units,
      ord: course.term ? termOrdinal(course.term) : null,
      done: course.status === 'completed' || course.status === 'credit',
      // Transfer and exam credit is ungraded for QPA purposes (PlannedCourse.passFail), but it satisfies requirements
      // like the course itself; only CMU work graded P/S counts as pass/fail here.
      passFail: course.status !== 'credit' && (course.passFail || pfOnly || (grade !== undefined && NON_LETTER_PASS.has(grade))),
      pfOnly,
    })
  })
  return out
}

/** Completed work first, then earlier terms, then input order. */
function byPreference(a: Inst, b: Inst): number {
  return Number(b.done) - Number(a.done) || (a.ord ?? -1) - (b.ord ?? -1) || a.key - b.key
}

// ---------------------------------------------------------------------------
// Matching

interface CompiledSet {
  courses: Set<string> | null
  ranges: [number, number][]
  anyDept: [number, number][]
  depts: Set<string> | null
  patterns: RegExp[]
  any: boolean
  from: number | null
  to: number | null
}

const compiledSets = new WeakMap<PoolSet, CompiledSet>()

function compile(set: PoolSet): CompiledSet {
  let c = compiledSets.get(set)
  if (!c) {
    c = {
      courses: set.courses?.length ? new Set(set.courses) : null,
      ranges: (set.ranges ?? []).map(([a, b]) => [Number(a), Number(b)]),
      anyDept: set.anyDeptRanges ?? [],
      depts: set.depts?.length ? new Set(set.depts) : null,
      patterns: (set.patterns ?? []).map((p) => new RegExp(p)),
      any: Boolean(set.any),
      from: set.from ? termOrdinal(set.from) : null,
      to: set.to ? termOrdinal(set.to) : null,
    }
    compiledSets.set(set, c)
  }
  return c
}

function inWindow(ord: number | null, from: number | null | undefined, to: number | null | undefined): boolean {
  if (ord === null) return true
  if (from != null && ord < from) return false
  if (to != null && ord > to) return false
  return true
}

function matchesSet(set: PoolSet, inst: Inst, eq: Map<string, Set<string>>): boolean {
  const c = compile(set)
  if (!inWindow(inst.ord, c.from, c.to)) return false
  if (c.any) return true
  const id = inst.id
  if (c.courses) {
    if (c.courses.has(id)) return true
    const alt = eq.get(id)
    if (alt) for (const a of alt) if (c.courses.has(a)) return true
  }
  if (c.depts?.has(id.slice(0, 2))) return true
  const n = Number(id)
  for (const [lo, hi] of c.ranges) if (n >= lo && n <= hi) return true
  const num = Number(id.slice(2))
  for (const [lo, hi] of c.anyDept) if (num >= lo && num <= hi) return true
  for (const re of c.patterns) if (re.test(id)) return true
  return false
}

function matchesRule(rule: CountRule, inst: Inst, eq: Map<string, Set<string>>): boolean {
  const hit = rule.sets.some((s) => matchesSet(s, inst, eq))
  return rule.inverse ? !hit : hit
}

function matchesCourse(courseId: string, inst: Inst, eq: Map<string, Set<string>>): boolean {
  return inst.id === courseId || Boolean(eq.get(courseId)?.has(inst.id))
}

const amount = (inst: Inst, units: boolean) => (units ? inst.units : 1)

// ---------------------------------------------------------------------------
// Assignment state (cloned for tentative evaluation of alternatives)

class State {
  /** inst key → node ids it counts toward in the current program. */
  used = new Map<number, number[]>()
  /** inst key → requirements that allowed sharing where it was first counted. */
  owners = new Map<number, ReqNode[]>()
  /** shareWithin owner node id → amount shared. */
  shareUsed = new Map<number, number>()
  /** cap rule → amount counted. */
  capUsed = new Map<CountRule, number>()
  /** "auditA:auditB" → amount shared between the two programs. */
  crossUsed = new Map<string, number>()

  clone(): State {
    const s = new State()
    for (const [k, v] of this.used) s.used.set(k, [...v])
    s.owners = new Map(this.owners)
    s.shareUsed = new Map(this.shareUsed)
    s.capUsed = new Map(this.capUsed)
    s.crossUsed = new Map(this.crossUsed)
    return s
  }
}

interface PriorUse {
  auditId: number
  path: number[]
}

interface ProgramContext {
  version: ProgramVersion
  insts: Inst[]
  eq: Map<string, Set<string>>
  /** Course ids named by specific-course requirements anywhere in this program. */
  named: Set<string>
  /** Courses already counted by programs audited earlier. */
  prior: Map<number, PriorUse[]>
  versions: Map<number, ProgramVersion>
  /** Catalog ids of every program in the audit (for program-dependent rules). */
  programIds: Set<number>
}

interface Inherited {
  minGrade?: string
  allowPassFail: boolean
  window?: { from: number | null; to: number | null }
  excludes: PoolSet[]
  caps: CountRule[]
  /** Ancestors (and self) that allow sharing courses with other requirements of this program. */
  shareOwners: ReqNode[]
  /** Node ids from the root down to the current node. */
  path: number[]
}

// ---------------------------------------------------------------------------
// Double counting

function rulesBetween(a: ProgramVersion, b: ProgramVersion): DoubleCountRule | null {
  let general: DoubleCountRule | null = null
  let byKind: DoubleCountRule | null = null
  for (const r of a.doubleCount) {
    if (r.programs.includes(b.catalogId)) return r
    if (r.kinds?.includes(b.kind)) byKind ??= r
    else if (!r.programs.length && !r.kinds?.length) general ??= r
  }
  return byKind ?? general
}

/** How much `a` lets courses counted at `path` be shared with `b`. */
function shareLimit(a: ProgramVersion, b: ProgramVersion, path: number[]): { limit: number; units: boolean } {
  const rule = rulesBetween(a, b)
  if (!rule) return { limit: Infinity, units: false }
  for (const ex of rule.exceptions) if (ex.nodes.some((n) => path.includes(n))) return { limit: ex.limit, units: ex.units }
  return { limit: rule.limit, units: rule.units }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// ---------------------------------------------------------------------------
// Eligibility of one course for one requirement

function canCount(inst: Inst, node: ReqNode, inh: Inherited, st: State, ctx: ProgramContext, exactCourse: boolean): boolean {
  // Grades: credit (AP, transfer) is accepted as-is; letter grades must meet the minimum.
  if (inst.course.status !== 'credit' && inh.minGrade && meetsMinGrade(inst.course.grade, inh.minGrade) === 'too-low') return false
  // Pass/fail work counts only where allowed, or where a P/F-only course is named outright.
  if (inst.passFail && !inh.allowPassFail && !(exactCourse && inst.pfOnly)) return false
  if (inh.window && !inWindow(inst.ord, inh.window.from, inh.window.to)) return false
  if (inh.excludes.some((s) => matchesSet(s, inst, ctx.eq))) return false
  if (node.minUnitsEach && inst.units < node.minUnitsEach) return false
  for (const cap of inh.caps) {
    if (cap.max === undefined || !matchesRule(cap, inst, ctx.eq)) continue
    if ((st.capUsed.get(cap) ?? 0) + amount(inst, cap.units) > cap.max + 1e-9) return false
  }
  // Within this program: once, unless a requirement on either side allows sharing.
  if (st.used.has(inst.key) && !shareOwner(inst, inh, st)) return false
  // Across programs audited earlier.
  for (const use of ctx.prior.get(inst.key) ?? []) {
    const other = ctx.versions.get(use.auditId)
    if (!other) continue
    const mine = shareLimit(ctx.version, other, inh.path)
    const theirs = shareLimit(other, ctx.version, use.path)
    const binding = mine.limit <= theirs.limit ? mine : theirs
    if (binding.limit === Infinity) continue
    const used = st.crossUsed.get(pairKey(ctx.version.auditId, use.auditId)) ?? 0
    if (used + amount(inst, binding.units) > binding.limit + 1e-9) return false
  }
  return true
}

/** A requirement (here, or where the course already counts) with sharing budget left for `inst`. */
function shareOwner(inst: Inst, inh: Inherited, st: State): ReqNode | undefined {
  const fits = (o: ReqNode) => (st.shareUsed.get(o.id) ?? 0) + amount(inst, o.shareWithin!.units) <= o.shareWithin!.limit + 1e-9
  return inh.shareOwners.find(fits) ?? st.owners.get(inst.key)?.find(fits)
}

function commit(inst: Inst, node: ReqNode, inh: Inherited, st: State, ctx: ProgramContext) {
  const prev = st.used.get(inst.key)
  if (prev) {
    const owner = shareOwner(inst, inh, st)
    if (owner) st.shareUsed.set(owner.id, (st.shareUsed.get(owner.id) ?? 0) + amount(inst, owner.shareWithin!.units))
    prev.push(node.id)
  } else {
    st.used.set(inst.key, [node.id])
    if (inh.shareOwners.length) st.owners.set(inst.key, inh.shareOwners)
  }
  for (const cap of inh.caps) if (matchesRule(cap, inst, ctx.eq)) st.capUsed.set(cap, (st.capUsed.get(cap) ?? 0) + amount(inst, cap.units))
  for (const use of ctx.prior.get(inst.key) ?? []) {
    const other = ctx.versions.get(use.auditId)
    if (!other) continue
    const mine = shareLimit(ctx.version, other, inh.path)
    const theirs = shareLimit(other, ctx.version, use.path)
    const binding = mine.limit <= theirs.limit ? mine : theirs
    if (binding.limit === Infinity) continue
    const k = pairKey(ctx.version.auditId, use.auditId)
    st.crossUsed.set(k, (st.crossUsed.get(k) ?? 0) + amount(inst, binding.units))
  }
}

// ---------------------------------------------------------------------------
// Evaluation

interface Eval {
  node: ReqNode
  state: RequirementState
  kind: 'course' | 'pool' | 'group'
  /** Courses counted directly by this node (leaves). */
  assigned: Inst[]
  /** Courses counted anywhere in the subtree. */
  subtree: Inst[]
  children: Eval[]
  units?: { have: number; planned: number; need: number }
  courses?: { have: number; planned: number; need: number }
  need?: { children: number; of: number }
  manual?: boolean
  skipped?: boolean
  /** Fraction of targets met counting planned work; used to rank alternatives. */
  progress: number
  /** Courses counted through an equivalent rather than the course named; fewer is better. */
  viaEquivalent: number
}

const RANK: Record<RequirementState, number> = { complete: 3, 'complete-with-plan': 2, 'in-progress': 1, missing: 0 }

function sumUnits(insts: Inst[], doneOnly: boolean): number {
  return insts.reduce((n, i) => n + (doneOnly && !i.done ? 0 : i.units), 0)
}

function stateFrom(haveOk: boolean, planOk: boolean, any: boolean): RequirementState {
  return haveOk ? 'complete' : planOk ? 'complete-with-plan' : any ? 'in-progress' : 'missing'
}

function inherit(node: ReqNode, parent: Inherited): Inherited {
  return {
    minGrade: node.minGrade ?? parent.minGrade,
    allowPassFail: parent.allowPassFail || Boolean(node.allowPassFail),
    window: node.window
      ? { from: node.window.from ? termOrdinal(node.window.from) : null, to: node.window.to ? termOrdinal(node.window.to) : null }
      : parent.window,
    excludes: node.exclude?.length ? [...parent.excludes, ...node.exclude] : parent.excludes,
    caps: node.caps?.length ? [...parent.caps, ...node.caps] : parent.caps,
    shareOwners: node.shareWithin ? [node, ...parent.shareOwners] : parent.shareOwners,
    path: [...parent.path, node.id],
  }
}

/** An untouched copy of a subtree, for alternatives that weren't used. */
function emptyEval(node: ReqNode, skipped: boolean): Eval {
  const kind = node.course ? 'course' : node.children.length ? 'group' : 'pool'
  return {
    node,
    state: 'missing',
    kind,
    assigned: [],
    subtree: [],
    children: node.children.map((c) => emptyEval(c, skipped)),
    manual: node.manual || undefined,
    skipped: skipped || undefined,
    progress: 0,
    viaEquivalent: 0,
    ...targetsFor(node, [], []),
  }
}

/** Unit/course progress objects for a node's own targets. */
function targetsFor(node: ReqNode, counted: Inst[], _all: Inst[]): Pick<Eval, 'units' | 'courses'> {
  const out: Pick<Eval, 'units' | 'courses'> = {}
  const unitNeed = Math.max(node.minUnits ?? 0, ...(node.pool ?? node.conditions ?? []).filter((r) => r.units && r.min).map((r) => r.min!))
  if (unitNeed > 0) {
    const have = sumUnits(counted, true)
    out.units = { have, planned: sumUnits(counted, false) - have, need: unitNeed }
  }
  const courseNeed = Math.max(
    node.minCourses ?? 0,
    node.repeat?.times ?? 0,
    ...(node.pool ?? node.conditions ?? []).filter((r) => !r.units && r.min).map((r) => r.min!),
  )
  if (courseNeed > 0) {
    const have = counted.filter((i) => i.done).length
    out.courses = { have, planned: counted.length - have, need: courseNeed }
  }
  return out
}

/** Whether `insts` meet the node's own targets (units, courses, rules, repeat). */
function targetsMet(node: ReqNode, insts: Inst[], eq: Map<string, Set<string>>): boolean {
  if (node.minUnits && sumUnits(insts, false) + 1e-9 < node.minUnits) return false
  if (node.minCourses && insts.length < node.minCourses) return false
  for (const r of node.pool ?? node.conditions ?? []) {
    if (!r.min) continue
    const got = insts.filter((i) => matchesRule(r, i, eq)).reduce((n, i) => n + amount(i, r.units), 0)
    if (got + 1e-9 < r.min) return false
  }
  if (node.repeat) {
    if (node.repeat.sameCourse) {
      const counts = new Map<string, number>()
      for (const i of insts) counts.set(i.id, (counts.get(i.id) ?? 0) + 1)
      if (Math.max(0, ...counts.values()) < node.repeat.times) return false
    } else if (insts.length < node.repeat.times) return false
  }
  return true
}

function progressOf(node: ReqNode, insts: Inst[], eq: Map<string, Set<string>>): number {
  const parts: number[] = []
  if (node.minUnits) parts.push(Math.min(1, sumUnits(insts, false) / node.minUnits))
  if (node.minCourses) parts.push(Math.min(1, insts.length / node.minCourses))
  for (const r of node.pool ?? node.conditions ?? []) {
    if (!r.min) continue
    const got = insts.filter((i) => matchesRule(r, i, eq)).reduce((n, i) => n + amount(i, r.units), 0)
    parts.push(Math.min(1, got / r.min))
  }
  if (node.repeat) parts.push(Math.min(1, insts.length / node.repeat.times))
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : insts.length ? 1 : 0
}

function evalCourseLeaf(node: ReqNode, inh: Inherited, st: State, ctx: ProgramContext): Eval {
  const courseId = node.course!.id
  const times = node.repeat?.times ?? 1
  const assigned: Inst[] = []
  // The course itself before its equivalents. An equivalent that another requirement names outright stays free for
  // that requirement (e.g. 21-122 is listed as equivalent to 21-120, but "Calculus" asks for both by name).
  const candidates = ctx.insts
    .filter((i) => matchesCourse(courseId, i, ctx.eq) && (i.id === courseId || !ctx.named.has(i.id)))
    .sort((a, b) => Number(a.id !== courseId) - Number(b.id !== courseId) || byPreference(a, b))
  for (const inst of candidates) {
    if (assigned.length >= times) break
    if (!canCount(inst, node, inh, st, ctx, true)) continue
    commit(inst, node, inh, st, ctx)
    assigned.push(inst)
  }
  const done = assigned.filter((i) => i.done).length
  return {
    node,
    kind: 'course',
    state: stateFrom(done >= times, assigned.length >= times, assigned.length > 0),
    assigned,
    subtree: assigned,
    children: [],
    progress: Math.min(1, assigned.length / times),
    viaEquivalent: assigned.filter((i) => i.id !== courseId).length,
    ...(times > 1 ? { courses: { have: done, planned: assigned.length - done, need: times } } : {}),
  }
}

function evalPoolLeaf(node: ReqNode, inh: Inherited, st: State, ctx: ProgramContext): Eval {
  const rules = node.pool ?? []
  const repeat = node.repeat
  const inPool = (inst: Inst) =>
    repeat ? repeat.courses.some((c) => matchesCourse(c, inst, ctx.eq)) : rules.some((r) => matchesRule(r, inst, ctx.eq))
  // With no explicit target, a pool asks for one course.
  const hasTarget = Boolean(node.minUnits || node.minCourses || repeat || rules.some((r) => r.min))
  const effective: ReqNode = hasTarget ? node : { ...node, minCourses: 1 }

  const candidates = ctx.insts
    .filter(inPool)
    .sort((a, b) => Number(ctx.named.has(a.id)) - Number(ctx.named.has(b.id)) || byPreference(a, b))

  const assigned: Inst[] = []
  for (const inst of candidates) {
    if (targetsMet(effective, assigned, ctx.eq)) break
    if (!canCount(inst, node, inh, st, ctx, false)) continue
    // Exact/at-most rules on the leaf itself.
    if (rules.some((r) => r.max !== undefined && matchesRule(r, inst, ctx.eq) && assigned.filter((i) => matchesRule(r, i, ctx.eq)).reduce((n, i) => n + amount(i, r.units), 0) + amount(inst, r.units) > r.max + 1e-9)) continue
    if (!contributes(effective, assigned, inst, ctx.eq)) continue
    commit(inst, node, inh, st, ctx)
    assigned.push(inst)
  }
  const done = assigned.filter((i) => i.done)
  return {
    node,
    kind: 'pool',
    state: stateFrom(targetsMet(effective, done, ctx.eq), targetsMet(effective, assigned, ctx.eq), assigned.length > 0),
    assigned,
    subtree: assigned,
    children: [],
    progress: progressOf(effective, assigned, ctx.eq),
    viaEquivalent: 0,
    ...targetsFor(effective, assigned, assigned),
  }
}

/** Whether adding `inst` moves any unmet target forward. */
function contributes(node: ReqNode, current: Inst[], inst: Inst, eq: Map<string, Set<string>>): boolean {
  if (node.minUnits && sumUnits(current, false) < node.minUnits) return true
  if (node.minCourses && current.length < node.minCourses) return true
  for (const r of node.pool ?? []) {
    if (!r.min || !matchesRule(r, inst, eq)) continue
    const got = current.filter((i) => matchesRule(r, i, eq)).reduce((n, i) => n + amount(i, r.units), 0)
    if (got < r.min) return true
  }
  if (node.repeat) return !targetsMet(node, current, eq)
  return false
}

/** True when a subtree names only specific courses (no pools): evaluated first under "all". */
const specificCache = new WeakMap<ReqNode, boolean>()
function onlySpecific(node: ReqNode): boolean {
  let v = specificCache.get(node)
  if (v === undefined) {
    v = node.children.length ? node.children.every(onlySpecific) : Boolean(node.course)
    specificCache.set(node, v)
  }
  return v
}

function activeChildren(node: ReqNode, ctx: ProgramContext): ReqNode[] {
  let kids = node.children
  for (const pd of node.programDependent ?? []) {
    if (!pd.programs.some((p) => ctx.programIds.has(p))) continue
    kids = kids.filter((k) => (pd.include ? pd.children.includes(k.id) : !pd.children.includes(k.id)))
  }
  return kids
}

function evalNode(node: ReqNode, parent: Inherited, st: State, ctx: ProgramContext): Eval {
  const inh = inherit(node, parent)
  if (node.course) return evalCourseLeaf(node, inh, st, ctx)
  if (!node.children.length) {
    if (node.manual && !node.pool && !node.repeat) return { ...emptyEval(node, false), manual: true }
    return evalPoolLeaf(node, inh, st, ctx)
  }
  return evalGroup(node, inh, st, ctx)
}

function evalGroup(node: ReqNode, inh: Inherited, st: State, ctx: ProgramContext): Eval {
  const active = activeChildren(node, ctx)
  const results = new Map<ReqNode, Eval>()
  const chosen: Eval[] = []
  const isCounting = (e: Eval) => !e.manual && !e.skipped
  const subtreeOf = () => {
    const seen = new Map<number, Inst>()
    for (const e of chosen) for (const i of e.subtree) seen.set(i.key, i)
    return [...seen.values()]
  }

  if (node.rule.kind === 'all') {
    const order = [...active].sort((a, b) => Number(onlySpecific(b)) - Number(onlySpecific(a)))
    for (const child of order) {
      const e = evalNode(child, inh, st, ctx)
      results.set(child, e)
      chosen.push(e)
    }
  } else {
    const need = node.rule.kind === 'any' ? 1 : node.rule.n
    let remaining = [...active]
    for (;;) {
      const satisfied = chosen.filter((e) => isCounting(e) && RANK[e.state] >= 2).length
      if (satisfied >= need && targetsMet(node, subtreeOf(), ctx.eq)) break
      let best: { child: ReqNode; e: Eval; st: State; i: number } | null = null
      remaining.forEach((child, i) => {
        const trial = st.clone()
        const e = evalNode(child, inh, trial, ctx)
        if (e.manual || RANK[e.state] === 0) return
        if (
          !best ||
          RANK[e.state] > RANK[best.e.state] ||
          (RANK[e.state] === RANK[best.e.state] &&
            (e.progress > best.e.progress + 1e-9 ||
              (Math.abs(e.progress - best.e.progress) < 1e-9 &&
                (e.viaEquivalent < best.e.viaEquivalent ||
                  (e.viaEquivalent === best.e.viaEquivalent && e.subtree.length < best.e.subtree.length)))))
        ) {
          best = { child, e, st: trial, i }
        }
      })
      if (!best) break
      const b = best as { child: ReqNode; e: Eval; st: State; i: number }
      // Commit the winner's assignments.
      st.used = b.st.used
      st.owners = b.st.owners
      st.shareUsed = b.st.shareUsed
      st.capUsed = b.st.capUsed
      st.crossUsed = b.st.crossUsed
      results.set(b.child, b.e)
      chosen.push(b.e)
      remaining = remaining.filter((c) => c !== b.child)
    }
  }

  const subtree = subtreeOf()
  const counting = chosen.filter(isCounting)
  const groupSatisfiedByPlan = () => {
    const need = node.rule.kind === 'all' ? counting.length : node.rule.kind === 'any' ? 1 : node.rule.n
    return counting.filter((e) => RANK[e.state] >= 2).length >= need
  }

  // Children in display order; unused alternatives and inapplicable conditional rules are "skipped".
  const allSatisfied = groupSatisfiedByPlan() && targetsMet(node, subtree, ctx.eq)
  const children = node.children.map((child) => {
    if (!active.includes(child)) return emptyEval(child, true)
    const e = results.get(child)
    if (e) {
      if (child.onlyIfAttempted && !e.subtree.length) return { ...e, skipped: true }
      return e
    }
    return emptyEval(child, allSatisfied && node.rule.kind !== 'all')
  })

  // Options that count toward the rule: unused alternatives still count as options.
  const evaluable = children.filter((e) => active.includes(e.node) && !e.manual && !(e.node.onlyIfAttempted && !e.subtree.length))
  const ruleOf = evaluable.length
  const ruleNeed = node.rule.kind === 'all' ? ruleOf : Math.min(node.rule.kind === 'any' ? 1 : node.rule.n, ruleOf)
  const doneCount = evaluable.filter((e) => e.state === 'complete').length
  const planCount = evaluable.filter((e) => RANK[e.state] >= 2).length
  const done = subtree.filter((i) => i.done)
  const hasTargets = Boolean(node.minUnits || node.minCourses || node.conditions?.some((r) => r.min))
  const manualOnly = ruleOf === 0 && !hasTargets && children.some((e) => e.manual)

  const haveOk = doneCount >= ruleNeed && targetsMet(node, done, ctx.eq) && (ruleOf > 0 || hasTargets)
  const planOk = planCount >= ruleNeed && targetsMet(node, subtree, ctx.eq) && (ruleOf > 0 || hasTargets)
  const childProgress = evaluable.length
    ? evaluable
        .map((e) => e.progress)
        .sort((a, b) => b - a)
        .slice(0, Math.max(1, ruleNeed))
        .reduce((a, b) => a + b, 0) / Math.max(1, ruleNeed)
    : 0
  return {
    node,
    kind: 'group',
    state: manualOnly ? 'missing' : stateFrom(haveOk, planOk, subtree.length > 0),
    assigned: [],
    subtree,
    children,
    need: { children: ruleNeed, of: ruleOf },
    manual: manualOnly || undefined,
    progress: hasTargets ? (childProgress + progressOf(node, subtree, ctx.eq)) / 2 : childProgress,
    viaEquivalent: chosen.reduce((n, e) => n + e.viaEquivalent, 0),
    ...targetsFor(node, subtree, subtree),
  }
}

// ---------------------------------------------------------------------------
// Result conversion

function sectionNote(node: ReqNode): string[] {
  return node.course?.section ? [`Only section ${node.course.section} counts`] : []
}

function toResult(e: Eval): RequirementResult {
  const notes = [...sectionNote(e.node), ...e.node.notes]
  const unverified = e.assigned.some((i) => i.course.status !== 'credit' && e.node.minGrade && meetsMinGrade(i.course.grade, e.node.minGrade) === 'unverified')
  if (unverified) notes.push(`Needs a ${e.node.minGrade} or better; a pass/fail grade can't confirm that`)
  return {
    nodeId: e.node.id,
    name: e.node.name,
    state: e.state,
    assigned: e.assigned.map((i) => ({ courseId: i.id, units: i.units, term: i.course.term, status: i.course.status })),
    ...(e.units ? { units: e.units } : {}),
    ...(e.courses ? { courses: e.courses } : {}),
    notes,
    children: e.children.map(toResult),
    kind: e.kind,
    ...(e.node.course ? { courseId: e.node.course.id } : {}),
    ...(e.need ? { need: e.need } : {}),
    ...(e.manual ? { manual: true } : {}),
    ...(e.skipped ? { skipped: true } : {}),
  }
}

function countManual(r: RequirementResult): number {
  if (r.skipped) return 0
  return (r.manual ? 1 : 0) + r.children.reduce((n, c) => n + countManual(c), 0)
}

function namedCourses(node: ReqNode, out = new Set<string>()): Set<string> {
  if (node.course) out.add(node.course.id)
  for (const c of node.children) namedCourses(c, out)
  return out
}

// ---------------------------------------------------------------------------
// Entry point

interface Planned {
  version: ProgramVersion
  attachedTo?: number
  concentrations?: number[]
}

/** Selected programs, each followed by the bundles it brings in (gen-ed, chosen concentrations). */
function auditOrder(input: AuditInput, versions: Map<number, ProgramVersion>): Planned[] {
  const out: Planned[] = []
  const seen = new Set<number>()
  const add = (p: Planned) => {
    if (seen.has(p.version.auditId)) return
    seen.add(p.version.auditId)
    out.push(p)
  }
  for (const sel of input.programs) {
    const v = versions.get(sel.auditId)
    if (!v) continue
    add({ version: v, concentrations: sel.concentrations })
    for (const id of sel.concentrations ?? []) {
      const c = v.concentrations.find((x) => x.id === id)
      const bundle = c?.programs.map((p) => versions.get(p.auditId)).find(Boolean)
      if (bundle) add({ version: bundle, attachedTo: v.catalogId })
    }
  }
  // Attached bundles after every selected program, so majors claim courses first.
  for (const p of [...out]) {
    if (p.attachedTo !== undefined) continue
    for (const a of p.version.attached) {
      const v = a.auditId !== null ? versions.get(a.auditId) : undefined
      if (v) add({ version: v, attachedTo: p.version.catalogId })
    }
  }
  return out
}

/** Program versions an audit needs beyond the selected ones (attached bundles, concentrations). */
export function relatedAuditIds(input: AuditInput, versions: Map<number, ProgramVersion>): number[] {
  const out = new Set<number>()
  for (const sel of input.programs) {
    const v = versions.get(sel.auditId)
    if (!v) continue
    for (const a of v.attached) if (a.auditId !== null) out.add(a.auditId)
    for (const id of sel.concentrations ?? []) {
      const best = v.concentrations.find((c) => c.id === id)?.programs[0]
      if (best) out.add(best.auditId)
    }
  }
  for (const sel of input.programs) out.delete(sel.auditId)
  return [...out]
}

export function runAudit(input: AuditInput, versions: Map<number, ProgramVersion>, catalog: CatalogIndex | null): AuditResult {
  const insts = toInstances(input.courses, catalog)
  const eq = buildEquivalence(catalog)
  const order = auditOrder(input, versions)
  const programIds = new Set(order.map((p) => p.version.catalogId))
  const prior = new Map<number, PriorUse[]>()
  const counted = new Set<number>()
  const programs: ProgramAuditResult[] = []

  for (const p of order) {
    const v = p.version
    const ctx: ProgramContext = { version: v, insts, eq, named: namedCourses(v.root), prior, versions, programIds }
    const st = new State()
    const rootInh: Inherited = { allowPassFail: false, excludes: [], caps: [], shareOwners: [], path: [] }
    const e = evalNode(v.root, rootInh, st, ctx)

    // Record what this program counted (with where), for the programs after it.
    const paths = new Map<number, number[]>()
    const walk = (x: Eval, path: number[]) => {
      const here = [...path, x.node.id]
      for (const i of x.assigned) paths.set(i.key, here)
      for (const c of x.children) walk(c, here)
    }
    walk(e, [])
    for (const [key, path] of paths) {
      const list = prior.get(key) ?? []
      list.push({ auditId: v.auditId, path })
      prior.set(key, list)
      counted.add(key)
    }

    const root = toResult(e)
    let state = root.state
    let totalUnits: ProgramAuditResult['totalUnits']
    if (v.totalUnits) {
      const excluded = (i: Inst) => (v.root.exclude ?? []).some((s) => matchesSet(s, i, eq))
      const eligible = insts.filter((i) => !excluded(i))
      const have = sumUnits(eligible, true)
      totalUnits = { have, planned: sumUnits(eligible, false) - have, need: v.totalUnits }
      if (state === 'complete' && have + 1e-9 < v.totalUnits) state = have + totalUnits.planned + 1e-9 >= v.totalUnits ? 'complete-with-plan' : 'in-progress'
      else if (state === 'complete-with-plan' && have + totalUnits.planned + 1e-9 < v.totalUnits) state = 'in-progress'
    }
    programs.push({
      catalogId: v.catalogId,
      auditId: v.auditId,
      name: v.programName,
      programName: v.programName,
      versionName: v.name,
      kind: v.kind,
      state,
      root,
      ...(totalUnits ? { totalUnits } : {}),
      ...(p.attachedTo !== undefined ? { attachedTo: p.attachedTo } : {}),
      manualCount: countManual(root),
    })
  }

  const unassigned: string[] = []
  for (const i of insts) if (!counted.has(i.key) && !unassigned.includes(i.id)) unassigned.push(i.id)
  return { programs, unassigned }
}

// ---------------------------------------------------------------------------
// Helpers for UIs

/** Catalog courses that could satisfy a requirement node, for "ways to satisfy" lists. */
export function courseOptions(node: ReqNode, catalog: CatalogIndex, limit = 60): string[] {
  if (node.course) return [node.course.id]
  if (node.repeat) return node.repeat.courses
  const rules = node.pool ?? node.conditions ?? []
  if (!rules.length) {
    const out: string[] = []
    for (const c of node.children) for (const id of courseOptions(c, catalog, limit)) if (!out.includes(id) && out.length < limit) out.push(id)
    return out
  }
  const eq = new Map<string, Set<string>>()
  const out: string[] = []
  for (const id of Object.keys(catalog.courses).sort()) {
    const inst: Inst = { key: 0, course: { courseId: id, term: null, status: 'planned', units: 0, passFail: false }, id, units: catalog.courses[id].units ?? 0, ord: null, done: false, passFail: false, pfOnly: false }
    if (node.exclude?.some((s) => matchesSet(s, inst, eq))) continue
    if (node.minUnitsEach && inst.units < node.minUnitsEach) continue
    // A pool that matches everything isn't a useful list.
    if (rules.every((r) => r.sets.some((s) => s.any) && !r.inverse)) return []
    if (rules.some((r) => matchesRule(r, inst, eq))) {
      out.push(id)
      if (out.length >= limit) break
    }
  }
  return out
}

/** Finds a node by id in a version's tree. */
export function findNode(root: ReqNode, id: number): ReqNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

/** A short description of what a node asks for, e.g. "2 of 5", "27 units", "1 course from the list". */
export function describeTarget(node: ReqNode): string | null {
  const parts: string[] = []
  if (node.children.length) {
    if (node.rule.kind === 'any' && node.children.length > 1) parts.push(`1 of ${node.children.length}`)
    if (node.rule.kind === 'atLeast') parts.push(`${node.rule.n} of ${node.children.length}`)
  }
  const units = Math.max(node.minUnits ?? 0, ...(node.pool ?? node.conditions ?? []).filter((r) => r.units && r.min).map((r) => r.min!))
  const courses = Math.max(node.minCourses ?? 0, ...(node.pool ?? node.conditions ?? []).filter((r) => !r.units && r.min).map((r) => r.min!))
  if (courses) parts.push(`${courses} course${courses === 1 ? '' : 's'}`)
  if (units) parts.push(`${units} units`)
  if (node.repeat) parts.push(`${node.repeat.times}×`)
  if (node.minGrade) parts.push(`${node.minGrade} or better`)
  return parts.length ? parts.join(', ') : null
}

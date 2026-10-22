// Which courses can count toward a degree requirement, independent of any student's record:
// powers the explorer's "Counts toward a requirement" filter and the course page's "Counts toward" list.
//
// A course is accepted by a requirement when it matches one of the requirement's leaves (a named course or its
// equivalents, a repeat list, or a pool rule) and isn't excluded by the leaf or any ancestor. Unit/course targets,
// caps and double-counting limits don't affect whether a course *can* count, so they're ignored here.

import { courseMatchesRule, courseMatchesSet, describeTarget } from './audit'
import type { CatalogIndex } from './catalog-types'
import type { PoolSet, ProgramVersion, ReqNode } from './degree-types'
import { buildEquivalence, termOrdinal } from './requisites'

export interface MatchOptions {
  /** Term the course would be taken in, so windows like "only from F25" apply. Omit to ignore windows. */
  term?: string | null
  /** Catalog ids of the student's programs, for "for plans with X, only these options count" rules. */
  programIds?: Iterable<number>
  /** A course's units, for "each course must carry N units"; defaults to the catalog. */
  unitsOf?(courseId: string): number | null | undefined
}

interface Ctx {
  eq: Map<string, Set<string>>
  ord: number | null
  programIds: Set<number>
  unitsOf(courseId: string): number | null | undefined
}

const eqCache = new WeakMap<CatalogIndex, Map<string, Set<string>>>()
const EMPTY_EQ = new Map<string, Set<string>>()

function makeCtx(catalog: CatalogIndex | null, opts: MatchOptions = {}): Ctx {
  let eq = EMPTY_EQ
  if (catalog) {
    eq = eqCache.get(catalog) ?? buildEquivalence(catalog)
    eqCache.set(catalog, eq)
  }
  return {
    eq,
    ord: opts.term ? termOrdinal(opts.term) : null,
    programIds: new Set(opts.programIds ?? []),
    unitsOf: opts.unitsOf ?? ((id) => catalog?.courses[id]?.units),
  }
}

interface Inherited {
  excludes: PoolSet[]
  window: { from: number | null; to: number | null } | null
}

const ROOT_INH: Inherited = { excludes: [], window: null }

function inherit(node: ReqNode, parent: Inherited): Inherited {
  return {
    excludes: node.exclude?.length ? [...parent.excludes, ...node.exclude] : parent.excludes,
    window: node.window
      ? { from: node.window.from ? termOrdinal(node.window.from) : null, to: node.window.to ? termOrdinal(node.window.to) : null }
      : parent.window,
  }
}

/** Children that apply given the student's programs ("for plans with BS CS, only Category 1 counts"). */
function activeChildren(node: ReqNode, programIds: Set<number>): ReqNode[] {
  let kids = node.children
  for (const pd of node.programDependent ?? []) {
    if (!pd.programs.some((p) => programIds.has(p))) continue
    kids = kids.filter((k) => (pd.include ? pd.children.includes(k.id) : !pd.children.includes(k.id)))
  }
  return kids
}

const isLeaf = (n: ReqNode) => !n.children.length

/**
 * A leaf pool that admits essentially any course (an "any course" set or a "does not match" rule). Useless as a
 * filter and noise in "counts toward" lists, so groups ignore broad leaves unless the broad leaf is the target.
 */
export function isBroad(node: ReqNode): boolean {
  if (!isLeaf(node) || node.course || node.repeat) return false
  return (node.pool ?? []).some((r) => r.inverse || r.sets.some((s) => s.any))
}

function leafAccepts(leaf: ReqNode, id: string, inh: Inherited, ctx: Ctx): boolean {
  const named = (c: string) => c === id || Boolean(ctx.eq.get(c)?.has(id))
  let hit: boolean
  if (leaf.course) hit = named(leaf.course.id)
  else if (leaf.repeat) hit = leaf.repeat.courses.some(named)
  else if (leaf.pool?.length) hit = leaf.pool.some((r) => courseMatchesRule(r, id, ctx.ord, ctx.eq))
  else hit = false
  if (!hit) return false
  if (inh.window && ctx.ord !== null) {
    if (inh.window.from !== null && ctx.ord < inh.window.from) return false
    if (inh.window.to !== null && ctx.ord > inh.window.to) return false
  }
  if (inh.excludes.some((s) => courseMatchesSet(s, id, ctx.ord, ctx.eq))) return false
  if (leaf.minUnitsEach) {
    const units = ctx.unitsOf(id)
    if (units != null && units < leaf.minUnitsEach) return false
  }
  return true
}

interface LeafRef {
  leaf: ReqNode
  inh: Inherited
}

/** Leaves under `node` (itself when it's a leaf), with what they inherit. */
function leavesUnder(node: ReqNode, parent: Inherited, ctx: Ctx, includeBroad: boolean): LeafRef[] {
  const inh = inherit(node, parent)
  if (isLeaf(node)) return includeBroad || !isBroad(node) ? [{ leaf: node, inh }] : []
  return activeChildren(node, ctx.programIds).flatMap((c) => leavesUnder(c, inh, ctx, false))
}

/** Root → node chain, or null when the id isn't in the tree. */
function pathTo(root: ReqNode, id: number): ReqNode[] | null {
  if (root.id === id) return [root]
  for (const c of root.children) {
    const rest = pathTo(c, id)
    if (rest) return [root, ...rest]
  }
  return null
}

/** Whether `courseId` can count toward `node` (looking only at the node and its subtree). */
export function nodeAccepts(node: ReqNode, courseId: string, catalog: CatalogIndex | null, opts?: MatchOptions): boolean {
  const ctx = makeCtx(catalog, opts)
  return leavesUnder(node, ROOT_INH, ctx, true).some(({ leaf, inh }) => leafAccepts(leaf, courseId, inh, ctx))
}

/**
 * A fast predicate for one requirement of a program version, honoring exclusions and windows inherited from its
 * ancestors. Compile once per selected requirement, then call for every course. Null when the node doesn't exist.
 */
export function compileAcceptor(version: ProgramVersion, nodeId: number, catalog: CatalogIndex | null, opts?: MatchOptions): ((courseId: string) => boolean) | null {
  const chain = pathTo(version.root, nodeId)
  if (!chain) return null
  const ctx = makeCtx(catalog, opts)
  let inh = ROOT_INH
  for (const n of chain.slice(0, -1)) inh = inherit(n, inh)
  const leaves = leavesUnder(chain[chain.length - 1], inh, ctx, true)
  // Named courses (and their equivalents) are a set lookup; pools are checked rule by rule.
  const memo = new Map<string, boolean>()
  return (courseId) => {
    let v = memo.get(courseId)
    if (v === undefined) {
      v = leaves.some(({ leaf, inh: li }) => leafAccepts(leaf, courseId, li, ctx))
      memo.set(courseId, v)
    }
    return v
  }
}

// ---------------------------------------------------------------------------
// Flattened requirement lists

export interface FlatRequirement {
  auditId: number
  nodeId: number
  name: string
  /** Names of the enclosing requirements below the program root, outermost first. */
  path: string[]
  /** Indent level in the list (0 = directly under the program). */
  depth: number
  /** What the node asks for, e.g. "1 course", "27 units", "1 of 2". */
  target: string | null
  /** Accepts nearly any course. */
  broad: boolean
}

/** Group or pool nodes worth filtering by: no single-course leaves, no advisor-only checks, no pass-through wrappers. */
function selectable(node: ReqNode): boolean {
  if (node.course || node.repeat) return false
  if (isLeaf(node)) return Boolean(node.pool?.length)
  return true
}

/** A group that only wraps one child and asks for nothing itself; its child takes its place. */
function isWrapper(node: ReqNode): boolean {
  return node.children.length === 1 && !describeTarget(node) && !node.pool && !node.course && !node.exclude?.length
}

/**
 * The program's requirements as an indented list, in tree order, for pickers. With `programIds`, options that
 * don't apply to those programs (e.g. the AI-only Category 1A for a CS student) are left out.
 */
export function flattenRequirements(version: ProgramVersion, programIds?: Iterable<number>): FlatRequirement[] {
  const ids = new Set(programIds ?? [])
  const out: FlatRequirement[] = []
  const walk = (node: ReqNode, path: string[], depth: number) => {
    if (isWrapper(node)) {
      const child = node.children[0]
      // Keep the wrapper's name in the path unless the child repeats it.
      const keep = !child.name.toLowerCase().startsWith(node.name.toLowerCase())
      walk(child, keep ? [...path, node.name] : path, depth)
      return
    }
    if (!selectable(node)) return
    if (!node.manual || node.pool?.length || node.children.length) {
      out.push({ auditId: version.auditId, nodeId: node.id, name: node.name, path, depth, target: describeTarget(node), broad: isBroad(node) })
    }
    for (const c of activeChildren(node, ids)) walk(c, [...path, node.name], depth + 1)
  }
  for (const c of activeChildren(version.root, ids)) walk(c, [], 0)
  return out
}

// ---------------------------------------------------------------------------
// Requirements one course can count toward

export interface CourseRequirementMatch {
  auditId: number
  programName: string
  versionName: string
  /** The requirement to show: a choice group for named courses, else the leaf itself. */
  nodeId: number
  /** The requirement to filter the explorer by (a lone named course filters by its enclosing requirement). */
  filterNodeId: number
  name: string
  /** Enclosing requirement names below the program root. */
  path: string[]
  target: string | null
}

/**
 * Requirements across `versions` that `courseId` could count toward. Reports the most specific useful node: a
 * pool leaf, or for a named course the "pick one of these" group it belongs to. Broad pools are skipped.
 */
export function requirementsForCourse(
  versions: Iterable<ProgramVersion>,
  courseId: string,
  catalog: CatalogIndex | null,
  opts?: MatchOptions,
): CourseRequirementMatch[] {
  const ctx = makeCtx(catalog, opts)
  const out: CourseRequirementMatch[] = []
  for (const version of versions) {
    const seen = new Set<number>()
    const walk = (node: ReqNode, parent: ReqNode | null, inh: Inherited, names: string[]) => {
      const here = inherit(node, inh)
      if (isLeaf(node)) {
        if (isBroad(node) || !leafAccepts(node, courseId, here, ctx)) return
        // A named course inside "any of" / "at least n of": the choice is the requirement.
        const choice = (node.course || node.repeat) && parent && parent !== version.root && parent.rule.kind !== 'all' ? parent : null
        const report = choice ?? node
        if (seen.has(report.id)) return
        seen.add(report.id)
        const path = choice ? names.slice(0, -1) : names
        const lone = !choice && (node.course || node.repeat) && parent && parent !== version.root
        out.push({
          auditId: version.auditId,
          programName: version.programName,
          versionName: version.name,
          nodeId: report.id,
          filterNodeId: lone ? parent.id : report.id,
          name: report.name,
          path: path.filter((p, i) => i === 0 || p !== path[i - 1]),
          target: describeTarget(report),
        })
        return
      }
      const nextNames = node === version.root ? names : [...names, node.name]
      for (const c of activeChildren(node, ctx.programIds)) walk(c, node, here, nextNames)
    }
    walk(version.root, null, ROOT_INH, [])
  }
  return out
}

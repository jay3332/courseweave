// Normalized degree-program requirement trees, written by scripts/build-programs.ts to
// public/data/programs/<auditId>.json and evaluated by src/lib/audit.ts.
//
// Source: Stellic audit versions (ScottyLabs export). Stellic expresses each requirement as a node
// with `choices` (children) and `constraints`; build-programs folds the constraints we can evaluate
// into the fields below and keeps the rest as human-readable `notes`.

import type { ProgramKind } from './plan-types.ts'

/** A set of courses, matched against five-digit course ids ("15122"). Fields are unioned. */
export interface PoolSet {
  /** Explicit courses (equivalent courses also match). */
  courses?: string[]
  /** Inclusive numeric ranges over five-digit ids, e.g. ["15200", "15999"]. */
  ranges?: [string, string][]
  /** Ranges that apply in any department, over the last three digits, e.g. [0, 599]. */
  anyDeptRanges?: [number, number][]
  /** Two-digit department prefixes ("21" = any 21-xxx course). */
  depts?: string[]
  /** Regex sources over five-digit ids, for wildcard codes like "15-3**". */
  patterns?: string[]
  /** Any course at all. */
  any?: boolean
  /** Only courses taken in this window (term codes like "F25", inclusive). */
  from?: string
  to?: string
}

/** "Take at least/at most `n` courses (or units) from these sets." */
export interface CountRule {
  sets: PoolSet[]
  /** Courses that do NOT match `sets` (Stellic "does not match the following"). */
  inverse?: boolean
  /** Count units instead of courses. */
  units: boolean
  /** At least this many; absent = the rule only restricts which courses may count. */
  min?: number
  /** At most this many may count. */
  max?: number
  /** All counted courses must share one subject code (first two digits), e.g. "2 courses, same department". */
  sameDept?: boolean
  /** Every counted course must come from a different subject code. */
  differentDepts?: boolean
}

export type GroupRule = { kind: 'all' } | { kind: 'any' } | { kind: 'atLeast'; n: number }

export interface ReqNode {
  /** Stellic requirement id (unique within a version). */
  id: number
  name: string
  /** How children combine. Leaves have no children. */
  rule: GroupRule
  children: ReqNode[]

  /** Leaf: one specific course, optionally restricted to one section (topics courses). */
  course?: { id: string; section?: string }
  /** Leaf: courses come from a pool; every rule with a `min` must be met. */
  pool?: CountRule[]
  /** Group: extra at-least rules over the courses counted anywhere in the subtree. */
  conditions?: CountRule[]
  /** At-most limits on the courses counted in this subtree. */
  caps?: CountRule[]
  /** Courses that may not count in this subtree. */
  exclude?: PoolSet[]
  /** Unit / course targets over the courses counted here (leaf) or in the subtree (group). */
  minUnits?: number
  minCourses?: number
  /** Each counted course must carry at least this many units. */
  minUnitsEach?: number
  /** Take `courses` (any combination, or the same one when `sameCourse`) `times` times. */
  repeat?: { courses: string[]; times: number; sameCourse: boolean }

  /** Inherited by the subtree. */
  minGrade?: string
  /** Inherited: pass/fail (non-letter) grades may count here. */
  allowPassFail?: boolean
  /** Inherited: only courses taken in this window count. */
  window?: { from?: string; to?: string }
  /** Courses counted here may also count toward other requirements of the same program. */
  shareWithin?: { limit: number; units: boolean }
  /**
   * "For plans with program X, only (include) / never (exclude) these children can be used."
   * Applied when any audited program's catalog id is in `programs`.
   */
  programDependent?: { programs: number[]; children: number[]; include: boolean }[]

  /** Satisfied by an advisor or registrar check (GPA, milestones, manual approval). */
  manual?: boolean
  /** Only applies once the student has taken one of its courses (Stellic "hide unless attempted"). */
  onlyIfAttempted?: boolean
  /** Rules shown to the student but not evaluated. */
  notes: string[]
}

/** Limit on courses shared between this program and others. */
export interface DoubleCountRule {
  /** Catalog ids this rule applies to; empty (and no `kinds`) = every other program. */
  programs: number[]
  /** Program kinds this rule applies to ("with minor programs"). */
  kinds?: ProgramKind[]
  /** Programs' display names, for messages. */
  programNames: string[]
  limit: number
  units: boolean
  /** Requirement ids in this program where sharing is allowed up to `limit` regardless. */
  exceptions: { nodes: number[]; limit: number; units: boolean }[]
}

export interface AttachedProgram {
  catalogId: number
  name: string
  /** Version chosen at build time for this program's entry year/campus; null if not exported. */
  auditId: number | null
}

export interface ConcentrationInfo {
  /** Stellic concentration id (ProgramSelection.concentrations). */
  id: number
  name: string
  /** Requirement bundles that likely implement it, best match first. */
  programs: { catalogId: number; auditId: number; name: string }[]
}

export interface ProgramVersion {
  auditId: number
  catalogId: number
  /** Program name, e.g. "BS in Computer Science". */
  programName: string
  /** Version name, e.g. "EY2025 Pittsburgh". */
  name: string
  kind: ProgramKind
  entryYear: number | null
  campus: string | null
  /** Overall unit minimum for the degree (root "at least N units"). */
  totalUnits: number | null
  /** College gen-ed and degree-check bundles audited alongside this program. */
  attached: AttachedProgram[]
  doubleCount: DoubleCountRule[]
  concentrations: ConcentrationInfo[]
  root: ReqNode
}

// Contract between the degree plan (semester grid, record) and the requirement audit engine.

/** A course as the audit sees it: taken, credited, or planned for a term. */
export interface PlannedCourse {
  /** Five-digit course id ("15122"). */
  courseId: string
  /** SIO-style term ("F25", "S27", "M26"); null for credit that isn't tied to a term (AP, transfer). */
  term: string | null
  status: 'completed' | 'in-progress' | 'planned' | 'credit'
  /** Letter or P/N/S/etc. when known. */
  grade?: string
  units: number
  /** Graded pass/fail (course is P/F-only or elected) — non-factorable. */
  passFail: boolean
  /** Where it came from, for display ("AP Calculus BC (5)", "Transfer: Pitt MATH 0230"). */
  source?: string
}

/** Which program versions a student is auditing against. */
export interface ProgramSelection {
  /** Stellic catalog program id. */
  catalogId: number
  /** Specific audit version (entry year / campus). */
  auditId: number
  /** Chosen concentration ids, for programs that have them. */
  concentrations?: number[]
}

export interface AuditInput {
  programs: ProgramSelection[]
  courses: PlannedCourse[]
}

export type RequirementState = 'complete' | 'complete-with-plan' | 'in-progress' | 'missing'

/** Audit result for one requirement node (mirrors the program tree). */
export interface RequirementResult {
  nodeId: number
  name: string
  state: RequirementState
  /** Courses assigned to this node (and how many units each contributes). */
  assigned: { courseId: string; units: number; term: string | null; status: PlannedCourse['status'] }[]
  /**
   * Progress toward the node's own targets, when it has them.
   * `have` counts completed courses and credit; `planned` counts planned/in-progress courses on top of that.
   */
  units?: { have: number; planned: number; need: number }
  courses?: { have: number; planned: number; need: number }
  /** Human-readable rules that weren't evaluated (GPA, permissions, …). */
  notes: string[]
  children: RequirementResult[]
  /** 'course': one specific course; 'pool': take courses from a set; 'group': combines children. */
  kind?: 'course' | 'pool' | 'group'
  /** For course leaves: the course it asks for. */
  courseId?: string
  /** For groups: how many children must be complete, out of how many count. */
  need?: { children: number; of: number }
  /** Checked by an advisor or the registrar (GPA, milestones, approvals); not evaluated. */
  manual?: boolean
  /** An alternative the parent didn't need (it's satisfied another way), or a conditional rule that doesn't apply. */
  skipped?: boolean
}

export interface ProgramAuditResult {
  catalogId: number
  auditId: number
  name: string
  state: RequirementState
  root: RequirementResult
  /** Overall unit target for the degree, if the program defines one (have/planned as in RequirementResult). */
  totalUnits?: { have: number; planned: number; need: number }
  /** Program and version names, e.g. "BS in Computer Science", "EY2025 Pittsburgh". */
  programName?: string
  versionName?: string
  kind?: ProgramKind
  /** Set for bundles audited automatically (college gen-ed, concentrations): the selected program's catalog id. */
  attachedTo?: number
  /** Requirements that need a manual check and so can't be confirmed here. */
  manualCount?: number
}

export interface AuditResult {
  programs: ProgramAuditResult[]
  /** Courses that didn't count toward any requirement (free electives). */
  unassigned: string[]
}

// ---- Programs data (public/data/programs/, written by scripts/build-programs.ts) ----

export type ProgramKind = 'major' | 'minor' | 'additional-major' | 'requirements' | 'track'

export interface ProgramVersionInfo {
  auditId: number
  /** e.g. "EY2025 Pittsburgh". */
  name: string
  /** Entry year the version applies to, parsed from "EY2025"; null if unknown. */
  entryYear: number | null
  campus: string | null
}

export interface ProgramInfo {
  catalogId: number
  /** e.g. "BS in Computer Science". */
  name: string
  kind: ProgramKind
  /** Newest entry year first. */
  versions: ProgramVersionInfo[]
}

/** public/data/programs/index.json. Each version's tree is at public/data/programs/<auditId>.json. */
export interface ProgramsIndex {
  generatedAt: string
  programs: ProgramInfo[]
}

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
  /** Progress toward the node's own targets, when it has them. */
  units?: { have: number; planned: number; need: number }
  courses?: { have: number; planned: number; need: number }
  /** Human-readable rules that weren't evaluated (GPA, permissions, …). */
  notes: string[]
  children: RequirementResult[]
}

export interface ProgramAuditResult {
  catalogId: number
  auditId: number
  name: string
  state: RequirementState
  root: RequirementResult
  /** Overall unit target for the degree, if the program defines one. */
  totalUnits?: { have: number; planned: number; need: number }
}

export interface AuditResult {
  programs: ProgramAuditResult[]
  /** Courses that didn't count toward any requirement (free electives). */
  unassigned: string[]
}

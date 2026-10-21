// Term-independent course catalog: descriptions, requisites, grading. Produced by scripts/build-catalog.ts.
//
// Files (public/data/catalog/):
//   index.json          CatalogIndex: every course's requisites + grading, small enough to load whole.
//                       Used for requisite checks, "unlocks", and the degree planner.
//   details/<NN>.json   Record<courseId, CatalogDetails> for course numbers starting with NN (lazy, per page).

/** A requisite expression. Course ids are five digits without the dash ("15122"). */
export type Requisite =
  | { type: 'course'; id: string; /** e.g. "C"; absent when any passing grade works. */ minGrade?: string }
  | { type: 'all'; items: Requisite[] }
  | { type: 'any'; items: Requisite[] }
  /** At least `n` of the items (n < items.length; n === length is "all", n === 1 is "any"). */
  | { type: 'atLeast'; n: number; items: Requisite[] }
  /** A condition that isn't a course (class standing, instructor permission, …). Shown, never auto-checked. */
  | { type: 'text'; text: string }

export interface CatalogEntry {
  id: string
  code: string
  title: string
  /** Fixed units, or the minimum for variable-unit courses; null if unknown. */
  units: number | null
  /** Set for variable-unit courses. */
  unitsMax?: number
  /** Prerequisites; null when none. */
  prereqs: Requisite | null
  /** The catalog's own prerequisite wording, when it has one. */
  prereqText?: string
  /** Corequisites: any one of these must be taken before or in the same semester. */
  coreqs: string[]
  /** Anti-requisites: can't receive credit for both. */
  antireqs: string[]
  /** Equivalent courses (count as each other for requisites). */
  equivalents: string[]
  /** Graded pass/fail only; units are not factorable. */
  passFail: boolean
  /** Seasons the course is normally offered in, from catalog tags. */
  offered?: ('fall' | 'spring' | 'summer')[]
  /** Offered irregularly. */
  intermittent?: boolean
  repeatable?: boolean
}

export interface CatalogIndex {
  generatedAt: string
  courses: Record<string, CatalogEntry>
}

export interface CatalogDetails {
  description?: string
  website?: string
  /** Skill/attribute tags, e.g. "discussion intensive". */
  attributes?: string[]
  /** Schedule of Classes notes (enrollment caveats, reservations). */
  notes?: string
  /** Enrollment requires special permission. */
  permissionRequired?: boolean
  /** Curated profile fields, when the department provided them. */
  profile?: {
    goals?: string
    keyTopics?: string
    assessment?: string
    resources?: string
    background?: string
    relevance?: string
  }
}

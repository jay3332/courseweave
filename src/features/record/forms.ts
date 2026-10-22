// Pure builders for the record page's add forms: turn what's typed into a record entry, or null when
// the form isn't complete or valid yet. Components use them both to enable "Add" and to build the entry.
import type { RecordEntry } from '../../state/record'

export type NewEntry = Omit<RecordEntry, 'id' | 'addedAt'>

const COURSE_ID = /^\d{5}$/

/**
 * A units field. Empty → undefined (use the catalog's units); invalid → null.
 * Accepts decimals with a dot or comma ("4.5", "4,5").
 */
export function parseUnits(text: string): number | undefined | null {
  const t = text.trim().replace(',', '.')
  if (!t) return undefined
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n <= 99 ? n : null
}

/** Whether a units field should show an error (non-empty but not a number). */
export function unitsError(text: string): string | null {
  return parseUnits(text) === null ? 'Enter units as a number, like 9 or 4.5.' : null
}

export interface TakenDraft {
  courseId: string | null
  term: string
  grade: string
  units: string
  /** The course's catalog units; units equal to these aren't stored, so catalog updates still apply. */
  catalogUnits: number | null | undefined
}

export function takenEntry(d: TakenDraft): NewEntry | null {
  if (!d.courseId || !COURSE_ID.test(d.courseId)) return null
  const units = parseUnits(d.units)
  if (units === null) return null
  return {
    courseId: d.courseId,
    source: 'taken',
    ...(d.term ? { term: d.term } : {}),
    ...(d.grade ? { grade: d.grade } : {}),
    ...(units !== undefined && units !== d.catalogUnits ? { units } : {}),
  }
}

export interface TransferDraft {
  /** No CMU equivalent: general elective units described by `label`. */
  general: boolean
  courseId: string | null
  label: string
  units: string
  institution: string
  /** "" = before CMU. */
  term: string
}

export function transferEntry(d: TransferDraft): NewEntry | null {
  const units = parseUnits(d.units)
  if (units === null) return null
  if (d.general) {
    if (!d.label.trim() || units === undefined) return null
  } else if (!d.courseId || !COURSE_ID.test(d.courseId)) {
    return null
  }
  return {
    courseId: d.general ? null : d.courseId,
    source: 'transfer',
    ...(units !== undefined ? { units } : {}),
    ...(d.general ? { label: d.label.trim() } : {}),
    ...(d.institution.trim() ? { institution: d.institution.trim() } : {}),
    ...(d.term ? { term: d.term } : {}),
  }
}

export interface ManualExamDraft {
  courseId: string | null
  name: string
  units: string
}

export function manualExamEntry(d: ManualExamDraft): NewEntry | null {
  if (!d.courseId || !COURSE_ID.test(d.courseId)) return null
  const units = parseUnits(d.units)
  if (units === null) return null
  return { courseId: d.courseId, source: 'exam', ...(units !== undefined ? { units } : {}), ...(d.name.trim() ? { note: d.name.trim() } : {}) }
}

export function placementEntry(courseId: string | null, note: string): NewEntry | null {
  if (!courseId || !COURSE_ID.test(courseId)) return null
  return { courseId, source: 'waiver', units: 0, ...(note.trim() ? { note: note.trim() } : {}) }
}

/** Course ids in pasted text: "15-122, 21127 76-101" → ["15122", "21127", "76101"], deduplicated. */
export function parsePastedCourses(text: string): string[] {
  const ids = [...text.matchAll(/(?<![\d-])(\d{2})-?(\d{3})(?!\d)/g)].map((m) => m[1] + m[2])
  return [...new Set(ids)]
}

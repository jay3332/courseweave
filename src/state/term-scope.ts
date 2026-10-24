// "All semesters" (/all/courses, /all/instructors) stands in for a semester on the Courses and Instructors pages only;
// everything else needs a real one.

/** The route segment standing in for a semester. */
export const ALL_SEMESTERS = 'all'

/** Pages with an all-semesters view. */
export const ALL_SEMESTER_PAGES = ['courses', 'instructors']

let lastTerm: string | null = null

/** Remembers the semester last visited, so leaving the all-semesters view goes back to it. */
export function rememberTerm(termId: string) {
  lastTerm = termId
  try {
    sessionStorage.setItem('courseweave:last-term', termId)
  } catch {
    // Storage off: the in-memory value lasts until reload.
  }
}

export function lastVisitedTerm(): string | null {
  if (lastTerm) return lastTerm
  try {
    return sessionStorage.getItem('courseweave:last-term')
  } catch {
    return null
  }
}

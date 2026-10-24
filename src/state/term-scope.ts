// "All semesters" (/all/courses) stands in for a semester on the Courses page only; everything else needs a real one.

/** The route segment standing in for a semester. */
export const ALL_SEMESTERS = 'all'

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

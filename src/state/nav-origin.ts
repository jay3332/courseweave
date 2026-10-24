// Where a full course page's "Back" goes. The app remembers the last page that wasn't a full course page; when that's
// a degree plan, "Back to plan" returns to it (moving between courses from the full page keeps it). A course page
// opened fresh (a new tab, a reload, a shared link) has none and goes back to the course list as usual.
import { useEffect } from 'react'
import { useLocation } from 'react-router'

const COURSE_PAGE = /^\/[^/]+\/courses\/[^/]+\/full\/?$/
const PLAN_PAGE = /^\/[^/]+\/plan(?:\/|$)/

let origin: string | null = null

/** Records the page being shown, unless it's a full course page. Call once, inside the router. */
export function useTrackOrigin() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (!COURSE_PAGE.test(pathname)) origin = `${pathname}${search}`
  }, [pathname, search])
}

/** The degree plan page this course page was opened from, if that's where the user came from. */
export function planOrigin(): string | null {
  return origin !== null && PLAN_PAGE.test(origin) ? origin : null
}

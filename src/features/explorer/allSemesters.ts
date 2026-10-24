// The explorer's "All semesters" view (/all/courses): every course any built semester offers or the catalog lists,
// with FCEs and the semesters that offer it, but no sections. The rest of the app still runs on a real semester (the
// last one visited), so /all only exists for the Courses page.
import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import { departmentName } from '../../lib/departments'
import type { Department } from '../../lib/data'
import { useOfferings } from '../../lib/offerings'
import type { ScoredDoc } from '../../lib/search'
import type { Course } from '../../lib/types'
import { buildUnoffered } from './unoffered'

export interface AllCourses {
  docs: (ScoredDoc & { course: Course })[]
  /** Built semesters offering each course, newest first; empty for catalog-only courses. */
  termsOf: Map<string, string[]>
  departments: Department[]
}

/**
 * Every course as a section-less `Course`, so the explorer's search, filters, sorting and FCE columns work on it.
 * Units are the catalog's (null for variable or unknown units, shown as VAR like a semester's own data).
 */
export function buildAllCourses(docs: ReturnType<typeof buildUnoffered>): AllCourses {
  const termsOf = new Map<string, string[]>()
  const deptMap = new Map<string, Department>()
  const out = docs.map((doc) => {
    const c = doc.course
    termsOf.set(c.id, c.terms)
    if (c.dept) {
      let d = deptMap.get(c.dept)
      if (!d) deptMap.set(c.dept, (d = { code: c.dept, name: departmentName(c.dept), prefixes: [], courseCount: 0 }))
      d.courseCount++
      if (!d.prefixes.includes(c.id.slice(0, 2))) d.prefixes.push(c.id.slice(0, 2))
    }
    const course: Course = { id: c.id, code: c.code, title: c.title, units: c.units, dept: c.dept, level: c.level, instructors: [], sections: [], crossListed: [] }
    return { ...doc, course }
  })
  out.sort((a, b) => a.course.id.localeCompare(b.course.id))
  return { docs: out, termsOf, departments: [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** undefined while loading; null when the build has no offerings index (nothing to list). */
export function useAllCourses(enabled: boolean): AllCourses | null | undefined {
  const offerings = useOfferings(enabled)
  const catalog = useCatalogIndex()
  const catalogValue = catalog.status === 'ready' ? catalog.value : null
  const catalogLoading = catalog.status === 'loading'
  return useMemo(() => {
    if (!enabled || offerings === undefined || catalogLoading) return undefined
    if (offerings === null) return null
    return buildAllCourses(buildUnoffered(() => false, offerings, catalogValue))
  }, [enabled, offerings, catalogValue, catalogLoading])
}

// The instructor explorer's "All semesters" view (/all/instructors): everyone teaching in any built semester, from the
// teaching index, plus (when FCEs are available) everyone in the FCE history who doesn't teach in one of them.
import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import { instructorSlug, lastName, type Instructor } from '../../lib/data'
import { useFceAccess, useInstructorFceIndex, type InstructorFce } from '../../lib/fce'
import { displayFceName, type NameIndex } from '../../lib/fce-names'
import { useOfferings } from '../../lib/offerings'
import { normalize } from '../../lib/search'
import { useTeaching } from '../../lib/teaching'
import type { TeachingData } from '../../lib/types'
import { catalogTitle } from '../explorer/unoffered'
import type { InstructorDoc } from './instructorData'

export interface AllInstructor extends Instructor {
  /** Built semesters they teach in, newest first. Empty for people only in the FCE history. */
  terms: { term: string; courses: string[]; sections: number }[]
}

export interface AllInstructors {
  list: AllInstructor[]
  bySlug: Map<string, AllInstructor>
  docs: InstructorDoc[]
}

/**
 * Everyone in `teaching`, then everyone in `fce` it doesn't match (FCE names, shown "First Last"). People only in the
 * FCE history get the courses it lists, and departments from those courses.
 */
export function buildAllInstructors(
  teaching: TeachingData,
  fce: NameIndex<InstructorFce> | null,
  course: { title(id: string): string | undefined; dept(id: string): string | undefined },
): AllInstructors {
  const list: AllInstructor[] = []
  const used = new Set<string>()
  const slugFor = (name: string) => {
    let slug = instructorSlug(name)
    for (let n = 2; used.has(slug); n++) slug = `${instructorSlug(name)}-${n}`
    used.add(slug)
    return slug
  }

  const matched = new Set<InstructorFce>()
  for (const [name, t] of Object.entries(teaching.instructors)) {
    const terms = teaching.terms.filter((id) => t.terms[id]).map((id) => ({ term: id, ...t.terms[id] }))
    const hit = fce?.get(name)
    if (hit) matched.add(hit)
    list.push({
      name,
      slug: slugFor(name),
      depts: t.depts,
      courseIds: [...new Set(terms.flatMap((x) => x.courses))].sort(),
      sectionCount: terms.reduce((n, x) => n + x.sections, 0),
      terms,
    })
  }
  for (const f of fce?.values() ?? []) {
    if (matched.has(f)) continue
    const name = displayFceName(f.name)
    const courseIds = f.courses.map((c) => c.courseId).sort()
    const depts = [...new Set(courseIds.map((id) => course.dept(id)).filter((d): d is string => Boolean(d)))]
    list.push({ name, slug: slugFor(name), depts, courseIds, sectionCount: 0, terms: [] })
  }

  list.sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name))
  const docs = list.map((inst): InstructorDoc => {
    const first = normalize(lastName(inst.name)).charAt(0).toUpperCase()
    return {
      inst,
      name: normalize(inst.name),
      titles: normalize(inst.courseIds.map((id) => course.title(id) ?? '').join(' | ')),
      letter: /[A-Z]/.test(first) ? first : '#',
    }
  })
  return { list, bySlug: new Map(list.map((i) => [i.slug, i])), docs }
}

/** Course titles and departments from the offerings index and the catalog, for any course. */
export function useCourseLookup(enabled = true) {
  const offerings = useOfferings(enabled)
  const catalog = useCatalogIndex()
  const catalogValue = catalog.status === 'ready' ? catalog.value : null
  return useMemo(() => {
    if (offerings === undefined || catalog.status === 'loading') return undefined
    const deptByPrefix = new Map<string, string>()
    for (const o of offerings?.byId.values() ?? []) if (!deptByPrefix.has(o.id.slice(0, 2))) deptByPrefix.set(o.id.slice(0, 2), o.dept)
    return {
      title: (id: string) => offerings?.byId.get(id)?.title ?? catalogTitle(catalogValue?.courses[id]?.title),
      dept: (id: string) => offerings?.byId.get(id)?.dept ?? deptByPrefix.get(id.slice(0, 2)),
    }
  }, [offerings, catalogValue, catalog.status])
}

/** undefined while loading; null when the build has no teaching index. */
export function useAllInstructors(enabled: boolean): AllInstructors | null | undefined {
  const teaching = useTeaching(enabled)
  const access = useFceAccess()
  // Without FCE access the list is the teaching index alone; don't wait on FCEs that won't come.
  const wantFce = enabled && access !== 'locked' && access !== 'unavailable'
  const fce = useInstructorFceIndex(wantFce)
  const lookup = useCourseLookup(enabled)
  return useMemo(() => {
    if (!enabled || teaching === undefined || lookup === undefined || (wantFce && fce === undefined)) return undefined
    if (teaching === null) return null
    return buildAllInstructors(teaching, wantFce ? (fce ?? null) : null, lookup)
  }, [enabled, teaching, lookup, wantFce, fce])
}

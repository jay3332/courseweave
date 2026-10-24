// Courses the routed semester doesn't offer, for the explorer's "Show courses not offered" option: everything the
// other built semesters offer, plus catalog courses none of them offer (which may come back later).
import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { useOfferings, type Offerings } from '../../lib/offerings'
import { normalize, type ScoredDoc } from '../../lib/search'
import { useTerm } from '../../state/term'
import type { OtherCourse } from './filters'

export interface UnofferedCourse extends OtherCourse {
  /** Built semesters offering it, newest first; empty for courses only the catalog lists. */
  terms: string[]
}

export type UnofferedDoc = ScoredDoc & { course: UnofferedCourse }

/** A catalog title worth showing; some entries only repeat the course number ("15-101"), which says nothing. */
export function catalogTitle(title: string | undefined): string | undefined {
  return title && !/^\d{2}-?\d{3}$/.test(title.trim()) ? title : undefined
}

/** Graduate courses are numbered 600 and up (the Schedule of Classes agrees for all but a handful). */
const levelOf = (id: string): 'U' | 'G' => (Number(id[2]) >= 6 ? 'G' : 'U')

/**
 * Every course `offered` says no to, as search docs. Department codes for catalog-only courses come from the other
 * courses with the same number prefix; units come from the catalog (variable-unit courses count as VAR, like a
 * semester's own data), and are unknown for the few courses the catalog lacks.
 */
export function buildUnoffered(offered: (id: string) => boolean, offerings: Offerings | null, catalog: CatalogIndex | null): UnofferedDoc[] {
  const deptByPrefix = new Map<string, string>()
  for (const o of offerings?.byId.values() ?? []) if (!deptByPrefix.has(o.id.slice(0, 2))) deptByPrefix.set(o.id.slice(0, 2), o.dept)

  const out: UnofferedDoc[] = []
  const add = (id: string, title: string, dept: string, level: 'U' | 'G', terms: string[]) => {
    const entry = catalog?.courses[id]
    const variable = entry?.unitsMax !== undefined
    const course: UnofferedCourse = {
      id,
      code: `${id.slice(0, 2)}-${id.slice(2)}`,
      title,
      dept,
      level,
      units: variable ? null : (entry?.units ?? null),
      unitsKnown: Boolean(entry) && (variable || entry!.units !== null),
      terms,
    }
    out.push({ course, title: normalize(title), instructors: '', sectionTitles: '' })
  }

  for (const o of offerings?.byId.values() ?? []) {
    if (offered(o.id)) continue
    add(o.id, o.title, o.dept, o.level === 'G' || o.level === 'U' ? o.level : levelOf(o.id), o.terms)
  }
  // Without the offerings index every catalog course would read "not offered anywhere", which isn't known.
  if (offerings && catalog) {
    for (const entry of Object.values(catalog.courses)) {
      if (offered(entry.id) || offerings.byId.has(entry.id)) continue
      const title = catalogTitle(entry.title)
      if (title) add(entry.id, title, deptByPrefix.get(entry.id.slice(0, 2)) ?? '', levelOf(entry.id), [])
    }
  }
  return out
}

/** The routed semester's unoffered courses: undefined while loading, null when there's no offerings index. */
export function useUnofferedDocs(enabled: boolean): UnofferedDoc[] | null | undefined {
  const term = useTerm()
  const offerings = useOfferings(enabled)
  const catalog = useCatalogIndex()
  const catalogValue = catalog.status === 'ready' ? catalog.value : null
  const catalogLoading = catalog.status === 'loading'
  return useMemo(() => {
    if (!enabled || offerings === undefined || catalogLoading) return undefined
    if (offerings === null) return null
    return buildUnoffered((id) => term.courseById.has(id), offerings, catalogValue)
  }, [enabled, term, offerings, catalogValue, catalogLoading])
}

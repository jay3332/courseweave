import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import { codeOf } from '../../lib/requisite-format'
import { useTerm } from '../../state/term'

/** How a requisite course stands for the student. Supplied by the record/requisite checker. */
export type RequisiteStatus = 'met' | 'planned' | 'missing'

export type StatusFn = (courseId: string) => RequisiteStatus | undefined
export type HrefFn = (courseId: string) => string

export interface ChipContext {
  termId: string
  termName: string
  offered(id: string): boolean
  title(id: string): string | undefined
  href: HrefFn
  status?: StatusFn
}

/** Lookup context for course chips: offered-this-term, titles, default links. */
export function useChipContext(status?: StatusFn, href?: HrefFn): ChipContext {
  const term = useTerm()
  const index = useCatalogIndex()
  const courses = index.status === 'ready' ? index.value.courses : null
  return useMemo(() => {
    const termId = term.meta.id
    const offered = (id: string) => term.courseById.has(id)
    return {
      termId,
      termName: term.meta.name,
      offered,
      title: (id: string) => term.courseById.get(id)?.title ?? courses?.[id]?.title,
      // Courses not offered this term have no course page here, so they open in the requisite explorer.
      href: href ?? ((id: string) => (offered(id) ? `/${termId}/courses/${codeOf(id)}` : `/${termId}/requisites/${codeOf(id)}`)),
      status,
    }
  }, [term, courses, status, href])
}

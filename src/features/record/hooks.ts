import { useCallback, useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import { codeOf } from '../../lib/requisite-format'
import { termLabel, termOrdinal, termRange } from '../../lib/requisites'
import { useTerm } from '../../state/term'

export interface CourseInfo {
  id: string
  code: string
  title: string | undefined
  /** Catalog units (minimum for variable-unit courses), or null if unknown. */
  units: number | null
  passFail: boolean
}

/** Title/units for any course id, from the catalog first and then this term's schedule. */
export function useCourseLookup(): (id: string) => CourseInfo {
  const term = useTerm()
  const index = useCatalogIndex()
  const courses = index.status === 'ready' ? index.value.courses : null
  return useCallback(
    (id: string) => {
      const c = courses?.[id]
      const t = term.courseById.get(id)
      return {
        id,
        code: codeOf(id),
        title: c?.title ?? t?.title,
        units: c?.units ?? t?.units ?? null,
        passFail: c?.passFail ?? t?.passFail ?? false,
      }
    },
    [courses, term],
  )
}

/** Term codes offered in pickers: newest first, from a few years before the routed term through it. */
export function useTermOptions(entryTerm?: string): string[] {
  const term = useTerm()
  return useMemo(() => {
    const current = termOrdinal(term.meta.id) ?? 0
    const year = Math.floor(current / 3)
    const fromEntry = entryTerm && termOrdinal(entryTerm) !== null ? entryTerm : null
    const from = fromEntry && termOrdinal(fromEntry)! < current ? fromEntry : `F${String((year - 5) % 100).padStart(2, '0')}`
    return termRange(from, term.meta.id, true).reverse()
  }, [term, entryTerm])
}

export { termLabel }

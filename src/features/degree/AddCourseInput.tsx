import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { SearchInput } from '../../components/ui'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { offering, OFFERING_LABEL, type Offering } from '../../lib/plan'
import { buildSearchDocs, searchCourses, type SearchDoc } from '../../lib/search'
import type { Course } from '../../lib/types'
import { useTerm } from '../../state/term'

const LIMIT = 8

const docsCache = new WeakMap<CatalogIndex, SearchDoc[]>()

/** Search docs for every catalog course, built once per catalog. */
function catalogDocs(index: CatalogIndex): SearchDoc[] {
  let docs = docsCache.get(index)
  if (!docs) {
    const courses: Course[] = Object.values(index.courses).map((e) => ({
      id: e.id,
      code: e.code,
      title: e.title,
      units: e.units,
      dept: '',
      level: 'U',
      instructors: [],
      sections: [],
      crossListed: [],
    }))
    docs = buildSearchDocs(courses)
    docsCache.set(index, docs)
  }
  return docs
}

const OFFERING_TONE: Record<Offering, string> = {
  scheduled: 'text-ok',
  'not-scheduled': 'text-warn',
  usually: 'text-muted',
  'other-seasons': 'text-warn',
  unknown: 'text-muted',
}

interface AddCourseInputProps {
  /** The semester courses are added to; drives the offering hints. */
  term: string
  /** Course ids offered in that term's published schedule, when it has one. */
  scheduled?: Set<string> | null
  /** Course ids already in the plan (any term), marked in results. */
  inPlan: Set<string>
  onAdd(courseId: string): void
  onClose?(): void
  autoFocus?: boolean
}

/** Combobox that adds a catalog course to a semester. Shows whether it's offered that semester. */
export function AddCourseInput({ term, scheduled, inPlan, onAdd, onClose, autoFocus }: AddCourseInputProps) {
  const routed = useTerm()
  const index = useCatalogIndex()
  const catalog = index.status === 'ready' ? index.value : null
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  const results = useMemo(() => {
    if (!query.trim()) return []
    const fromCatalog = catalog ? searchCourses(catalogDocs(catalog), query, LIMIT) : []
    if (fromCatalog.length >= LIMIT) return fromCatalog
    // Courses in the routed term that the catalog doesn't know (special listings).
    const seen = new Set(fromCatalog.map((c) => c.id))
    const extra = searchCourses(routed.searchDocs, query, LIMIT).filter((c) => !seen.has(c.id))
    return [...fromCatalog, ...extra].slice(0, LIMIT)
  }, [catalog, routed, query])

  const add = (courseId: string) => {
    onAdd(courseId)
    setQuery('')
    setActive(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query) setQuery('')
      else onClose?.()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') setActive((active + 1) % results.length)
    else if (e.key === 'ArrowUp') setActive((active - 1 + results.length) % results.length)
    else if (e.key === 'Enter') add(results[Math.min(active, results.length - 1)].id)
    else return
    e.preventDefault()
  }

  const showList = query.trim().length > 0

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!query && !ref.current?.contains(e.relatedTarget as Node | null)) onClose?.()
      }}
    >
      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder="Add a course: 15-122, calculus"
        aria-label={`Add a course to ${term}`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && results.length ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching courses" className="absolute top-11 right-0 left-0 z-40 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[13.5px] text-muted">No courses match “{query.trim()}”.</li>
          ) : (
            results.map((course, i) => {
              const o = offering(course.id, term, catalog, scheduled)
              return (
                <li
                  key={course.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(course.id)}
                  className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-2 py-1.5 ${i === active ? 'bg-surface-2 ring-1 ring-line-strong' : ''}`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="course-code shrink-0 text-[14.5px] text-ink">{course.code}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{course.title}</span>
                    {course.units !== null ? <span className="shrink-0 text-[12px] text-muted">{course.units}u</span> : null}
                  </span>
                  <span className="flex gap-2 text-[12px]">
                    <span className={OFFERING_TONE[o]}>{OFFERING_LABEL[o]}</span>
                    {inPlan.has(course.id) ? <span className="text-muted">Already in your plan</span> : null}
                  </span>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}

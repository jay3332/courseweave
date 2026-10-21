import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { SearchInput } from '../../components/ui'
import type { CatalogIndex } from '../../lib/catalog-types'
import { buildSearchDocs, searchCourses, type SearchDoc } from '../../lib/search'
import type { Course } from '../../lib/types'
import { useTerm } from '../../state/term'

const LIMIT = 8

/** Search docs for catalog courses that aren't offered this term, so they can be explored too. */
function useCatalogOnlyDocs(index: CatalogIndex | null): SearchDoc[] {
  const term = useTerm()
  return useMemo(() => {
    if (!index) return []
    const extra: Course[] = []
    for (const e of Object.values(index.courses)) {
      if (term.courseById.has(e.id)) continue
      extra.push({ id: e.id, code: e.code, title: e.title, units: e.units, dept: '', level: 'U', instructors: [], sections: [], crossListed: [] })
    }
    return buildSearchDocs(extra)
  }, [index, term])
}

export function RequisiteSearch({ index, onPick, autoFocus }: { index: CatalogIndex | null; onPick(id: string): void; autoFocus?: boolean }) {
  const term = useTerm()
  const extraDocs = useCatalogOnlyDocs(index)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  const results = useMemo(() => {
    if (!query.trim()) return []
    // Offered-this-term courses rank first among equal matches; the rest of the catalog follows.
    const offered = searchCourses(term.searchDocs, query, LIMIT)
    const more = offered.length < LIMIT ? searchCourses(extraDocs, query, LIMIT - offered.length) : []
    return [...offered, ...more]
  }, [term, extraDocs, query])
  const showList = open && query.trim().length > 0

  const pick = (course: Course) => {
    onPick(course.id)
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (showList) setOpen(false)
      else setQuery('')
      e.preventDefault()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') setActive((active + 1) % results.length)
    else if (e.key === 'ArrowUp') setActive((active - 1 + results.length) % results.length)
    else if (e.key === 'Enter') pick(results[Math.min(active, results.length - 1)])
    else return
    setOpen(true)
    e.preventDefault()
  }

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder="Find a course: 15-213, linear algebra"
        aria-label="Find a course to explore"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-results`}
        aria-activedescendant={showList && results.length ? `${id}-r-${active}` : undefined}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul id={`${id}-results`} role="listbox" aria-label="Matching courses" className="absolute top-11 right-0 left-0 z-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[13.5px] text-muted">No courses match “{query.trim()}”. Try a number like 15-213 or a word from the title.</li>
          ) : (
            results.map((course, i) => (
              <li
                key={course.id}
                id={`${id}-r-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(course)}
                className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 ${i === active ? 'bg-surface-2 ring-1 ring-line-strong' : ''}`}
              >
                <span className="course-code w-[52px] shrink-0 text-[15px] text-ink">{course.code}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{course.title}</span>
                {term.courseById.has(course.id) ? null : <span className="shrink-0 text-[12px] text-muted">Not this term</span>}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

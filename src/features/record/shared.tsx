import { X } from 'lucide-react'
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react'
import { SearchInput } from '../../components/ui'
import { useCatalogIndex } from '../../lib/catalog'
import { codeOf } from '../../lib/requisite-format'
import { termLabel, termOrdinal, termRange } from '../../lib/requisites'
import { buildSearchDocs, searchCourses } from '../../lib/search'
import type { Course } from '../../lib/types'
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

/** Labeled form control. */
export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  )
}

const control =
  'h-10 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-[15px] text-ink focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_9%,transparent)] focus:outline-none md:text-[14px]'

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${control} pr-7 ${className}`} {...props} />
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${control} placeholder:text-muted ${className}`} {...props} />
}

/** A titled block of the record page. */
export function Section({ id, title, description, children, aside }: { id: string; title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="display text-[24px] text-ink">
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-[68ch] text-[14px] text-ink-2">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Empty list placeholder. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-[14px] text-muted">{children}</p>
}

const PICKER_LIMIT = 8

/**
 * Pick any catalog course (including ones not offered this term). Shows the chosen course with a
 * clear button once picked.
 */
export function CoursePicker({ value, onChange, label, placeholder = 'Search: 15-122, calculus' }: { value: string | null; onChange(id: string | null): void; label: string; placeholder?: string }) {
  const term = useTerm()
  const index = useCatalogIndex()
  const lookup = useCourseLookup()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  const extraDocs = useMemo(() => {
    if (index.status !== 'ready') return []
    const extra: Course[] = []
    for (const e of Object.values(index.value.courses)) {
      if (term.courseById.has(e.id)) continue
      extra.push({ id: e.id, code: e.code, title: e.title, units: e.units, dept: '', level: 'U', instructors: [], sections: [], crossListed: [] })
    }
    return buildSearchDocs(extra)
  }, [index, term])

  const results = useMemo(() => {
    if (!query.trim()) return []
    const offered = searchCourses(term.searchDocs, query, PICKER_LIMIT)
    const more = offered.length < PICKER_LIMIT ? searchCourses(extraDocs, query, PICKER_LIMIT - offered.length) : []
    return [...offered, ...more]
  }, [term, extraDocs, query])

  if (value) {
    const info = lookup(value)
    return (
      <div className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 py-1 pr-1 pl-2.5">
        <span className="course-code shrink-0 text-[15px] text-ink">{info.code}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] text-ink-2">{info.title ?? 'Not in the catalog'}</span>
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  const showList = open && query.trim().length > 0
  const pick = (course: Course) => {
    onChange(course.id)
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
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-results`}
        aria-activedescendant={showList && results.length ? `${id}-r-${active}` : undefined}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul id={`${id}-results`} role="listbox" aria-label="Matching courses" className="absolute top-11 right-0 left-0 z-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[13.5px] text-muted">No courses match “{query.trim()}”. Try a number like 21-127.</li>
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
                {course.units !== null ? <span className="shrink-0 text-[12px] text-muted">{course.units} units</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

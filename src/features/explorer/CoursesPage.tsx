import { ChartScatter, List, SearchX, SlidersHorizontal } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button, Dialog, SearchInput } from '../../components/ui'
import { parseCourseCode } from '../../lib/data'
import { useFceSummary } from '../../lib/fce'
import { scoreCourse } from '../../lib/search'
import type { Course } from '../../lib/types'
import { fittingSelections, useScheduleView } from '../../state/schedule-view'
import { useBookmarks } from '../../state/store'
import { useTerm } from '../../state/term'
import { CourseDetail } from './CourseDetail'
import { HoursScatter } from '../fce/HoursScatter'
import { FilterPanel } from './FilterPanel'
import {
  activeFilterCount,
  courseMatches,
  EMPTY_FILTERS,
  FCE_SORTS,
  parseFilters,
  parseSort,
  parseView,
  sortCourses,
  writeFilters,
  type Filters,
  type SortKey,
  type ViewMode,
} from './filters'
import { ResultsHeader, ResultsList } from './ResultsList'
import { rowId } from './summary'

const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Relevance',
  number: 'Course number',
  title: 'Title',
  units: 'Units',
  hours: 'Fewest FCE hours',
  'hours-desc': 'Most FCE hours',
  ratio: 'FCE hours vs units',
  rating: 'Course rating',
  teaching: 'Teaching rating',
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function CoursesPage() {
  const term = useTerm()
  const termId = term.meta.id
  const { courseCode } = useParams()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const schedule = useScheduleView()
  const bookmarks = useBookmarks(termId)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // The input keeps local state so typing stays responsive; the URL follows with replace().
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const pushedQuery = useRef(urlQuery)
  useEffect(() => {
    if (urlQuery !== pushedQuery.current) {
      pushedQuery.current = urlQuery
      setQuery(urlQuery)
    }
  }, [urlQuery])
  const onQueryChange = (value: string) => {
    setQuery(value)
    pushedQuery.current = value
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('q', value)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }
  const deferredQuery = useDeferredValue(query).trim()

  const fceData = useFceSummary()
  const fce = fceData ? fceData.courses : fceData
  const filters = useMemo(() => parseFilters(params), [params])
  const sort = parseSort(params, Boolean(deferredQuery))
  const view: ViewMode = parseView(params)
  const setView = (value: ViewMode) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === 'chart') next.set('view', 'chart')
        else next.delete('view')
        return next
      },
      { replace: true },
    )
  const filterCount = activeFilterCount(filters)
  const setFilters = (next: Filters) => setParams((prev) => writeFilters(prev, next))
  const setSort = (value: SortKey) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('sort', value)
        return next
      },
      { replace: true },
    )

  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks])
  const entryColors = useMemo(() => new Map(schedule.entries.map((e) => [e.course.id, e.entry.color])), [schedule.entries])

  const scored = useMemo(() => {
    if (!deferredQuery) return term.searchDocs.map((d) => ({ course: d.course, score: 1 }))
    const out: { course: Course; score: number }[] = []
    for (const doc of term.searchDocs) {
      const score = scoreCourse(doc, deferredQuery)
      if (score > 0) out.push({ course: doc.course, score })
    }
    return out
  }, [term, deferredQuery])

  const results = useMemo(() => {
    const ctx = { bookmarks: bookmarkSet, fittingSelections: (c: Course) => fittingSelections(c, schedule), fce }
    return sortCourses(
      scored.filter((s) => courseMatches(s.course, filters, ctx)),
      sort,
      fce,
    )
  }, [scored, filters, bookmarkSet, schedule, sort, fce])

  const selectedId = courseCode ? parseCourseCode(courseCode) : null
  const selected = selectedId ? (term.courseById.get(selectedId) ?? null) : null

  // Keyboard highlight; falls back to the open course (or the top result) whenever the result set changes.
  const resultsKey = JSON.stringify([deferredQuery, filters, sort, Boolean(fce)])
  const [active, setActive] = useState<{ key: string; index: number } | null>(null)
  const activeIndex =
    active && active.key === resultsKey ? active.index : Math.max(0, selectedId ? results.findIndex((c) => c.id === selectedId) : 0)
  const setActiveIndex = (index: number) => setActive({ key: resultsKey, index })
  const scrollToActive = useRef(false)

  useEffect(() => {
    if (!scrollToActive.current) return
    scrollToActive.current = false
    const course = results[activeIndex]
    if (course) document.getElementById(rowId(course))?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const hrefFor = (course: Course) => `/${termId}/courses/${course.code}${location.search}`
  const closeHref = `/${termId}/courses${location.search}`

  const open = (course: Course | undefined) => {
    if (course) navigate(hrefFor(course))
  }

  // Focus search on load (desktop) and on "/".
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) searchRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!results.length) return
      const next = e.key === 'ArrowDown' ? Math.min(results.length - 1, activeIndex + 1) : Math.max(0, activeIndex - 1)
      scrollToActive.current = true
      setActiveIndex(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(results[activeIndex])
    }
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const target = e.target as HTMLElement
    const index = Number(target.dataset.index)
    if (Number.isNaN(index) || target.dataset.index === undefined) return
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? Math.min(results.length - 1, index + 1) : Math.max(0, index - 1)
    setActiveIndex(next)
    requestAnimationFrame(() => {
      const el = document.getElementById(rowId(results[next]))
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  const clearAll = () => {
    onQueryChange('')
    setParams((prev) => {
      const next = writeFilters(prev, EMPTY_FILTERS)
      next.delete('q')
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Filters" className="scrollbar-thin hidden w-[252px] shrink-0 overflow-y-auto border-r border-line bg-surface px-4 py-4 lg:block">
        <FilterPanel term={term} filters={filters} onChange={setFilters} fceAvailable={Boolean(fce)} />
      </aside>

      <section aria-label="Course results" className={`${courseCode ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-4 pt-4 pb-2.5">
          <div className="flex gap-2">
            <SearchInput
              ref={searchRef}
              value={query}
              onChange={onQueryChange}
              onKeyDown={onSearchKeyDown}
              placeholder="Search by number, title or instructor"
              aria-label="Search courses"
              aria-controls="course-results"
              className="min-w-0 flex-1"
            />
            <Button className="lg:hidden" onClick={() => setFiltersOpen(true)} aria-label={`Filters${filterCount ? `, ${filterCount} active` : ''}`}>
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">Filters</span>
              {filterCount ? <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">{filterCount}</span> : null}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
            <span className="text-ink-2" aria-live="polite">
              <span className="font-semibold text-ink">{results.length.toLocaleString()}</span> {results.length === 1 ? 'course' : 'courses'}
              <span className="hidden text-muted sm:inline"> in {term.meta.name}</span>
            </span>
            <div className="flex items-center gap-2">
              {view === 'list' ? (
                <label className="flex items-center gap-1.5 text-muted">
                  <span className="hidden sm:inline">Sort by</span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label="Sort by"
                    className="h-9 max-w-[10rem] rounded-md border border-line-strong bg-surface px-1.5 text-[13px] font-medium text-ink sm:h-7 sm:max-w-[12rem]"
                  >
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) =>
                      FCE_SORTS.includes(key) && !fce ? null : (
                        <option key={key} value={key} disabled={key === 'relevance' && !deferredQuery}>
                          {SORT_LABELS[key]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              ) : null}
              {fce ? <ViewToggle view={view} onChange={setView} /> : null}
            </div>
          </div>
        </div>

        <div ref={scrollRef} id="course-results" onKeyDown={onListKeyDown} className="scrollbar-thin @container min-h-0 flex-1 overflow-y-auto bg-surface">
          {results.length && view === 'chart' && fce ? (
            <HoursScatter courses={results} fce={fce} selectedId={selectedId} entryColors={entryColors} hrefFor={hrefFor} onOpen={open} />
          ) : results.length ? (
            <>
              <ResultsHeader showFce={Boolean(fce)} />
              <ResultsList
                key={resultsKey}
                term={term}
                results={results}
                activeIndex={activeIndex}
                onActiveChange={setActiveIndex}
                selectedId={selectedId}
                hrefFor={hrefFor}
                entryColors={entryColors}
                bookmarks={bookmarkSet}
                scrollRoot={scrollRef}
                fce={fce}
              />
            </>
          ) : (
            <EmptyResults query={deferredQuery} filterCount={filterCount} onClearFilters={() => setFilters(EMPTY_FILTERS)} onClearAll={clearAll} />
          )}
        </div>
      </section>

      {courseCode ? (
        <aside
          key={courseCode}
          aria-label="Course details"
          className="scrollbar-thin flex w-full shrink-0 flex-col overflow-y-auto border-l border-line bg-surface md:w-[400px] lg:w-[440px] xl:w-[500px]"
        >
          {selected ? (
            <CourseDetail course={selected} closeHref={closeHref} search={location.search} />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <h2 className="display mb-2 text-2xl">No course {courseCode}</h2>
                <p className="mb-4 text-ink-2">It isn’t offered in {term.meta.name}, or the number is mistyped.</p>
                <Link to={closeHref} className="font-medium text-accent underline underline-offset-2">
                  Back to all courses
                </Link>
              </div>
            </div>
          )}
        </aside>
      ) : null}

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" className="w-[min(94vw,420px)]">
        <div className="px-5 py-4">
          <FilterPanel term={term} filters={filters} onChange={setFilters} heading={false} fceAvailable={Boolean(fce)} />
        </div>
        <div className="sticky bottom-0 border-t border-line bg-surface px-5 py-3">
          <Button variant="primary" className="w-full" onClick={() => setFiltersOpen(false)}>
            Show {results.length.toLocaleString()} {results.length === 1 ? 'course' : 'courses'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange(v: ViewMode): void }) {
  const options: { value: ViewMode; label: string; icon: typeof List }[] = [
    { value: 'list', label: 'List', icon: List },
    { value: 'chart', label: 'Hours vs units', icon: ChartScatter },
  ]
  return (
    <div role="radiogroup" aria-label="View" className="flex rounded-md border border-line-strong p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          title={value === 'chart' ? 'Chart FCE hours per week against units' : 'Show results as a list'}
          onClick={() => onChange(value)}
          className={`flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[12.5px] font-medium transition-colors sm:h-6 ${
            view === value ? 'bg-surface-2 text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className={value === 'chart' ? 'hidden sm:inline' : 'sr-only sm:not-sr-only'}>{label}</span>
          {value === 'chart' ? <span className="sm:hidden">Chart</span> : null}
        </button>
      ))}
    </div>
  )
}

function EmptyResults({ query, filterCount, onClearFilters, onClearAll }: { query: string; filterCount: number; onClearFilters(): void; onClearAll(): void }) {
  return (
    <div className="grid h-full min-h-64 place-items-center p-8">
      <div className="max-w-sm text-center">
        <SearchX aria-hidden className="mx-auto mb-3 size-8 text-muted" />
        <h2 className="display mb-1.5 text-xl">No matching courses</h2>
        <p className="mb-4 text-[14px] text-ink-2">
          {query && filterCount
            ? `Nothing matches “${query}” with ${filterCount === 1 ? 'this filter' : `these ${filterCount} filters`}. Loosen a filter or try a course number like 15-122.`
            : query
              ? `Nothing matches “${query}”. Try a course number like 15-122, a title word, or an instructor’s last name.`
              : 'No course passes every filter. Loosen one to see more.'}
        </p>
        <div className="flex justify-center gap-2">
          {filterCount ? (
            <Button size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
          {query && filterCount ? (
            <Button size="sm" variant="ghost" onClick={onClearAll}>
              Clear search and filters
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

import { Star } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { courseColorStyle } from '../../lib/colors'
import type { Term } from '../../lib/data'
import { FCE_HOURS_HELP, courseIsMini, formatHours, formatRating, type FceSummary } from '../../lib/fce'
import { termLabel } from '../../lib/requisites'
import { formatUnits } from '../../lib/time'
import type { Course } from '../../lib/types'
import { WorkloadCell } from '../fce/WorkloadMeter'
import { workloadDescription } from '../fce/workload'
import { courseMini, meetingSummary, rowId } from './summary'

const PAGE = 80

/**
 * Columns by list width (container queries):
 *   narrow: course | title (meets and FCE inline) | units
 *   @lg:    + FCE hours
 *   @2xl:   + meets + course rating
 */
const GRID =
  'grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] gap-x-3 @lg:grid-cols-[4.5rem_minmax(0,1fr)_4.25rem_2.5rem] @2xl:grid-cols-[4.5rem_minmax(0,1fr)_10rem_4.25rem_3rem_2.5rem]'

export function ResultsHeader({ showFce, allSemesters = false }: { showFce: boolean; allSemesters?: boolean }) {
  return (
    <div aria-hidden className={`sticky top-0 z-10 border-b border-line bg-surface-2 px-4 py-1.5 text-[12px] font-medium text-muted ${GRID}`}>
      <span>Course</span>
      <span>Title</span>
      <span className="hidden text-right @2xl:block">{allSemesters ? 'Offered' : 'Meets'}</span>
      <span className="hidden text-right @lg:block" title={FCE_HOURS_HELP}>
        {showFce ? 'FCE hrs' : ''}
      </span>
      <span className="hidden text-right @2xl:block" title="Overall course rating from FCEs, 1 to 5">
        {showFce ? 'Rating' : ''}
      </span>
      <span className="text-right">Units</span>
    </div>
  )
}

interface ResultsListProps {
  term: Term
  results: Course[]
  activeIndex: number
  onActiveChange(index: number): void
  selectedId: string | null
  hrefFor(course: Course): string
  entryColors: Map<string, number>
  bookmarks: Set<string>
  scrollRoot: RefObject<HTMLDivElement | null>
  /** FCE summaries; null/undefined hides FCE values. */
  fce: Map<string, FceSummary> | null | undefined
  /** Shown once every result is (other semesters' courses), so it doesn't sit between pages. */
  footer?: ReactNode
  /** The all-semesters view: each course's offering semesters (newest first) in place of its sections. */
  offered?: Map<string, string[]>
}

/** Remount (via `key`) when the result set changes so paging restarts. */
export function ResultsList({ term, results, activeIndex, onActiveChange, selectedId, hrefFor, entryColors, bookmarks, scrollRoot, fce, footer, offered }: ResultsListProps) {
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLLIElement>(null)
  const shown = Math.min(results.length, Math.max(limit, activeIndex + PAGE / 4))

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { root: scrollRoot.current, rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRoot, shown, results.length])

  const all = shown >= results.length
  return (
    <>
      <ul role="list" className="pb-6">
        {results.slice(0, shown).map((course, i) => {
          const summary = meetingSummary(course)
          const mini = courseMini(course, term.meta)
          const color = entryColors.get(course.id)
          const active = i === activeIndex
          const selected = course.id === selectedId
          const f = fce?.get(course.id)
          const isMini = courseIsMini(course, f)
          const terms = offered?.get(course.id)
          return (
            <li key={course.id}>
              <Link
                id={rowId(course)}
                to={hrefFor(course)}
                data-index={i}
                aria-current={selected ? 'page' : undefined}
                onClick={() => onActiveChange(i)}
                onFocus={() => onActiveChange(i)}
                className={`group relative items-start border-b border-line px-4 py-2.5 transition-colors outline-none focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${GRID} ${
                  selected ? 'bg-accent-soft' : active ? 'bg-surface-2' : 'hover:bg-surface-2'
                }`}
              >
                {color !== undefined ? (
                  <span aria-hidden className="course-swatch absolute top-2 bottom-2 left-1 w-[3px] rounded-full" style={courseColorStyle(color)} />
                ) : null}
                {active && !selected ? <span aria-hidden className="absolute inset-y-0 right-0 w-[3px] bg-line-strong" /> : null}
                <span className="flex items-center gap-1 pt-px">
                  <span className={`course-code text-[16px] ${selected ? 'text-accent' : 'text-ink'}`}>{course.code}</span>
                  {bookmarks.has(course.id) ? <Star aria-label="Saved" className="size-3 fill-current text-warn" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{course.title}</span>
                  <span className="flex min-w-0 gap-2 text-[12.5px] text-muted">
                    <span className="shrink-0 font-medium text-ink-2">{course.dept}</span>
                    {course.level === 'G' ? <span className="shrink-0">Grad</span> : null}
                    <span className="truncate">
                      {terms ? offeredText(terms) : course.instructors.length ? course.instructors.join(', ') : 'Instructor TBA'}
                    </span>
                  </span>
                  <span className={`flex min-w-0 gap-3 text-[12.5px] @2xl:hidden ${terms && !f ? 'hidden' : ''}`}>
                    {terms ? null : (
                      <span className="min-w-0 truncate text-ink-2">
                        {summary.primary}
                        {summary.secondary ? <span className="text-muted">, {summary.secondary}</span> : null}
                      </span>
                    )}
                    {f ? <InlineFce summary={f} units={course.units} mini={isMini} /> : null}
                  </span>
                </span>
                {terms ? (
                  // The newest semester offering it; the full list is under the title.
                  <span className="hidden min-w-0 truncate text-right text-[13px] text-ink-2 @2xl:block">{terms.length ? termLabel(terms[0]) : '—'}</span>
                ) : (
                  <span className="hidden min-w-0 text-right text-[13px] @2xl:block">
                    <span className="block truncate text-ink-2">{summary.primary}</span>
                    <span className="block truncate text-[12px] text-muted">{mini ?? summary.secondary}</span>
                  </span>
                )}
                <span className="hidden pt-0.5 @lg:block">{fce ? <WorkloadCell hours={f?.hours ?? null} units={course.units} mini={isMini} /> : null}</span>
                <span className="hidden pt-px text-right @2xl:block" title={f?.courseRate != null ? `Course rating ${formatRating(f.courseRate)} of 5` : undefined}>
                  {f?.courseRate != null ? <span className="course-code text-[15px] text-ink">{f.courseRate.toFixed(1)}</span> : fce ? <span className="text-[12px] text-muted">—</span> : null}
                </span>
                <span className="pt-px text-right">
                  <span className={`course-code text-[15px] ${course.units === null ? 'text-muted' : 'text-ink'}`}>{formatUnits(course.units)}</span>
                </span>
              </Link>
            </li>
          )
        })}
        {!all ? (
          <li ref={sentinel} className="px-4 py-4 text-center text-[13px] text-muted">
            Showing {shown} of {results.length}
          </li>
        ) : null}
      </ul>
      {all ? footer : null}
    </>
  )
}

/** "Offered Fall 2026, Spring 2027": the built semesters offering a course, newest first. */
export function offeredText(terms: string[]): string {
  return terms.length ? `Offered ${terms.map(termLabel).join(', ')}` : 'Not offered in a recent semester'
}

/** Hours and rating in the narrow layout, where they have no columns of their own. */
function InlineFce({ summary, units, mini }: { summary: FceSummary; units: number | null; mini: boolean }) {
  return (
    <span className="ml-auto flex shrink-0 gap-2 text-muted @lg:hidden" title={workloadDescription(summary.hours, units, mini)}>
      {summary.hours !== null ? (
        <span>
          <span className="font-semibold text-ink-2 tabular-nums">{formatHours(summary.hours)}</span> h/wk
        </span>
      ) : null}
      {summary.courseRate !== null ? (
        <span>
          <span className="font-semibold text-ink-2 tabular-nums">{summary.courseRate.toFixed(1)}</span> rating
        </span>
      ) : null}
    </span>
  )
}

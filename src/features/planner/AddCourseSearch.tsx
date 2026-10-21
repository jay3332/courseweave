import { Check } from 'lucide-react'
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { SearchInput } from '../../components/ui'
import { searchCourses } from '../../lib/search'
import type { Course } from '../../lib/types'
import { fittingSelections, type ScheduleView } from '../../state/schedule-view'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { initialChoice, unitsText } from './format'
import { useDismiss } from './hooks'

const LIMIT = 8

interface AddCourseSearchProps {
  view: ScheduleView
  scheduleId: string
  onPreview(courseId: string | null): void
}

export function AddCourseSearch({ view, scheduleId, onPreview }: AddCourseSearchProps) {
  const term = useTerm()
  const addCourse = useStore((s) => s.addCourse)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  const results = useMemo(() => (query.trim() ? searchCourses(term.searchDocs, query, LIMIT) : []), [term, query])
  const showList = open && query.trim().length > 0

  const close = useCallback(() => {
    setOpen(false)
    onPreview(null)
  }, [onPreview])
  useDismiss(ref, open, close)

  const highlight = (i: number) => {
    setActive(i)
    onPreview(results[i]?.id ?? null)
  }

  const add = (course: Course) => {
    if (!view.hasCourse(course.id)) {
      const choice = initialChoice(course, view)
      addCourse(scheduleId, course.id, choice.section, choice.child)
    }
    setQuery('')
    setActive(0)
    onPreview(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) {
      if (e.key === 'Escape') setQuery('')
      return
    }
    if (e.key === 'ArrowDown') {
      setOpen(true)
      highlight((active + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      setOpen(true)
      highlight((active - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      add(results[Math.min(active, results.length - 1)])
    } else if (e.key === 'Escape') {
      if (showList) close()
      else setQuery('')
    } else return
    e.preventDefault()
  }

  return (
    <div ref={ref} className="relative">
      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v)
          setOpen(true)
          setActive(0)
          onPreview(null)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Add a course: 15-122, calculus, Kosbie"
        aria-label="Search courses to add"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-results`}
        aria-activedescendant={showList && results.length ? `${id}-r-${active}` : undefined}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul
          id={`${id}-results`}
          role="listbox"
          aria-label="Matching courses"
          onMouseLeave={() => onPreview(null)}
          className="absolute top-11 right-0 left-0 z-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[13.5px] text-muted">No courses match “{query.trim()}”. Try a number like 15-122 or a word from the title.</li>
          ) : (
            results.map((course, i) => {
              const added = view.hasCourse(course.id)
              const fits = fittingSelections(course, view).length > 0
              return (
                <li
                  key={course.id}
                  id={`${id}-r-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => highlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(course)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 ${i === active ? 'bg-surface-2 ring-1 ring-line-strong' : ''}`}
                >
                  <span className="course-code w-[52px] shrink-0 text-[15px] text-ink">{course.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{course.title}</span>
                    <span className="block text-[12px] text-muted">{unitsText(course.units)}</span>
                  </span>
                  {added ? (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted">
                      <Check aria-hidden className="size-3.5" />
                      Added
                    </span>
                  ) : fits ? (
                    <span className="shrink-0 text-[12px] font-medium text-ok">Fits</span>
                  ) : (
                    <span className="shrink-0 text-[12px] font-medium text-danger">Conflicts</span>
                  )}
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}

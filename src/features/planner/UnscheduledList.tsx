import { Link } from 'react-router'
import { isUnscheduled } from '../../lib/blocks'
import { courseColorStyle } from '../../lib/colors'
import type { ScheduleView } from '../../state/schedule-view'
import { partLabel, unitsText } from './format'

/** Visible courses with a chosen section (or recitation) that has no set meeting time: TBA, independent study, … */
export function UnscheduledList({ view, termId }: { view: ScheduleView; termId: string }) {
  const items = view.placed
    .map((e) => ({ ...e, unscheduled: e.parts.filter(isUnscheduled) }))
    .filter((e) => e.unscheduled.length > 0)
  if (!items.length) return null

  return (
    <section aria-labelledby="unscheduled" className="mt-6">
      <h2 id="unscheduled" className="display mb-1 text-lg text-ink">
        No set meeting time
      </h2>
      <p className="mb-2 text-[13px] text-muted">These count toward your units but don't appear on the calendar.</p>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map(({ entry, course, unscheduled }) => (
          <li key={course.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
            <span aria-hidden className="course-swatch size-2.5 shrink-0 rounded-full" style={courseColorStyle(entry.color)} />
            <span className="course-code w-[52px] shrink-0 text-[15px]">{course.code}</span>
            <Link to={`/${termId}/courses/${course.code}`} className="min-w-0 flex-1 basis-40 truncate text-[13.5px] text-ink-2 hover:text-ink hover:underline">
              {course.title}
            </Link>
            <span className="shrink-0 text-[12.5px] text-muted">{unscheduled.map(partLabel).join(', ')}</span>
            <span className="shrink-0 text-right text-[12.5px] text-muted sm:w-24">{unitsText(course.units)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

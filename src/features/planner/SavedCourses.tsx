import { Plus } from 'lucide-react'
import { IconButton } from '../../components/ui'
import type { ScheduleView } from '../../state/schedule-view'
import { useBookmarks, useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import type { Course } from '../../lib/types'
import { initialChoice } from './format'

/** Bookmarked courses not yet in this schedule, one click to add. */
export function SavedCourses({ view, scheduleId, onPreview }: { view: ScheduleView; scheduleId: string; onPreview(courseId: string | null): void }) {
  const term = useTerm()
  const bookmarks = useBookmarks(term.meta.id)
  const addCourse = useStore((s) => s.addCourse)
  const courses = bookmarks.map((id) => term.courseById.get(id)).filter((c): c is Course => !!c && !view.hasCourse(c.id))

  if (!courses.length) return null

  return (
    <section aria-labelledby="saved-courses" className="border-b border-line px-4 py-3">
      <h2 id="saved-courses" className="mb-1.5 text-[13px] font-semibold text-ink-2">
        Saved courses
      </h2>
      <ul className="flex flex-col">
        {courses.map((course) => (
          <li
            key={course.id}
            onMouseEnter={() => onPreview(course.id)}
            onMouseLeave={() => onPreview(null)}
            className="flex items-center gap-2.5 rounded-md py-0.5 pl-1"
          >
            <span className="course-code w-[52px] shrink-0 text-[14px] text-ink">{course.code}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{course.title}</span>
            <IconButton
              size="sm"
              label={`Add ${course.code} to schedule`}
              onFocus={() => onPreview(course.id)}
              onBlur={() => onPreview(null)}
              onClick={() => {
                const choice = initialChoice(course, view)
                addCourse(scheduleId, course.id, choice.section, choice.child)
                onPreview(null)
              }}
            >
              <Plus />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

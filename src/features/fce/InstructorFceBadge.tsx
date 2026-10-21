import { FCE_HOURS_HELP, formatHours, instructorCourseStats, termName, useCourseFce } from '../../lib/fce'

interface InstructorFceBadgeProps {
  courseId: string
  /** Schedule-style name, e.g. "Iliano Cervesato". */
  instructor: string
  /** Show "No FCEs" when this instructor has no history for the course (default: render nothing). */
  showEmpty?: boolean
  className?: string
}

/**
 * Compact FCE line for one instructor teaching one course, for section pickers:
 * their recent teaching rating and the hours students reported in their sections.
 */
export function InstructorFceBadge({ courseId, instructor, showEmpty = false, className = '' }: InstructorFceBadgeProps) {
  const rows = useCourseFce(courseId)
  if (!rows) return null
  const stats = instructorCourseStats(rows, instructor)
  if (!stats) return showEmpty ? <span className={`text-[11.5px] text-muted ${className}`}>No FCEs for this course</span> : null

  const title = `${instructor} in this course: teaching ${stats.teachingRate?.toFixed(2) ?? 'n/a'} of 5, course ${stats.courseRate?.toFixed(2) ?? 'n/a'} of 5, ${formatHours(stats.hours)} hours a week. ${stats.terms} ${stats.terms === 1 ? 'term' : 'terms'} taught, last in ${termName(stats.last)}. ${FCE_HOURS_HELP}`
  return (
    <span title={title} className={`inline-flex items-baseline gap-2 text-[11.5px] text-muted ${className}`}>
      {stats.teachingRate !== null ? (
        <span>
          <span className="font-semibold text-ink-2 tabular-nums">{stats.teachingRate.toFixed(1)}</span> teaching
        </span>
      ) : null}
      {stats.hours !== null ? (
        <span>
          <span className="font-semibold text-ink-2 tabular-nums">{formatHours(stats.hours)}</span> h/wk
        </span>
      ) : null}
      <span className="sr-only">{title}</span>
    </span>
  )
}

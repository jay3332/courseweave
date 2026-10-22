import { nextColor } from '../../lib/colors'
import type { Term } from '../../lib/data'
import { buildScheduleView } from '../../state/schedule-view'
import type { Schedule, ScheduleEntry } from '../../state/store'
import { initialChoice } from './format'

export interface PlannedForTerm {
  courseId: string
  passFail?: boolean
}

/**
 * Schedule entries for courses planned in a degree plan semester. Courses are added in plan order, each with the
 * first lecture/recitation that fits around the ones before it. Courses this term doesn't offer are skipped.
 */
export function entriesFromPlan(planned: PlannedForTerm[], term: Term): { entries: ScheduleEntry[]; skipped: string[] } {
  const entries: ScheduleEntry[] = []
  const skipped: string[] = []
  const draft: Schedule = { id: 'draft', termId: term.meta.id, name: '', entries, createdAt: 0, updatedAt: 0 }
  for (const p of planned) {
    const course = term.courseById.get(p.courseId)
    if (!course) {
      if (!skipped.includes(p.courseId)) skipped.push(p.courseId)
      continue
    }
    if (entries.some((e) => e.courseId === p.courseId)) continue
    const choice = initialChoice(course, buildScheduleView(draft, term))
    entries.push({
      courseId: course.id,
      section: choice.section,
      child: choice.child,
      color: nextColor(entries.map((e) => e.color)),
      hidden: false,
      passFail: Boolean(p.passFail),
    })
  }
  return { entries, skipped }
}

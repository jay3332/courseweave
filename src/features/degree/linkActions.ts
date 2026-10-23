// Plan edits that may land in a schedule: a semester synced with a schedule (PlanTerm.link) shows that
// schedule's courses, so adding, removing, moving and pass/fail changes go to the schedule store. The plan's own
// list for that semester is kept as a snapshot (the fallback if the schedule is deleted, and unit overrides).
import { loadTerm } from '../../lib/data'
import { effectiveTermCourses, linkedCourseId, linkedScheduleId, parseLinkedCourseId, type Plan, type PlanCourse } from '../../lib/plan'
import { usePlans, type SnapshotCourse } from '../../state/plan'
import { buildScheduleView } from '../../state/schedule-view'
import { useStore, type Schedule } from '../../state/store'
import { initialChoice } from '../planner/format'

const schedules = () => useStore.getState().schedules

/** Adds a course to a schedule, then picks a conflict-free section once the term's course data is loaded. */
function addToSchedule(scheduleId: string, term: string, courseId: string, passFail?: boolean) {
  const store = useStore.getState()
  const existing = store.schedules[scheduleId]?.entries.find((e) => e.courseId === courseId)
  store.addCourse(scheduleId, courseId)
  if (existing) return
  if (passFail) store.setPassFail(scheduleId, courseId, true)
  loadTerm(term).then(
    (t) => {
      const s = useStore.getState().schedules[scheduleId]
      const entry = s?.entries.find((e) => e.courseId === courseId)
      const course = t.courseById.get(courseId)
      if (!s || !entry || entry.section !== null || !course) return
      const others: Schedule = { ...s, entries: s.entries.filter((e) => e.courseId !== courseId) }
      const choice = initialChoice(course, buildScheduleView(others, t))
      if (choice.section) useStore.getState().setSection(scheduleId, courseId, choice.section, choice.child)
    },
    () => {},
  )
}

/** Adds a course to a plan semester (or its synced schedule). Returns the plan-course id to focus. */
export function addToTerm(plan: Plan, term: string, courseId: string, opts: { passFail?: boolean; units?: number } = {}): string {
  const scheduleId = linkedScheduleId(plan, term, schedules())
  const planned = usePlans.getState().addCourse(plan.id, term, courseId, opts)
  if (!scheduleId) return planned
  addToSchedule(scheduleId, term, courseId, opts.passFail)
  return linkedCourseId(scheduleId, courseId)
}

function termOfSchedule(plan: Plan, scheduleId: string): string | undefined {
  return plan.terms.find((t) => t.link?.scheduleId === scheduleId)?.term
}

/** Removes a course from the plan, or from the synced schedule it comes from. */
export function removeFromPlan(plan: Plan, planCourseId: string) {
  const linked = parseLinkedCourseId(planCourseId)
  if (!linked) {
    usePlans.getState().removeCourse(plan.id, planCourseId)
    return
  }
  useStore.getState().removeCourse(linked.scheduleId, linked.courseId)
  const term = termOfSchedule(plan, linked.scheduleId)
  if (term) usePlans.getState().removeCourseFromTerm(plan.id, term, linked.courseId)
}

/** The course behind a plan-course id, wherever it lives. */
function findCourse(plan: Plan, planCourseId: string): { term: string; course: PlanCourse } | null {
  const eff = effectiveTermCourses(plan, schedules())
  for (const t of plan.terms) {
    const course = eff.get(t.term)?.courses.find((c) => c.id === planCourseId)
    if (course) return { term: t.term, course }
  }
  return null
}

/** Moves a course between semesters; synced semesters on either side edit their schedules. */
export function moveInPlan(plan: Plan, planCourseId: string, toTerm: string, index?: number) {
  const found = findCourse(plan, planCourseId)
  if (!found || found.term === toTerm) return
  const fromLinked = parseLinkedCourseId(planCourseId) !== null
  const toLinked = linkedScheduleId(plan, toTerm, schedules()) !== null
  if (!fromLinked && !toLinked) {
    usePlans.getState().moveCourse(plan.id, planCourseId, toTerm, index)
    return
  }
  removeFromPlan(plan, planCourseId)
  addToTerm(plan, toTerm, found.course.courseId, { passFail: found.course.passFail, units: found.course.units })
}

export function setPlanPassFail(plan: Plan, planCourseId: string, passFail: boolean) {
  const linked = parseLinkedCourseId(planCourseId)
  if (linked) useStore.getState().setPassFail(linked.scheduleId, linked.courseId, passFail)
  else usePlans.getState().updateCourse(plan.id, planCourseId, { passFail })
}

export function setPlanUnits(plan: Plan, planCourseId: string, units: number | undefined) {
  const linked = parseLinkedCourseId(planCourseId)
  if (!linked) {
    usePlans.getState().updateCourse(plan.id, planCourseId, { units })
    return
  }
  const term = termOfSchedule(plan, linked.scheduleId)
  if (term) usePlans.getState().setCourseUnits(plan.id, term, linked.courseId, units)
}

/** A course's note: on the plan's own course, or (synced semesters) on the semester's snapshot row for it. */
export function setPlanNote(plan: Plan, planCourseId: string, note: string) {
  const linked = parseLinkedCourseId(planCourseId)
  if (!linked) {
    usePlans.getState().updateCourse(plan.id, planCourseId, { note })
    return
  }
  const term = termOfSchedule(plan, linked.scheduleId)
  if (term) usePlans.getState().setCourseNote(plan.id, term, linked.courseId, note)
}

/** Snapshot rows for a schedule's visible courses, carrying unit overrides and notes from the plan's own list. */
function scheduleSnapshot(schedule: Schedule, planCourses: PlanCourse[]): SnapshotCourse[] {
  return schedule.entries
    .filter((e) => !e.hidden)
    .map((e) => {
      const own = planCourses.find((c) => c.courseId === e.courseId)
      return { courseId: e.courseId, passFail: e.passFail, units: own?.units, ...(own?.note ? { note: own.note } : {}) }
    })
}

/**
 * Syncs a plan semester with a schedule. `merge` first adds the semester's planned courses that the schedule
 * lacks; otherwise the schedule is used as is (those planned courses are dropped from the semester).
 */
export function linkTermToSchedule(plan: Plan, term: string, schedule: Schedule, mode: 'merge' | 'as-is') {
  const own = plan.terms.find((t) => t.term === term)?.courses ?? []
  const snapshot = scheduleSnapshot(schedule, own)
  if (mode === 'merge') {
    const have = new Set(snapshot.map((c) => c.courseId))
    for (const c of own) {
      if (have.has(c.courseId)) continue
      have.add(c.courseId)
      addToSchedule(schedule.id, term, c.courseId, c.passFail)
      snapshot.push({ courseId: c.courseId, passFail: c.passFail, units: c.units })
    }
  }
  usePlans.getState().linkTerm(plan.id, term, schedule.id, snapshot)
}

/** Stops syncing; the semester keeps the schedule's current courses (or its snapshot if the schedule is gone). */
export function unlinkTerm(plan: Plan, term: string) {
  const eff = effectiveTermCourses(plan, schedules()).get(term)
  if (!eff?.schedule) {
    usePlans.getState().unlinkTerm(plan.id, term)
    return
  }
  usePlans.getState().unlinkTerm(
    plan.id,
    term,
    eff.courses.map((c) => ({ courseId: c.courseId, passFail: c.passFail, units: c.units })),
  )
}

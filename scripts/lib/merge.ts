import type { Course } from '../../src/lib/types.ts'
import { addInstructors, addMeeting } from './common.ts'

/**
 * Folds a supplement source into the primary course list. Never removes data:
 * - sections missing from primary (e.g. recitations) are added, with their parent link, unless `addMissingSections` is false;
 * - sections present in both get missing instructors, rooms and meetings filled in;
 * - courses missing from primary are added only when `addMissingCourses` is set.
 */
export function mergeSupplement(primary: Map<string, Course>, supplement: Course[], addMissingCourses: boolean, addMissingSections = true) {
  for (const sup of supplement) {
    const course = primary.get(sup.id)
    if (!course) {
      if (addMissingCourses) primary.set(sup.id, structuredClone(sup))
      continue
    }
    if (course.units === null && sup.units !== null) course.units = sup.units
    if (!course.permissionRequired && sup.permissionRequired) course.permissionRequired = true
    for (const s of sup.sections) {
      const existing = course.sections.find((x) => x.name === s.name)
      if (!existing) {
        if (addMissingSections) course.sections.push(structuredClone(s))
        continue
      }
      if (!existing.instructors.length) addInstructors(existing.instructors, s.instructors)
      if (existing.capacity === undefined && s.capacity !== undefined) existing.capacity = s.capacity
      if (!existing.reservations && s.reservations) existing.reservations = [...s.reservations]
      if (existing.parent === null && s.parent !== null) existing.parent = s.parent
      const hasScheduled = existing.meetings.some((m) => m.days.length && m.start !== null)
      if (!hasScheduled) {
        existing.meetings = structuredClone(s.meetings)
        continue
      }
      // Same times, but the primary has no room: take the supplement's.
      for (const m of existing.meetings) {
        if (m.building) continue
        const match = s.meetings.find((x) => x.start === m.start && x.end === m.end && x.days.some((d) => m.days.includes(d)) && x.building)
        if (match) {
          m.building = match.building
          m.room = match.room
        }
      }
      for (const m of s.meetings) if (!existing.meetings.some((x) => x.start === m.start && x.days.join() === m.days.join())) addMeeting(existing, m)
    }
  }
}

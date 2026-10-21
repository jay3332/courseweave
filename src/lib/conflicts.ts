import { isScheduled } from './time'
import type { Meeting, Section } from './types'

/** Mini sections only collide with full-semester sections or the same mini. */
export function minisOverlap(a: number | null, b: number | null): boolean {
  return a === null || b === null || a === b
}

export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  if (!isScheduled(a) || !isScheduled(b)) return false
  if (!a.days.some((d) => b.days.includes(d))) return false
  return a.start < b.end && b.start < a.end
}

export function sectionsConflict(a: Section, b: Section): boolean {
  if (!minisOverlap(a.mini, b.mini)) return false
  return a.meetings.some((ma) => b.meetings.some((mb) => meetingsOverlap(ma, mb)))
}

export interface Placed {
  key: string
  section: Section
}

/** Returns, for each key, the keys it conflicts with. Keys without conflicts are absent. */
export function findConflicts(items: Placed[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sectionsConflict(items[i].section, items[j].section)) {
        out.set(items[i].key, [...(out.get(items[i].key) ?? []), items[j].key])
        out.set(items[j].key, [...(out.get(items[j].key) ?? []), items[i].key])
      }
    }
  }
  return out
}

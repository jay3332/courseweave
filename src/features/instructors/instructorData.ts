import { instructorSlug, lastName, type Instructor, type Term } from '../../lib/data'
import { teachesSection } from '../../lib/sections'
import { codeQuery, normalize, wordStarts } from '../../lib/search'
import { isScheduled } from '../../lib/time'
import type { Course, Section } from '../../lib/types'

export interface Taught {
  course: Course
  section: Section
}

/** Sections this instructor teaches, ordered by course then section. */
export function taughtSections(inst: Instructor, term: Term): Taught[] {
  const out: Taught[] = []
  for (const id of [...inst.courseIds].sort()) {
    const course = term.courseById.get(id)
    if (!course) continue
    for (const section of course.sections) {
      if (teachesSection(course, section, inst.name)) out.push({ course, section })
    }
  }
  return out
}

/** Minutes covered by the union of the sections' meetings (cross-listed duplicates count once). */
function unionMinutes(sections: Section[]): number {
  const byDay = new Map<number, [number, number][]>()
  for (const s of sections) {
    for (const m of s.meetings) {
      if (!isScheduled(m)) continue
      for (const d of m.days) {
        const list = byDay.get(d) ?? []
        list.push([m.start, m.end])
        byDay.set(d, list)
      }
    }
  }
  let total = 0
  for (const intervals of byDay.values()) {
    intervals.sort((a, b) => a[0] - b[0])
    let [curStart, curEnd] = intervals[0]
    for (const [s, e] of intervals.slice(1)) {
      if (s <= curEnd) curEnd = Math.max(curEnd, e)
      else {
        total += curEnd - curStart
        curStart = s
        curEnd = e
      }
    }
    total += curEnd - curStart
  }
  return total
}

/** Scheduled class hours in the busiest week (full-semester sections plus the busier mini). */
export function weeklyHours(sections: Section[], term: Term): number {
  const minis = term.meta.minis.map((m) => m.number)
  if (!minis.length) return unionMinutes(sections) / 60
  let best = 0
  for (const mini of minis) {
    best = Math.max(best, unionMinutes(sections.filter((s) => s.mini === null || s.mini === mini)))
  }
  return best / 60
}

export interface CoInstructor {
  name: string
  slug: string
  courseIds: string[]
}

export function coInstructors(inst: Instructor, taught: Taught[]): CoInstructor[] {
  const map = new Map<string, Set<string>>()
  for (const { course, section } of taught) {
    for (const name of section.instructors) {
      if (name === inst.name) continue
      const set = map.get(name) ?? new Set()
      set.add(course.id)
      map.set(name, set)
    }
  }
  return [...map.entries()]
    .map(([name, ids]) => ({ name, slug: instructorSlug(name), courseIds: [...ids].sort() }))
    .sort((a, b) => b.courseIds.length - a.courseIds.length || lastName(a.name).localeCompare(lastName(b.name)))
}

// ---- Search ----

export interface InstructorDoc {
  inst: Instructor
  name: string
  /** Normalized course titles (and topic titles) they teach. */
  titles: string
  letter: string
}

export function buildInstructorDocs(term: Term): InstructorDoc[] {
  return term.instructors.map((inst) => {
    const titles: string[] = []
    for (const id of inst.courseIds) {
      const course = term.courseById.get(id)
      if (!course) continue
      titles.push(course.title)
      for (const s of course.sections) if (s.title && s.instructors.includes(inst.name)) titles.push(s.title)
    }
    const first = normalize(lastName(inst.name)).charAt(0).toUpperCase()
    return {
      inst,
      name: normalize(inst.name),
      titles: normalize(titles.join(' | ')),
      letter: /[A-Z]/.test(first) ? first : '#',
    }
  })
}

/**
 * 0 = no match. Name matches score far above course matches so people come first.
 * Course-number queries ("15-122", "15122", "15-1") match instructors teaching those courses.
 */
export function scoreInstructor(doc: InstructorDoc, query: string): number {
  const q = normalize(query).trim()
  if (!q) return 1

  const code = codeQuery(q)
  if (code) return doc.inst.courseIds.some((id) => id.startsWith(code)) ? 10 : 0

  let score = 0
  let nameHits = 0
  for (const t of q.split(/\s+/)) {
    const tokenCode = codeQuery(t)
    if (wordStarts(doc.name, t)) {
      score += 100
      nameHits++
    } else if (tokenCode && doc.inst.courseIds.some((id) => id.startsWith(tokenCode))) {
      score += 10
    } else if (wordStarts(doc.titles, t)) {
      score += 5
    } else if (t.length >= 3 && doc.name.includes(t)) {
      score += 40
      nameHits++
    } else {
      return 0
    }
  }
  if (nameHits && doc.name.startsWith(q)) score += 200
  return score
}

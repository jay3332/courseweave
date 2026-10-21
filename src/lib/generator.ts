// Schedule generator: enumerate conflict-free section combinations and rank them by preferences.
// A course's candidates are (section, child) pairs: a lecture plus one of its recitations, or a standalone section.

import { sectionsConflict } from './conflicts'
import { isScheduled } from './time'
import type { Day, Section } from './types'

export interface GeneratorOption {
  section: Section
  /** Recitation/lab of `section`, or null when it has none. */
  child: Section | null
}

export interface GeneratorCourse {
  courseId: string
  /** Candidate choices. Pass a single option to lock a course. */
  options: GeneratorOption[]
  /** Choice to show when several candidates meet at identical times (usually the current one). */
  preferred?: { section: string | null; child: string | null } | null
}

/** A chosen (section, child) pair, by name. */
export interface Choice {
  section: string
  child: string | null
}

export interface LunchWindow {
  /** Minutes since midnight. */
  start: number
  end: number
  /** Minimum contiguous free minutes needed inside the window. */
  minutes: number
}

export interface Preferences {
  /** Classes starting before this (minutes since midnight) are penalized. */
  earliestStart: number | null
  /** Classes ending after this are penalized. */
  latestEnd: number | null
  /** Days the student would rather not have class. */
  daysOff: Day[]
  minimizeGaps: boolean
  lunch: LunchWindow | null
  fewerDays: boolean
}

export const DEFAULT_LUNCH: LunchWindow = { start: 11 * 60 + 30, end: 13 * 60 + 30, minutes: 45 }

export const DEFAULT_PREFERENCES: Preferences = {
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  minimizeGaps: true,
  lunch: null,
  fewerDays: false,
}

/** Per-week counts. With mini sections, each value is the worst of the semester's halves. */
export interface ScoreBreakdown {
  /** Class meetings (per day) starting before earliestStart. */
  earlyClasses: number
  /** Class meetings ending after latestEnd. */
  lateClasses: number
  /** Preferred days off that still have class. */
  daysOffUsed: Day[]
  /** Idle minutes between classes, beyond a 10-minute passing period. */
  gapMinutes: number
  /** Days where the lunch window has no long-enough free stretch. */
  lunchBlockedDays: number
  daysOnCampus: number
}

export interface GeneratedSchedule {
  /** courseId → chosen section and child. */
  sections: Record<string, Choice>
  /** courseId → other choices that meet at exactly the same times as the chosen one. */
  alternatives: Record<string, Choice[]>
  /** Lower is better. */
  penalty: number
  breakdown: ScoreBreakdown
}

export interface GenerateResult {
  /** Best first, at most `maxResults`. */
  results: GeneratedSchedule[]
  /** Conflict-free combinations found (can exceed results.length). */
  found: number
  /** True when the search budget ran out; better combinations may exist. */
  truncated: boolean
  /** Courses passed with no candidates (left out of every result). */
  skipped: string[]
  /** When there are no results: course pairs where every candidate of one conflicts with every candidate of the other. */
  blockingPairs: [string, string][]
}

export interface GenerateOptions {
  /** How many of the best combinations to keep. */
  maxResults?: number
  /** How many conflict-free combinations to score before stopping. */
  maxVisited?: number
  /** Mini numbers in the term (e.g. [3, 4]); used to score each half of the semester separately. */
  minis?: number[]
}

const PASSING_MINUTES = 10

/** Sections are interchangeable for the generator when their mini and scheduled meeting times match. */
function timeSignature(s: Section): string {
  const meetings = s.meetings
    .filter(isScheduled)
    .map((m) => `${m.days.join('')}-${m.start}-${m.end}`)
    .sort()
  return `${s.mini ?? ''}|${meetings.join(',')}`
}

function optionParts(o: GeneratorOption): Section[] {
  return o.child ? [o.section, o.child] : [o.section]
}

function choiceOf(o: GeneratorOption): Choice {
  return { section: o.section.name, child: o.child?.name ?? null }
}

interface Group {
  parts: Section[]
  representative: Choice
  others: Choice[]
}

/** Collapses options whose parts meet at identical times; the preferred option represents its group. */
function groupOptions(course: GeneratorCourse): Group[] {
  const groups = new Map<string, GeneratorOption[]>()
  for (const o of course.options) {
    const sig = `${timeSignature(o.section)}#${o.child ? timeSignature(o.child) : ''}`
    const list = groups.get(sig) ?? []
    list.push(o)
    groups.set(sig, list)
  }
  const pref = course.preferred
  const score = (o: GeneratorOption) =>
    !pref ? 0 : (o.section.name === pref.section ? 2 : 0) + ((o.child?.name ?? null) === pref.child && o.section.name === pref.section ? 1 : 0)
  return [...groups.values()].map((list) => {
    const rep = list.reduce((best, o) => (score(o) > score(best) ? o : best), list[0])
    return { parts: optionParts(rep), representative: choiceOf(rep), others: list.filter((o) => o !== rep).map(choiceOf) }
  })
}

function partsConflict(a: Section[], b: Section[]): boolean {
  return a.some((x) => b.some((y) => sectionsConflict(x, y)))
}

export function evaluate(sections: Section[], prefs: Preferences, minis: number[] = []): { penalty: number; breakdown: ScoreBreakdown } {
  const present = [...new Set(sections.map((s) => s.mini).filter((m): m is number => m !== null))]
  const phases: (number | null)[] = present.length ? (minis.length ? minis : present) : [null]

  const worst: ScoreBreakdown = { earlyClasses: 0, lateClasses: 0, daysOffUsed: [], gapMinutes: 0, lunchBlockedDays: 0, daysOnCampus: 0 }
  let earlyMinutes = 0
  let lateMinutes = 0

  for (const phase of phases) {
    const byDay = new Map<Day, [number, number][]>()
    for (const s of sections) {
      if (phase !== null && s.mini !== null && s.mini !== phase) continue
      for (const m of s.meetings) {
        if (!isScheduled(m)) continue
        for (const d of m.days) {
          const list = byDay.get(d) ?? []
          list.push([m.start, m.end])
          byDay.set(d, list)
        }
      }
    }

    let early = 0
    let late = 0
    let earlyMin = 0
    let lateMin = 0
    let gaps = 0
    let lunchBlocked = 0
    const daysOffUsed: Day[] = []

    for (const [day, intervals] of byDay) {
      intervals.sort((a, b) => a[0] - b[0])
      if (prefs.daysOff.includes(day)) daysOffUsed.push(day)
      let reach = -1
      for (const [start, end] of intervals) {
        if (prefs.earliestStart !== null && start < prefs.earliestStart) {
          early++
          earlyMin += prefs.earliestStart - start
        }
        if (prefs.latestEnd !== null && end > prefs.latestEnd) {
          late++
          lateMin += end - prefs.latestEnd
        }
        if (reach >= 0 && start > reach) gaps += Math.max(0, start - reach - PASSING_MINUTES)
        reach = Math.max(reach, end)
      }
      if (prefs.lunch && longestFree(intervals, prefs.lunch.start, prefs.lunch.end) < Math.min(prefs.lunch.minutes, prefs.lunch.end - prefs.lunch.start)) {
        lunchBlocked++
      }
    }

    worst.earlyClasses = Math.max(worst.earlyClasses, early)
    worst.lateClasses = Math.max(worst.lateClasses, late)
    worst.gapMinutes = Math.max(worst.gapMinutes, gaps)
    worst.lunchBlockedDays = Math.max(worst.lunchBlockedDays, lunchBlocked)
    worst.daysOnCampus = Math.max(worst.daysOnCampus, byDay.size)
    for (const d of daysOffUsed) if (!worst.daysOffUsed.includes(d)) worst.daysOffUsed.push(d)
    earlyMinutes = Math.max(earlyMinutes, earlyMin)
    lateMinutes = Math.max(lateMinutes, lateMin)
  }
  worst.daysOffUsed.sort((a, b) => a - b)

  const penalty =
    worst.earlyClasses * 10 +
    earlyMinutes / 6 +
    worst.lateClasses * 10 +
    lateMinutes / 6 +
    worst.daysOffUsed.length * 40 +
    worst.gapMinutes / (prefs.minimizeGaps ? 6 : 120) +
    worst.lunchBlockedDays * 15 +
    worst.daysOnCampus * (prefs.fewerDays ? 20 : 0.5)

  return { penalty: Math.round(penalty * 100) / 100, breakdown: worst }
}

/** Longest stretch inside [from, to] not covered by any interval. Intervals must be sorted by start. */
function longestFree(intervals: [number, number][], from: number, to: number): number {
  let best = 0
  let cursor = from
  for (const [start, end] of intervals) {
    if (end <= cursor) continue
    if (start >= to) break
    best = Math.max(best, Math.min(start, to) - cursor)
    cursor = Math.max(cursor, end)
    if (cursor >= to) return best
  }
  return Math.max(best, to - cursor)
}

function byPenalty(a: GeneratedSchedule, b: GeneratedSchedule): number {
  return a.penalty - b.penalty || a.breakdown.gapMinutes - b.breakdown.gapMinutes
}

/**
 * Depth-first search over courses (fewest candidate groups first), with candidates ordered by how well they
 * score alone so good combinations are found early. Keeps the best `maxResults` of up to `maxVisited`
 * conflict-free combinations.
 */
export function generateSchedules(courses: GeneratorCourse[], prefs: Preferences, options: GenerateOptions = {}): GenerateResult {
  const maxResults = options.maxResults ?? 2_000
  const maxVisited = options.maxVisited ?? 60_000
  const skipped = courses.filter((c) => c.options.length === 0).map((c) => c.courseId)
  const usable = courses
    .filter((c) => c.options.length > 0)
    .map((c) => {
      const groups = groupOptions(c)
      const solo = new Map(groups.map((g) => [g, evaluate(g.parts, prefs, options.minis).penalty]))
      groups.sort((a, b) => solo.get(a)! - solo.get(b)!)
      return { courseId: c.courseId, groups }
    })
    .sort((a, b) => a.groups.length - b.groups.length)

  // Pairwise conflicts between every group of every course, computed once.
  const flat = usable.flatMap((c, ci) => c.groups.map((g) => ({ ci, g })))
  const index = new Map<Group, number>(flat.map((x, i) => [x.g, i]))
  const n = flat.length
  const clash = new Uint8Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (flat[i].ci !== flat[j].ci && partsConflict(flat[i].g.parts, flat[j].g.parts)) {
        clash[i * n + j] = 1
        clash[j * n + i] = 1
      }
    }
  }

  let results: GeneratedSchedule[] = []
  let found = 0
  let truncated = false
  let nodes = 0
  const maxNodes = maxVisited * 20
  const chosen: number[] = []
  const groupIds = usable.map((c) => c.groups.map((g) => index.get(g)!))
  const compatible = (gi: number) => !chosen.some((c) => clash[c * n + gi])
  /** Forward check: every later course still has some group compatible with the current picks. */
  const viable = (from: number) => {
    for (let j = from; j < usable.length; j++) if (!groupIds[j].some(compatible)) return false
    return true
  }

  const record = () => {
    const sections: Record<string, Choice> = {}
    const alternatives: Record<string, Choice[]> = {}
    const parts: Section[] = []
    usable.forEach((c, k) => {
      const g = flat[chosen[k]].g
      sections[c.courseId] = g.representative
      if (g.others.length) alternatives[c.courseId] = g.others
      parts.push(...g.parts)
    })
    results.push({ sections, alternatives, ...evaluate(parts, prefs, options.minis) })
    if (results.length >= maxResults * 2) results = results.sort(byPenalty).slice(0, maxResults)
  }

  const visit = (i: number): boolean => {
    if (i === usable.length) {
      found++
      record()
      if (found >= maxVisited) {
        truncated = true
        return false
      }
      return true
    }
    for (const gi of groupIds[i]) {
      if (++nodes > maxNodes) {
        truncated = true
        return false
      }
      if (!compatible(gi)) continue
      chosen.push(gi)
      const keepGoing = viable(i + 1) ? visit(i + 1) : true
      chosen.pop()
      if (!keepGoing) return false
    }
    return true
  }
  if (usable.length) visit(0)

  results = results.sort(byPenalty).slice(0, maxResults)

  const blockingPairs: [string, string][] = []
  if (!results.length) {
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const a = usable[i].groups.map((g) => index.get(g)!)
        const b = usable[j].groups.map((g) => index.get(g)!)
        if (a.every((x) => b.every((y) => clash[x * n + y]))) blockingPairs.push([usable[i].courseId, usable[j].courseId])
      }
    }
  }

  return { results, found, truncated, skipped, blockingPairs }
}

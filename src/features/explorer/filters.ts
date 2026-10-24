import { isRemote } from '../../lib/departments'
import { courseIsMini, expectedHours, type FceSummary } from '../../lib/fce'
import { allSelections } from '../../lib/sections'
import { DAY_LETTERS, isScheduled } from '../../lib/time'
import type { Course, Day, Section } from '../../lib/types'

export type SortKey = 'relevance' | 'number' | 'title' | 'units' | 'hours' | 'hours-desc' | 'ratio' | 'rating' | 'teaching'
export type ViewMode = 'list' | 'chart'
export type DayMode = 'any' | 'only'
export type Level = 'U' | 'G'
export type Delivery = 'inperson' | 'remote'

/** A requirement in a program version: "courses that can count toward this". */
export interface ReqRef {
  auditId: number
  nodeId: number
}

export interface Filters {
  depts: string[]
  levels: Level[]
  units: string[]
  days: Day[]
  dayMode: DayMode
  /** Minutes since midnight. Every scheduled meeting must start at/after this. */
  after: number | null
  /** Minutes since midnight. Every scheduled meeting must end at/before this. */
  before: number | null
  delivery: Delivery[]
  /** "full" or a mini number as a string. */
  sessions: string[]
  fits: boolean
  saved: boolean
  scheduledOnly: boolean
  /** FCE hours/week at most. */
  maxHours: number | null
  /** FCE overall course rating at least. */
  minRating: number | null
  /** FCE hours no more than the hours its units suggest (2 × units for minis). */
  withinUnits: boolean
  /** Only courses that can count toward this degree requirement. */
  req: ReqRef | null
}

export const EMPTY_FILTERS: Filters = {
  depts: [],
  levels: [],
  units: [],
  days: [],
  dayMode: 'only',
  after: null,
  before: null,
  delivery: [],
  sessions: [],
  fits: false,
  saved: false,
  scheduledOnly: false,
  maxHours: null,
  minRating: null,
  withinUnits: false,
  req: null,
}

/** Slider ranges for the FCE filters. The far end of each slider means "Any". */
export const MAX_HOURS_RANGE = { min: 3, max: 24, step: 1 }
export const MIN_RATING_RANGE = { min: 3, max: 4.8, step: 0.1 }

export interface UnitBucket {
  id: string
  label: string
  test(units: number | null): boolean
}

export const UNIT_BUCKETS: UnitBucket[] = [
  { id: 'var', label: 'VAR', test: (u) => u === null },
  { id: '0-5', label: '0–5', test: (u) => u !== null && u < 6 },
  { id: '6-8', label: '6–8', test: (u) => u !== null && u >= 6 && u < 9 },
  { id: '9', label: '9', test: (u) => u !== null && u >= 9 && u < 10 },
  { id: '10-12', label: '10–12', test: (u) => u !== null && u >= 10 && u <= 12 },
  { id: '13+', label: '13+', test: (u) => u !== null && u > 12 },
]

const SORTS: SortKey[] = ['relevance', 'number', 'title', 'units', 'hours', 'hours-desc', 'ratio', 'rating', 'teaching']

/** Sorts that need FCE data. */
export const FCE_SORTS: SortKey[] = ['hours', 'hours-desc', 'ratio', 'rating', 'teaching']

function list(params: URLSearchParams, key: string): string[] {
  const v = params.get(key)
  return v ? v.split(',').filter(Boolean) : []
}

/** A slider value from the URL, snapped to its step; values outside the slider's range are ignored. */
function inRange(params: URLSearchParams, key: string, range: { min: number; max: number; step: number }): number | null {
  const raw = params.get(key)
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < range.min || n > range.max) return null
  return Number((Math.round(n / range.step) * range.step).toFixed(1))
}

function minutes(params: URLSearchParams, key: string): number | null {
  const v = params.get(key)
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 24 * 60 ? n : null
}

/** "20440.8515435" → { auditId: 20440, nodeId: 8515435 }. */
export function parseReq(value: string | null): ReqRef | null {
  const m = /^(\d+)\.(\d+)$/.exec(value ?? '')
  return m ? { auditId: Number(m[1]), nodeId: Number(m[2]) } : null
}

export function reqParam(req: ReqRef): string {
  return `${req.auditId}.${req.nodeId}`
}

export function parseFilters(params: URLSearchParams): Filters {
  const dayStr = params.get('days') ?? ''
  const days = [...new Set([...dayStr].map((c) => DAY_LETTERS.indexOf(c as (typeof DAY_LETTERS)[number])).filter((d) => d >= 0))].sort() as Day[]
  return {
    depts: list(params, 'dept'),
    levels: list(params, 'level').filter((l): l is Level => l === 'U' || l === 'G'),
    units: list(params, 'units').filter((u) => UNIT_BUCKETS.some((b) => b.id === u)),
    days,
    dayMode: params.get('daymode') === 'any' ? 'any' : 'only',
    after: minutes(params, 'after'),
    before: minutes(params, 'before'),
    delivery: list(params, 'delivery').filter((d): d is Delivery => d === 'inperson' || d === 'remote'),
    sessions: list(params, 'session'),
    fits: params.get('fits') === '1',
    saved: params.get('saved') === '1',
    scheduledOnly: params.get('scheduled') === '1',
    maxHours: inRange(params, 'maxh', MAX_HOURS_RANGE),
    minRating: inRange(params, 'minrate', MIN_RATING_RANGE),
    withinUnits: params.get('light') === '1',
    req: parseReq(params.get('req')),
  }
}

export function parseView(params: URLSearchParams): ViewMode {
  return params.get('view') === 'chart' ? 'chart' : 'list'
}

/** "Show courses not offered in <term>" (`unoffered=1`). A view option, not a filter: "Clear all" keeps it. */
export function parseShowUnoffered(params: URLSearchParams): boolean {
  return params.get('unoffered') === '1'
}

/** Writes filters into a copy of `params`, keeping unrelated keys (q, sort). */
export function writeFilters(params: URLSearchParams, f: Filters): URLSearchParams {
  const next = new URLSearchParams(params)
  const put = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key))
  put('dept', f.depts.join(','))
  put('level', f.levels.join(','))
  put('units', f.units.join(','))
  put('days', f.days.map((d) => DAY_LETTERS[d]).join(''))
  put('daymode', f.days.length && f.dayMode === 'any' ? 'any' : null)
  put('after', f.after === null ? null : String(f.after))
  put('before', f.before === null ? null : String(f.before))
  put('delivery', f.delivery.join(','))
  put('session', f.sessions.join(','))
  put('fits', f.fits ? '1' : null)
  put('saved', f.saved ? '1' : null)
  put('scheduled', f.scheduledOnly ? '1' : null)
  put('maxh', f.maxHours === null ? null : String(f.maxHours))
  put('minrate', f.minRating === null ? null : String(f.minRating))
  put('light', f.withinUnits ? '1' : null)
  put('req', f.req ? reqParam(f.req) : null)
  return next
}

export function parseSort(params: URLSearchParams, hasQuery: boolean): SortKey {
  const s = params.get('sort') as SortKey | null
  if (s && SORTS.includes(s) && (s !== 'relevance' || hasQuery)) return s
  return hasQuery ? 'relevance' : 'number'
}

export function activeFilterCount(f: Filters): number {
  return (
    (f.depts.length ? 1 : 0) +
    (f.levels.length ? 1 : 0) +
    (f.units.length ? 1 : 0) +
    (f.days.length ? 1 : 0) +
    (f.after !== null || f.before !== null ? 1 : 0) +
    (f.delivery.length ? 1 : 0) +
    (f.sessions.length ? 1 : 0) +
    (f.fits ? 1 : 0) +
    (f.saved ? 1 : 0) +
    (f.scheduledOnly ? 1 : 0) +
    (f.maxHours !== null ? 1 : 0) +
    (f.minRating !== null ? 1 : 0) +
    (f.withinUnits ? 1 : 0) +
    (f.req ? 1 : 0)
  )
}

/** Filters that need a semester's sections; courses the semester doesn't offer can't pass them. */
export function hasSectionFilters(f: Filters): boolean {
  return Boolean(f.days.length || f.after !== null || f.before !== null || f.delivery.length || f.sessions.length || f.fits || f.scheduledOnly)
}

/** A way to take the course: a lecture/section plus, when it has them, one of its recitations. */
interface Choice {
  section: Section
  child: Section | null
}

const choiceKey = (c: Choice) => `${c.section.name}/${c.child?.name ?? ''}`

/**
 * Section-level filters must all hold for the same choice, judged on everything a student would attend:
 * a lecture that meets MWF with a TR recitation doesn't match "Tue/Thu only".
 */
function choiceMatches(choice: Choice, f: Filters, fitting: Set<string> | null): boolean {
  const { section } = choice
  const parts = choice.child ? [section, choice.child] : [section]
  const scheduled = parts.flatMap((p) => p.meetings.filter(isScheduled))

  if (f.scheduledOnly && !scheduled.length) return false

  if (f.days.length) {
    if (!scheduled.length) return false
    const meetsOn = new Set(scheduled.flatMap((m) => m.days))
    if (f.dayMode === 'only') {
      for (const d of meetsOn) if (!f.days.includes(d)) return false
    } else if (!f.days.some((d) => meetsOn.has(d))) {
      return false
    }
  }

  if (f.after !== null || f.before !== null) {
    if (!scheduled.length) return false
    for (const m of scheduled) {
      if (f.after !== null && m.start < f.after) return false
      if (f.before !== null && m.end > f.before) return false
    }
  }

  if (f.delivery.length) {
    const kind: Delivery = isRemote(section.mode) ? 'remote' : 'inperson'
    if (!f.delivery.includes(kind)) return false
  }

  if (f.sessions.length) {
    const mini = section.mini ?? choice.child?.mini ?? null
    const key = mini === null ? 'full' : String(mini)
    if (!f.sessions.includes(key)) return false
  }

  if (fitting && !fitting.has(choiceKey(choice))) return false

  return true
}

export interface FilterContext {
  bookmarks: Set<string>
  /** (Section, recitation) choices of a course that fit the active schedule. Only called when the "fits" filter is on. */
  fittingSelections(course: Course): Choice[]
  /** FCE summaries; when absent (loading or unavailable) the FCE filters are ignored. */
  fce?: Map<string, FceSummary> | null
  /** Whether a course can count toward the requirement filter; absent while it loads (the filter is skipped). */
  reqAccepts?: ((courseId: string) => boolean) | null
}

/** What the FCE filters and sorts read: the semester's course when it's offered (for the mini check), else null. */
interface FceSubject {
  id: string
  title: string
  units: number | null
  course: Course | null
}

const subjectOf = (course: Course): FceSubject => ({ id: course.id, title: course.title, units: course.units, course })

function fceMatches(subject: FceSubject, f: Filters, fce: Map<string, FceSummary> | null | undefined): boolean {
  if (!fce || (f.maxHours === null && f.minRating === null && !f.withinUnits)) return true
  const s = fce.get(subject.id)
  if (f.maxHours !== null && (s?.hours == null || s.hours > f.maxHours)) return false
  if (f.minRating !== null && (s?.courseRate == null || s.courseRate < f.minRating)) return false
  if (f.withinUnits) {
    const expected = expectedHours(subject.units, courseIsMini(subject.course, s))
    if (s?.hours == null || expected === null || s.hours > expected) return false
  }
  return true
}

export function courseMatches(course: Course, f: Filters, ctx: FilterContext): boolean {
  if (f.depts.length && !f.depts.includes(course.dept)) return false
  if (f.levels.length && !f.levels.includes(course.level)) return false
  if (f.units.length && !UNIT_BUCKETS.some((b) => f.units.includes(b.id) && b.test(course.units))) return false
  if (f.saved && !ctx.bookmarks.has(course.id)) return false
  if (f.req && ctx.reqAccepts && !ctx.reqAccepts(course.id)) return false
  if (!fceMatches(subjectOf(course), f, ctx.fce)) return false
  if (!hasSectionFilters(f)) return true
  const fitting = f.fits ? new Set(ctx.fittingSelections(course).map(choiceKey)) : null
  return allSelections(course).some((c) => choiceMatches(c, f, fitting))
}

/** A course the routed semester doesn't offer, as much as other semesters and the catalog tell about it. */
export interface OtherCourse {
  id: string
  code: string
  title: string
  /** Department code, as in the Schedule of Classes; '' when unknown. */
  dept: string
  level: Level
  /** null = variable units (or unknown, see `unitsKnown`). */
  units: number | null
  unitsKnown: boolean
}

/**
 * The filters that don't need this semester's sections. Section filters (days, times, delivery, session, fits,
 * scheduled) can't be met by a course the semester doesn't offer, so they hide every one of them.
 */
export function otherCourseMatches(course: OtherCourse, f: Filters, ctx: Pick<FilterContext, 'bookmarks' | 'fce' | 'reqAccepts'>): boolean {
  if (hasSectionFilters(f)) return false
  if (f.depts.length && !f.depts.includes(course.dept)) return false
  if (f.levels.length && !f.levels.includes(course.level)) return false
  if (f.units.length && !(course.unitsKnown && UNIT_BUCKETS.some((b) => f.units.includes(b.id) && b.test(course.units)))) return false
  if (f.saved && !ctx.bookmarks.has(course.id)) return false
  if (f.req && ctx.reqAccepts && !ctx.reqAccepts(course.id)) return false
  return fceMatches({ id: course.id, title: course.title, units: course.units, course: null }, f, ctx.fce)
}

/** FCE value used by a sort; null sorts last in every direction. */
function fceKey(subject: FceSubject, sort: SortKey, fce: Map<string, FceSummary>): number | null {
  const s = fce.get(subject.id)
  if (!s) return null
  switch (sort) {
    case 'hours':
      return s.hours
    case 'hours-desc':
      return s.hours === null ? null : -s.hours
    case 'ratio':
      return s.hours === null || !subject.units ? null : s.hours / expectedHours(subject.units, courseIsMini(subject.course, s))!
    case 'rating':
      return s.courseRate === null ? null : -s.courseRate
    case 'teaching':
      return s.teachingRate === null ? null : -s.teachingRate
    default:
      return null
  }
}

function sortBy<T>(items: { item: T; score: number }[], view: (item: T) => FceSubject, sort: SortKey, fce?: Map<string, FceSummary> | null): T[] {
  const rows = items.map((x) => ({ item: x.item, score: x.score, v: view(x.item) }))
  if (FCE_SORTS.includes(sort)) {
    const map = fce ?? new Map<string, FceSummary>()
    const keyed = rows.map((r) => ({ ...r, key: fceKey(r.v, sort, map) }))
    keyed.sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? a.v.id.localeCompare(b.v.id) : 1) : -1
      return a.key - b.key || a.v.id.localeCompare(b.v.id)
    })
    return keyed.map((r) => r.item)
  }
  switch (sort) {
    case 'relevance':
      rows.sort((a, b) => b.score - a.score || a.v.id.localeCompare(b.v.id))
      break
    case 'title':
      rows.sort((a, b) => a.v.title.localeCompare(b.v.title) || a.v.id.localeCompare(b.v.id))
      break
    case 'units':
      rows.sort((a, b) => {
        const ua = a.v.units ?? Infinity
        const ub = b.v.units ?? Infinity
        return ua - ub || a.v.id.localeCompare(b.v.id)
      })
      break
    default:
      rows.sort((a, b) => a.v.id.localeCompare(b.v.id))
  }
  return rows.map((r) => r.item)
}

export function sortCourses(items: { course: Course; score: number }[], sort: SortKey, fce?: Map<string, FceSummary> | null): Course[] {
  return sortBy(
    items.map((x) => ({ item: x.course, score: x.score })),
    subjectOf,
    sort,
    fce,
  )
}

/** Same order as `sortCourses`; unknown units sort with variable ones, last. */
export function sortOtherCourses<T extends OtherCourse>(items: { course: T; score: number }[], sort: SortKey, fce?: Map<string, FceSummary> | null): T[] {
  return sortBy(
    items.map((x) => ({ item: x.course, score: x.score })),
    (c) => ({ id: c.id, title: c.title, units: c.units, course: null }),
    sort,
    fce,
  )
}

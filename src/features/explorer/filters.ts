import { isRemote } from '../../lib/departments'
import { courseIsMini, expectedHours, type FceSummary } from '../../lib/fce'
import { DAY_LETTERS, isScheduled } from '../../lib/time'
import type { Course, Day, Section } from '../../lib/types'

export type SortKey = 'relevance' | 'number' | 'title' | 'units' | 'hours' | 'hours-desc' | 'ratio' | 'rating' | 'teaching'
export type ViewMode = 'list' | 'chart'
export type DayMode = 'any' | 'only'
export type Level = 'U' | 'G'
export type Delivery = 'inperson' | 'remote'

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
}

export const MAX_HOURS_OPTIONS = [6, 9, 12, 15, 20]
export const MIN_RATING_OPTIONS = [3.5, 4, 4.5]

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

function positive(params: URLSearchParams, key: string, allowed: number[]): number | null {
  const n = Number(params.get(key))
  return allowed.includes(n) ? n : null
}

function minutes(params: URLSearchParams, key: string): number | null {
  const v = params.get(key)
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 24 * 60 ? n : null
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
    maxHours: positive(params, 'maxh', MAX_HOURS_OPTIONS),
    minRating: positive(params, 'minrate', MIN_RATING_OPTIONS),
    withinUnits: params.get('light') === '1',
  }
}

export function parseView(params: URLSearchParams): ViewMode {
  return params.get('view') === 'chart' ? 'chart' : 'list'
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
    (f.withinUnits ? 1 : 0)
  )
}

function hasSectionFilters(f: Filters): boolean {
  return Boolean(f.days.length || f.after !== null || f.before !== null || f.delivery.length || f.sessions.length || f.fits || f.scheduledOnly)
}

/** Section-level filters must all hold for the same section. */
function sectionMatches(section: Section, f: Filters, fitting: Set<Section> | null): boolean {
  const scheduled = section.meetings.filter(isScheduled)

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
    const key = section.mini === null ? 'full' : String(section.mini)
    if (!f.sessions.includes(key)) return false
  }

  if (fitting && !fitting.has(section)) return false

  return true
}

export interface FilterContext {
  bookmarks: Set<string>
  /** Sections of a course that fit the active schedule. Only called when the "fits" filter is on. */
  fittingSections(course: Course): Section[]
  /** FCE summaries; when absent (loading or unavailable) the FCE filters are ignored. */
  fce?: Map<string, FceSummary> | null
}

function fceMatches(course: Course, f: Filters, fce: Map<string, FceSummary> | null | undefined): boolean {
  if (!fce || (f.maxHours === null && f.minRating === null && !f.withinUnits)) return true
  const s = fce.get(course.id)
  if (f.maxHours !== null && (s?.hours == null || s.hours > f.maxHours)) return false
  if (f.minRating !== null && (s?.courseRate == null || s.courseRate < f.minRating)) return false
  if (f.withinUnits) {
    const expected = expectedHours(course.units, courseIsMini(course, s))
    if (s?.hours == null || expected === null || s.hours > expected) return false
  }
  return true
}

export function courseMatches(course: Course, f: Filters, ctx: FilterContext): boolean {
  if (f.depts.length && !f.depts.includes(course.dept)) return false
  if (f.levels.length && !f.levels.includes(course.level)) return false
  if (f.units.length && !UNIT_BUCKETS.some((b) => f.units.includes(b.id) && b.test(course.units))) return false
  if (f.saved && !ctx.bookmarks.has(course.id)) return false
  if (!fceMatches(course, f, ctx.fce)) return false
  if (!hasSectionFilters(f)) return true
  const fitting = f.fits ? new Set(ctx.fittingSections(course)) : null
  return course.sections.some((s) => sectionMatches(s, f, fitting))
}

/** FCE value used by a sort; null sorts last in every direction. */
function fceKey(course: Course, sort: SortKey, fce: Map<string, FceSummary>): number | null {
  const s = fce.get(course.id)
  if (!s) return null
  switch (sort) {
    case 'hours':
      return s.hours
    case 'hours-desc':
      return s.hours === null ? null : -s.hours
    case 'ratio':
      return s.hours === null || !course.units ? null : s.hours / expectedHours(course.units, courseIsMini(course, s))!
    case 'rating':
      return s.courseRate === null ? null : -s.courseRate
    case 'teaching':
      return s.teachingRate === null ? null : -s.teachingRate
    default:
      return null
  }
}

export function sortCourses(items: { course: Course; score: number }[], sort: SortKey, fce?: Map<string, FceSummary> | null): Course[] {
  const out = [...items]
  if (FCE_SORTS.includes(sort)) {
    const map = fce ?? new Map<string, FceSummary>()
    const keyed = out.map((x) => ({ course: x.course, key: fceKey(x.course, sort, map) }))
    keyed.sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? a.course.id.localeCompare(b.course.id) : 1) : -1
      return a.key - b.key || a.course.id.localeCompare(b.course.id)
    })
    return keyed.map((x) => x.course)
  }
  switch (sort) {
    case 'relevance':
      out.sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id))
      break
    case 'title':
      out.sort((a, b) => a.course.title.localeCompare(b.course.title) || a.course.id.localeCompare(b.course.id))
      break
    case 'units':
      out.sort((a, b) => {
        const ua = a.course.units ?? Infinity
        const ub = b.course.units ?? Infinity
        return ua - ub || a.course.id.localeCompare(b.course.id)
      })
      break
    default:
      out.sort((a, b) => a.course.id.localeCompare(b.course.id))
  }
  return out.map((x) => x.course)
}

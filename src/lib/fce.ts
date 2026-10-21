// Faculty Course Evaluation data (built by scripts/build-fce.ts). Everything degrades to "no data" when the
// FCE files aren't present, so the app still works without access to the CMU-internal export.
import { useEffect, useState } from 'react'
import { NameIndex, sameInstructor, termName, termOrder } from './fce-names'

export { sameInstructor, termName, termOrder }

/** What students reported in the hours question; shown in tooltips wherever FCE hours appear. */
export const FCE_HOURS_HELP =
  'Average hours per week students reported spending on the course in FCEs, including class time, readings, assignments and studying. CMU expects about 1 hour of work per unit each week.'

export interface FceSummary {
  /** Response-weighted hours/week over the recent terms; null when not reported. */
  hours: number | null
  /** Overall course rating (1–5). */
  courseRate: number | null
  /** Overall teaching rating (1–5). */
  teachingRate: number | null
  /** Responses in the recent window. */
  responses: number
  /** Terms in the recent window (at most `recentTerms`). */
  terms: number
  /** Terms with any responses, ever. */
  totalTerms: number
  /** Latest term with responses, e.g. "S26". */
  last: string
  /** Hours now minus hours in the window before, when both exist. */
  hoursDelta: number | null
  /** Average enrollment per recent term. */
  enrolled: number | null
}

export interface FceSummaryData {
  latest: string
  recentTerms: number
  courses: Map<string, FceSummary>
}

export interface FceRow {
  term: string
  section: string
  /** As it appears in FCEs: "LAST, First". */
  instructor: string
  enrolled: number
  responses: number
  hours: number | null
  teachingRate: number | null
  courseRate: number | null
  /** The seven teaching questions, in FCE_QUESTIONS order. */
  questions: (number | null)[]
}

export const FCE_QUESTIONS = [
  'Interest in student learning',
  'Explains course requirements clearly',
  'Clear learning objectives and goals',
  'Gives feedback to help students improve',
  'Shows why the subject matters',
  'Explains the subject matter',
  'Shows respect for all students',
]

export interface InstructorCourseFce {
  courseId: string
  terms: number
  responses: number
  teachingRate: number | null
  courseRate: number | null
  hours: number | null
  last: string
  first: string
}

export interface InstructorFce {
  name: string
  courses: InstructorCourseFce[]
  /** Oldest first. */
  terms: { term: string; teachingRate: number | null; responses: number }[]
}

const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${base}data/fce/${path}`)
    if (!r.ok) return null
    // Vite's dev server answers unknown paths with index.html.
    if (!(r.headers.get('content-type') ?? '').includes('json')) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

type SummaryTuple = [number | null, number | null, number | null, number, number, number, string, number | null, number | null]

let summaryPromise: Promise<FceSummaryData | null> | null = null
export function loadFceSummary(): Promise<FceSummaryData | null> {
  summaryPromise ??= getJson<{ latest: string; recentTerms: number; courses: Record<string, SummaryTuple> }>('summary.json').then((raw) => {
    if (!raw) return null
    const courses = new Map<string, FceSummary>()
    for (const [id, t] of Object.entries(raw.courses)) {
      courses.set(id, {
        hours: t[0],
        courseRate: t[1],
        teachingRate: t[2],
        responses: t[3],
        terms: t[4],
        totalTerms: t[5],
        last: t[6],
        hoursDelta: t[7],
        enrolled: t[8],
      })
    }
    return { latest: raw.latest, recentTerms: raw.recentTerms, courses }
  })
  return summaryPromise
}

type RowTuple = [string, string, string, number, number, number | null, number | null, number | null, (number | null)[]]
const chunkPromises = new Map<string, Promise<Map<string, FceRow[]>>>()
function loadChunk(prefix: string): Promise<Map<string, FceRow[]>> {
  let p = chunkPromises.get(prefix)
  if (!p) {
    p = getJson<Record<string, RowTuple[]>>(`courses/${prefix}.json`).then((raw) => {
      const out = new Map<string, FceRow[]>()
      for (const [id, rows] of Object.entries(raw ?? {})) {
        out.set(
          id,
          rows.map((r) => ({
            term: r[0],
            section: r[1],
            instructor: r[2],
            enrolled: r[3],
            responses: r[4],
            hours: r[5],
            teachingRate: r[6],
            courseRate: r[7],
            questions: r[8],
          })),
        )
      }
      return out
    })
    chunkPromises.set(prefix, p)
  }
  return p
}

/** Every FCE row for a course, newest first (empty when none). */
export async function loadCourseFce(courseId: string): Promise<FceRow[]> {
  return (await loadChunk(courseId.slice(0, 2))).get(courseId) ?? []
}

interface InstructorFile {
  instructors: Record<string, { name: string; courses: Record<string, [number, number, number | null, number | null, number | null, string, string]>; terms: [string, number | null, number][] }>
}
let instructorIndexPromise: Promise<NameIndex<InstructorFce> | null> | null = null
export function loadInstructorIndex(): Promise<NameIndex<InstructorFce> | null> {
  instructorIndexPromise ??= getJson<InstructorFile>('instructors.json').then((raw) => {
    if (!raw) return null
    const index = new NameIndex<InstructorFce>()
    for (const [key, inst] of Object.entries(raw.instructors)) {
      index.addKey(key, {
        name: inst.name,
        courses: Object.entries(inst.courses)
          .map(([courseId, c]) => ({ courseId, terms: c[0], responses: c[1], teachingRate: c[2], courseRate: c[3], hours: c[4], last: c[5], first: c[6] }))
          .sort((a, b) => termOrder(b.last) - termOrder(a.last) || a.courseId.localeCompare(b.courseId)),
        terms: inst.terms.map(([term, teachingRate, responses]) => ({ term, teachingRate, responses })),
      })
    }
    return index
  })
  return instructorIndexPromise
}

function usePromise<T>(key: string | null, load: () => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string | null; value: T | undefined }>({ key, value: undefined })
  useEffect(() => {
    if (key === null) return
    let cancelled = false
    load().then((value) => !cancelled && setState({ key, value }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state.value : undefined
}

/** undefined while loading, null when FCE data isn't available. */
export function useFceSummary(): FceSummaryData | null | undefined {
  return usePromise('summary', loadFceSummary)
}

/** undefined while loading; [] when the course has no FCEs. */
export function useCourseFce(courseId: string | null): FceRow[] | undefined {
  return usePromise(courseId, () => loadCourseFce(courseId!))
}

/** undefined while loading; null when no FCE history matches this (schedule-style) name. */
export function useInstructorFce(name: string | null): InstructorFce | null | undefined {
  const index = usePromise(name === null ? null : 'instructors', loadInstructorIndex)
  if (name === null || index === undefined) return undefined
  return index?.get(name) ?? null
}

// ---- Derived values and formatting ----

/** FCE hours per unit; null when either is unknown or units is 0. */
export function workloadRatio(hours: number | null | undefined, units: number | null | undefined): number | null {
  if (hours == null || units == null || units <= 0) return null
  return hours / units
}

export type WorkloadTone = 'light' | 'even' | 'heavy' | 'very-heavy'

/** How the reported hours compare with what the units imply. */
export function workloadTone(ratio: number | null): WorkloadTone | null {
  if (ratio === null) return null
  if (ratio < 0.85) return 'light'
  if (ratio <= 1.15) return 'even'
  if (ratio <= 1.5) return 'heavy'
  return 'very-heavy'
}

export const WORKLOAD_TONE_LABEL: Record<WorkloadTone, string> = {
  light: 'Lighter than its units',
  even: 'About what its units suggest',
  heavy: 'Heavier than its units',
  'very-heavy': 'Much heavier than its units',
}

/** Text color class for a workload tone. */
export const WORKLOAD_TONE_CLASS: Record<WorkloadTone, string> = {
  light: 'text-ok',
  even: 'text-ink-2',
  heavy: 'text-warn',
  'very-heavy': 'text-danger',
}

export function formatHours(h: number | null | undefined): string {
  return h == null ? '—' : h.toFixed(1)
}

export function formatRating(r: number | null | undefined): string {
  return r == null ? '—' : r.toFixed(2)
}

/** Weighted mean helper for UI aggregates. */
export function weightedMean<T>(items: T[], value: (x: T) => number | null, weight: (x: T) => number): number | null {
  let sum = 0
  let w = 0
  for (const x of items) {
    const v = value(x)
    const wt = weight(x)
    if (v === null || wt <= 0) continue
    sum += v * wt
    w += wt
  }
  return w ? sum / w : null
}

/** Groups FCE rows by term (newest first), with response-weighted aggregates per term. */
export function fceByTerm(rows: FceRow[]): { term: string; hours: number | null; courseRate: number | null; teachingRate: number | null; responses: number }[] {
  const groups = new Map<string, FceRow[]>()
  for (const r of rows) groups.set(r.term, [...(groups.get(r.term) ?? []), r])
  return [...groups.entries()]
    .sort((a, b) => termOrder(b[0]) - termOrder(a[0]))
    .map(([term, list]) => {
      const answered = list.filter((r) => r.responses > 0)
      return {
        term,
        hours: weightedMean(answered, (r) => r.hours, (r) => r.responses),
        courseRate: weightedMean(answered, (r) => r.courseRate, (r) => r.responses),
        teachingRate: weightedMean(answered, (r) => r.teachingRate, (r) => r.responses),
        responses: answered.reduce((n, r) => n + r.responses, 0),
      }
    })
}

/** Recent FCE stats for one instructor teaching one course (from that course's rows). */
export function instructorCourseStats(rows: FceRow[], scheduleName: string, recentTerms = 4) {
  const mine = rows.filter((r) => r.responses > 0 && sameInstructor(r.instructor, scheduleName))
  if (!mine.length) return null
  const terms = [...new Set(mine.map((r) => r.term))].sort((a, b) => termOrder(b) - termOrder(a))
  const recent = new Set(terms.slice(0, recentTerms))
  const window = mine.filter((r) => recent.has(r.term))
  return {
    terms: terms.length,
    last: terms[0],
    responses: window.reduce((n, r) => n + r.responses, 0),
    teachingRate: weightedMean(window, (r) => r.teachingRate, (r) => r.responses),
    courseRate: weightedMean(window, (r) => r.courseRate, (r) => r.responses),
    hours: weightedMean(window, (r) => r.hours, (r) => r.responses),
  }
}

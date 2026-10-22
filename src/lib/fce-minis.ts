// Mini-semester workload math, shared by the FCE UI and the degree plan. No React, so pure libs can import it.
//
// 1 unit ≈ 1 hour of work a week over a FULL semester. A mini runs for half a semester, so the same units
// mean about twice the weekly hours while it runs (a 6-unit mini ≈ 12 h/wk). FCE "hours per week" for a mini
// section is the in-session figure, so hours-vs-units comparisons use expectedHours(units, mini).
// Official unit totals never change: a 4.5-unit mini still counts 4.5 units.

/** Weekly hours a course's units suggest while it runs. */
export function expectedHours(units: number | null | undefined, mini: boolean): number | null {
  if (units == null) return null
  return mini ? units * 2 : units
}

/** How a course is usually taught, from its recent FCE sections. */
export interface FceMiniInfo {
  /** Share of recent FCE sections that were minis (0–1). */
  share: number
  /** Which half those minis ran in; "either" when both halves. Null when never a mini. */
  half: 'first' | 'second' | 'either' | null
}

/** Treat a course as a mini when at least this share of its recent sections were. */
export const MINI_SHARE_THRESHOLD = 0.5

export function isMostlyMini(info: FceMiniInfo | null | undefined): boolean {
  return !!info && info.share >= MINI_SHARE_THRESHOLD
}

// The FCE summary registers itself here when it loads (src/lib/fce.ts), so pure code can look minis up
// synchronously. Before it loads (or without FCE data) every course reads as full-semester.
let source: ((courseId: string) => FceMiniInfo | null) | null = null

export function setFceMiniSource(lookup: ((courseId: string) => FceMiniInfo | null) | null) {
  source = lookup
}

export function fceMiniOf(courseId: string): FceMiniInfo | null {
  return source ? source(courseId) : null
}

export interface HalfLoad {
  /** Hours in this half: full-semester courses plus this half's minis. */
  hours: number
  /** Weekly hours the units suggest: full units + 2 × this half's mini units. */
  expected: number
}

export interface LoadItem {
  hours: number
  units: number
  /** Null for full-semester courses. */
  half: 'first' | 'second' | 'either' | null
}

/**
 * Splits a term's weekly load into its two halves. Full-semester courses count in both; minis count in their
 * half. Minis that could run in either half go to whichever half is lighter at that point (an estimate).
 */
export function splitHalves(items: LoadItem[]): { first: HalfLoad; second: HalfLoad; hasMinis: boolean } {
  const first: HalfLoad = { hours: 0, expected: 0 }
  const second: HalfLoad = { hours: 0, expected: 0 }
  const add = (h: HalfLoad, item: LoadItem, factor: number) => {
    h.hours += item.hours
    h.expected += item.units * factor
  }
  for (const i of items) {
    if (i.half === null) {
      add(first, i, 1)
      add(second, i, 1)
    }
  }
  for (const i of items) {
    if (i.half === 'first') add(first, i, 2)
    else if (i.half === 'second') add(second, i, 2)
  }
  for (const i of items) {
    if (i.half === 'either') add(first.hours <= second.hours ? first : second, i, 2)
  }
  return { first, second, hasMinis: items.some((i) => i.half !== null) }
}

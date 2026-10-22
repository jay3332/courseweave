// Which semesters offer each course (public/data/offerings.json, written by the data build), so a search or a link to
// a course the routed semester doesn't offer can point at one that does. Loaded on first use.
import { useEffect, useState } from 'react'
import { isJsonResponse } from './http'
import { termOrdinal } from './requisites'
import { codeQuery, normalize, scoreCourse, type ScoredDoc } from './search'
import type { OfferingsData } from './types'

export interface Offering {
  id: string
  title: string
  dept: string
  level: string
  /** Built terms offering it, newest first. */
  terms: string[]
}

export interface Offerings {
  byId: Map<string, Offering>
  docs: (ScoredDoc & { offering: Offering })[]
}

let promise: Promise<Offerings | null> | null = null

/** null when the build has no offerings file (older deploys, plain dev without npm run data). */
export function loadOfferings(): Promise<Offerings | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}data/offerings.json`)
    .then(async (r) => {
      if (!isJsonResponse(r)) return null
      const data = (await r.json()) as OfferingsData
      const list = Object.entries(data.courses).map(([id, c]) => ({ id, ...c }))
      return {
        byId: new Map(list.map((o) => [o.id, o])),
        docs: list.map((o) => ({ offering: o, course: { id: o.id, dept: o.dept }, title: normalize(o.title), instructors: '', sectionTitles: '' })),
      }
    })
    .catch(() => {
      promise = null
      return null
    })
  return promise
}

/** The offerings index once loaded (undefined while loading, null when unavailable). Loads only when `enabled`. */
export function useOfferings(enabled = true): Offerings | null | undefined {
  const [value, setValue] = useState<Offerings | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadOfferings().then((v) => !cancelled && setValue(v))
    return () => {
      cancelled = true
    }
  }, [enabled])
  return enabled ? value : undefined
}

/** Courses matching `query` that `termId` doesn't offer, best first. */
export function searchOtherTerms(offerings: Offerings, termId: string, query: string, accept: (o: Offering) => boolean = () => true): Offering[] {
  if (!query.trim()) return []
  const scored: { o: Offering; score: number }[] = []
  for (const doc of offerings.docs) {
    if (doc.offering.terms.includes(termId) || !accept(doc.offering)) continue
    const score = scoreCourse(doc, query)
    if (score > 0) scored.push({ o: doc.offering, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.o.id.localeCompare(b.o.id)).map((s) => s.o)
}

/** The offering term closest to `termId` (a later one wins a tie), to suggest first. */
export function nearestTerm(terms: string[], termId: string): string | undefined {
  const here = termOrdinal(termId) ?? 0
  return [...terms].sort((a, b) => {
    const da = Math.abs((termOrdinal(a) ?? 0) - here)
    const db = Math.abs((termOrdinal(b) ?? 0) - here)
    return da - db || (termOrdinal(b) ?? 0) - (termOrdinal(a) ?? 0)
  })[0]
}

/** The five-digit course id a query names exactly ("15-150", "15150"), if any. */
export function exactCourseId(query: string): string | null {
  const code = codeQuery(normalize(query).trim())
  return code && code.length === 5 ? code : null
}

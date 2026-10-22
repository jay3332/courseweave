import { isJsonResponse } from './http'
import { useEffect, useState } from 'react'
import type { CatalogDetails, CatalogEntry, CatalogIndex, Requisite } from './catalog-types'
import { isRequired, requisiteCourses } from './requisite-format'

export { formatRequisite, isRequired, requisiteCourses, requisiteSize } from './requisite-format'

const base = import.meta.env.BASE_URL

export type Loadable<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; value: T }

let indexPromise: Promise<CatalogIndex> | null = null
let indexValue: CatalogIndex | null = null
const chunkPromises = new Map<string, Promise<Record<string, CatalogDetails>>>()
const chunkValues = new Map<string, Record<string, CatalogDetails>>()

export function loadCatalogIndex(): Promise<CatalogIndex> {
  indexPromise ??= fetch(`${base}data/catalog/index.json`)
    .then((r) => {
      if (!isJsonResponse(r)) throw new Error(`Couldn't load the course catalog (HTTP ${r.status}).`)
      return r.json() as Promise<CatalogIndex>
    })
    .then((index) => {
      indexValue = index
      return index
    })
  indexPromise.catch(() => (indexPromise = null))
  return indexPromise
}

function loadChunk(prefix: string): Promise<Record<string, CatalogDetails>> {
  let p = chunkPromises.get(prefix)
  if (!p) {
    p = fetch(`${base}data/catalog/details/${prefix}.json`)
      .then((r) => {
        // A missing chunk just means no course with this prefix has details.
        if (r.status === 404) return {}
        if (!isJsonResponse(r)) throw new Error(`Couldn't load course descriptions (HTTP ${r.status}).`)
        return r.json() as Promise<Record<string, CatalogDetails>>
      })
      .then((chunk) => {
        chunkValues.set(prefix, chunk)
        return chunk
      })
    p.catch(() => chunkPromises.delete(prefix))
    chunkPromises.set(prefix, p)
  }
  return p
}

/** Description and profile for a course, or null when the catalog has none. */
export async function loadCatalogDetails(courseId: string): Promise<CatalogDetails | null> {
  const chunk = await loadChunk(courseId.slice(0, 2))
  return chunk[courseId] ?? null
}

function useLoadable<T>(key: string, peek: () => T | undefined, load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<{ key: string; result: Loadable<T> }>(() => {
    const v = peek()
    return { key, result: v !== undefined ? { status: 'ready', value: v } : { status: 'loading' } }
  })
  const cached = peek()
  useEffect(() => {
    if (cached !== undefined) return
    let cancelled = false
    load().then(
      (value) => !cancelled && setState({ key, result: { status: 'ready', value } }),
      (e: unknown) => !cancelled && setState({ key, result: { status: 'error', error: e instanceof Error ? e.message : String(e) } }),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cached === undefined])
  if (cached !== undefined) return { status: 'ready', value: cached }
  return state.key === key ? state.result : { status: 'loading' }
}

export function useCatalogIndex(): Loadable<CatalogIndex> {
  return useLoadable('index', () => indexValue ?? undefined, loadCatalogIndex)
}

/** A course's catalog entry; ready with null when the catalog doesn't know the course. */
export function useCatalogEntry(id: string): Loadable<CatalogEntry | null> {
  const index = useCatalogIndex()
  if (index.status !== 'ready') return index
  return { status: 'ready', value: index.value.courses[id] ?? null }
}

export function useCatalogDetails(id: string): Loadable<CatalogDetails | null> {
  const prefix = id.slice(0, 2)
  return useLoadable(
    `details:${id}`,
    () => {
      const chunk = chunkValues.get(prefix)
      return chunk ? (chunk[id] ?? null) : undefined
    },
    () => loadCatalogDetails(id),
  )
}

export interface Unlock {
  /** The course that lists the requirement. */
  id: string
  /** prereq: appears in its prerequisites; coreq: listed as a corequisite (and not a prerequisite). */
  via: 'prereq' | 'coreq'
  /** True when every way to satisfy its prerequisites needs this course (always false for coreqs). */
  required: boolean
}

const unlockCache = new WeakMap<CatalogIndex, Map<string, Unlock[]>>()

/** Reverse requisite index: course id → courses whose prerequisites or corequisites mention it. */
export function buildUnlocks(index: CatalogIndex): Map<string, Unlock[]> {
  const cached = unlockCache.get(index)
  if (cached) return cached
  const out = new Map<string, Unlock[]>()
  const add = (from: string, u: Unlock) => {
    const list = out.get(from)
    if (list) list.push(u)
    else out.set(from, [u])
  }
  for (const entry of Object.values(index.courses)) {
    const pre = requisiteCourses(entry.prereqs)
    for (const id of pre) if (id !== entry.id) add(id, { id: entry.id, via: 'prereq', required: isRequired(entry.prereqs, id) })
    for (const id of entry.coreqs) if (id !== entry.id && !pre.includes(id)) add(id, { id: entry.id, via: 'coreq', required: false })
  }
  for (const list of out.values()) list.sort((a, b) => a.id.localeCompare(b.id))
  unlockCache.set(index, out)
  return out
}

/**
 * Length of the longest prerequisite chain below a course (0 = no prerequisites).
 * Takes the easiest alternative at each "or", so it measures the shortest path to eligibility.
 */
export function prerequisiteDepth(index: CatalogIndex, id: string, memo = new Map<string, number>(), visiting = new Set<string>()): number {
  const known = memo.get(id)
  if (known !== undefined) return known
  if (visiting.has(id)) return 0
  visiting.add(id)
  const depthOf = (r: Requisite): number => {
    switch (r.type) {
      case 'course':
        return 1 + prerequisiteDepth(index, r.id, memo, visiting)
      case 'text':
        return 0
      case 'all':
        return Math.max(...r.items.map(depthOf))
      case 'any':
        return Math.min(...r.items.map(depthOf))
      case 'atLeast': {
        const sorted = r.items.map(depthOf).sort((a, b) => a - b)
        return sorted[Math.min(r.n, sorted.length) - 1] ?? 0
      }
    }
  }
  const req = index.courses[id]?.prereqs
  const depth = req ? depthOf(req) : 0
  visiting.delete(id)
  memo.set(id, depth)
  return depth
}

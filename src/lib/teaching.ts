// Who teaches what in each built semester (public/data/teaching.json, written by the data build), for the
// all-semesters instructor list. Loaded on first use.
import { useEffect, useState } from 'react'
import { isJsonResponse } from './http'
import type { TeachingData } from './types'

let promise: Promise<TeachingData | null> | null = null

/** null when the build has no teaching file (older deploys, plain dev without npm run data). */
export function loadTeaching(): Promise<TeachingData | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}data/teaching.json`)
    .then((r) => (isJsonResponse(r) ? (r.json() as Promise<TeachingData>) : null))
    .catch(() => {
      promise = null
      return null
    })
  return promise
}

/** The teaching index once loaded (undefined while loading, null when unavailable). Loads only when `enabled`. */
export function useTeaching(enabled = true): TeachingData | null | undefined {
  const [value, setValue] = useState<TeachingData | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadTeaching().then((v) => !cancelled && setValue(v))
    return () => {
      cancelled = true
    }
  }, [enabled])
  return enabled ? value : undefined
}

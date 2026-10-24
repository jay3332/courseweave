// Past syllabi for a course: the index (/data/syllabi/<NN>.json) and links to the files (/api/syllabi/<key>). Both
// need CMU sign-in, like FCEs; see syllabus-files.ts.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { SyllabiChunk, SyllabusEntry } from './syllabus-files'

const base = import.meta.env.BASE_URL

/** Bumped when someone signs in or out, so the index loads again with the new session. */
const useSyllabiGeneration = create<{ generation: number }>(() => ({ generation: 0 }))
const chunks = new Map<string, Promise<SyllabiChunk | 'locked'>>()

export function resetSyllabiCaches() {
  chunks.clear()
  useSyllabiGeneration.setState((s) => ({ generation: s.generation + 1 }))
}

function loadChunk(prefix: string): Promise<SyllabiChunk | 'locked'> {
  let p = chunks.get(prefix)
  if (!p) {
    p = fetch(`${base}data/syllabi/${prefix}.json`, { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 401) return 'locked' as const
        // No file for this prefix (or the dev server's index.html): no syllabi.
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return {}
        return (await r.json()) as SyllabiChunk
      })
      .catch(() => {
        chunks.delete(prefix)
        return {}
      })
    chunks.set(prefix, p)
  }
  return p
}

/** A course's past syllabi, newest first: undefined while loading, 'locked' without CMU sign-in. */
export function useCourseSyllabi(courseId: string): SyllabusEntry[] | 'locked' | undefined {
  const generation = useSyllabiGeneration((s) => s.generation)
  const key = `${courseId}#${generation}`
  const [state, setState] = useState<{ key: string; value: SyllabusEntry[] | 'locked' } | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadChunk(courseId.slice(0, 2)).then((chunk) => {
      if (!cancelled) setState({ key, value: chunk === 'locked' ? 'locked' : (chunk[courseId] ?? []) })
    })
    return () => {
      cancelled = true
    }
  }, [courseId, key])
  return state?.key === key ? state.value : undefined
}

/** Where a hosted syllabus opens (PDFs show in the browser) or downloads. */
export function syllabusHref(key: string, download = false): string {
  return `${base}api/syllabi/${key.split('/').map(encodeURIComponent).join('/')}${download ? '?download=1' : ''}`
}

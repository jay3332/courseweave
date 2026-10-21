import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadTerm, loadTerms, type Term } from '../lib/data'
import type { TermIndexEntry } from '../lib/types'
import { useStore } from './store'

const TermContext = createContext<Term | null>(null)

/** The currently routed term. Only usable below <TermProvider>. */
export function useTerm(): Term {
  const term = useContext(TermContext)
  if (!term) throw new Error('useTerm() must be used inside <TermProvider>')
  return term
}

type Loadable<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; value: T }

function useLoad<T>(key: string, load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<{ key: string; result: Loadable<T> }>({ key, result: { status: 'loading' } })
  useEffect(() => {
    let cancelled = false
    load().then(
      (value) => !cancelled && setState({ key, result: { status: 'ready', value } }),
      (e: unknown) => !cancelled && setState({ key, result: { status: 'error', error: e instanceof Error ? e.message : String(e) } }),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state.result : { status: 'loading' }
}

export function useTerms(): Loadable<TermIndexEntry[]> {
  return useLoad('terms', loadTerms)
}

export function TermProvider({ termId, fallback, error, children }: { termId: string; fallback: ReactNode; error: (message: string) => ReactNode; children: ReactNode }) {
  const result = useLoad(termId, () => loadTerm(termId))
  const ensureSchedule = useStore((s) => s.ensureSchedule)
  const ready = result.status === 'ready'

  useEffect(() => {
    if (ready) ensureSchedule(termId)
  }, [ready, termId, ensureSchedule])

  if (result.status === 'loading') return fallback
  if (result.status === 'error') return error(result.error)
  return <TermContext.Provider value={result.value}>{children}</TermContext.Provider>
}

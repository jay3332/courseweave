// Loading degree programs and running audits in components.

import { useEffect, useMemo, useState } from 'react'
import { relatedAuditIds, runAudit } from './audit'
import { loadCatalogIndex, type Loadable } from './catalog'
import type { CatalogIndex } from './catalog-types'
import type { ProgramVersion } from './degree-types'
import type { AuditInput, AuditResult, ProgramInfo, ProgramsIndex, ProgramVersionInfo } from './plan-types'

const base = import.meta.env.BASE_URL

let indexPromise: Promise<ProgramsIndex> | null = null
let indexValue: ProgramsIndex | null = null
const versionPromises = new Map<number, Promise<ProgramVersion>>()
const versionValues = new Map<number, ProgramVersion>()

export function loadProgramsIndex(): Promise<ProgramsIndex> {
  indexPromise ??= fetch(`${base}data/programs/index.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load degree programs (HTTP ${r.status}). Run npm run data with the ScottyLabs export available.`)
      return r.json() as Promise<ProgramsIndex>
    })
    .then((index) => {
      indexValue = index
      return index
    })
  indexPromise.catch(() => (indexPromise = null))
  return indexPromise
}

export function loadProgramVersion(auditId: number): Promise<ProgramVersion> {
  let p = versionPromises.get(auditId)
  if (!p) {
    p = fetch(`${base}data/programs/${auditId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load requirements for program version ${auditId} (HTTP ${r.status}).`)
        return r.json() as Promise<ProgramVersion>
      })
      .then((v) => {
        versionValues.set(auditId, v)
        return v
      })
    p.catch(() => versionPromises.delete(auditId))
    versionPromises.set(auditId, p)
  }
  return p
}

/** Selected versions plus everything they bring in (college gen-ed, chosen concentrations). */
export async function loadAuditVersions(input: AuditInput): Promise<Map<number, ProgramVersion>> {
  const versions = new Map<number, ProgramVersion>()
  const selected = await Promise.all(input.programs.map((p) => loadProgramVersion(p.auditId)))
  for (const v of selected) versions.set(v.auditId, v)
  const related = await Promise.all(relatedAuditIds(input, versions).map((id) => loadProgramVersion(id).catch(() => null)))
  for (const v of related) if (v) versions.set(v.auditId, v)
  return versions
}

/** The best version of a program for a student who entered in `entryYear` (newest Pittsburgh otherwise). */
export function defaultVersion(program: ProgramInfo, entryYear?: number | null, campus = 'Pittsburgh'): ProgramVersionInfo | null {
  const versions = program.versions
  if (!versions.length) return null
  const local = versions.filter((v) => !v.campus || v.campus === campus)
  const pool = local.length ? local : versions
  if (entryYear) {
    const exact = pool.find((v) => v.entryYear === entryYear)
    if (exact) return exact
    const before = pool.find((v) => v.entryYear !== null && v.entryYear <= entryYear)
    if (before) return before
  }
  return pool[0]
}

// ---------------------------------------------------------------------------
// Hooks

function useAsync<T>(key: string, peek: () => T | undefined, load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<{ key: string; result: Loadable<T> } | null>(null)
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
  return state?.key === key ? state.result : { status: 'loading' }
}

export function useProgramsIndex(): Loadable<ProgramsIndex> {
  return useAsync('programs-index', () => indexValue ?? undefined, loadProgramsIndex)
}

/** Several program versions at once (exactly the ids given). */
export function useProgramVersions(auditIds: number[]): Loadable<Map<number, ProgramVersion>> {
  const key = [...auditIds].sort((a, b) => a - b).join(',')
  return useAsync(
    `versions:${key}`,
    () => {
      if (!auditIds.every((id) => versionValues.has(id))) return undefined
      return new Map(auditIds.map((id) => [id, versionValues.get(id)!]))
    },
    async () => new Map((await Promise.all(auditIds.map(loadProgramVersion))).map((v) => [v.auditId, v])),
  )
}

export interface AuditData {
  result: AuditResult
  /** Every version audited, including auto-attached ones. */
  versions: Map<number, ProgramVersion>
  catalog: CatalogIndex | null
}

/** Loads what an audit needs, then audits; re-runs only when the input actually changes. */
export function useAuditData(input: AuditInput): Loadable<AuditData> {
  const programsKey = JSON.stringify(input.programs)
  const deps = useAsync<{ versions: Map<number, ProgramVersion>; catalog: CatalogIndex | null }>(
    `audit-deps:${programsKey}`,
    () => undefined,
    async () => {
      const [versions, catalog] = await Promise.all([loadAuditVersions(input), loadCatalogIndex().catch(() => null)])
      return { versions, catalog }
    },
  )
  const inputKey = JSON.stringify(input)
  return useMemo<Loadable<AuditData>>(() => {
    if (deps.status !== 'ready') return deps
    const { versions, catalog } = deps.value
    try {
      return { status: 'ready', value: { result: runAudit(input, versions, catalog), versions, catalog } }
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, inputKey])
}

export function useAudit(input: AuditInput): Loadable<AuditResult> {
  const data = useAuditData(input)
  return data.status === 'ready' ? { status: 'ready', value: data.value.result } : data
}

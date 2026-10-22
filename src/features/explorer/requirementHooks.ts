import { useMemo } from 'react'
import { findNode } from '../../lib/audit'
import type { ProgramVersion } from '../../lib/degree-types'
import { useAuditVersions, useProgramVersions } from '../../lib/programs'
import { flattenRequirements } from '../../lib/requirement-match'
import { usePlans } from '../../state/plan'
import { entryYearOf } from '../degree/hooks'
import type { ReqRef } from './filters'

export interface ProgramChoice {
  auditId: number
  /** Program name, e.g. "BS in Computer Science". */
  label: string
  /** Version, e.g. "EY2025 Pittsburgh". */
  detail: string
}

const NO_PROGRAMS: never[] = []

/** The active degree plan's programs plus the bundles they bring in (gen-eds, concentrations). */
export function usePlanPrograms(): { hasPlan: boolean; choices: ProgramChoice[]; programIds: number[]; entryYear: number | null; loading: boolean } {
  const plan = usePlans((s) => (s.activePlanId ? (s.plans[s.activePlanId] ?? null) : null))
  const programs = plan?.programs ?? NO_PROGRAMS
  const versions = useAuditVersions(programs)
  return useMemo(() => {
    const programIds = programs.map((p) => p.catalogId)
    const entryYear = plan ? entryYearOf(plan.startTerm) : null
    if (versions.status !== 'ready') return { hasPlan: Boolean(plan), choices: [], programIds, entryYear, loading: versions.status === 'loading' }
    // Selected programs first, then what they attach.
    const selected = programs.map((p) => versions.value.get(p.auditId)).filter((v): v is ProgramVersion => Boolean(v))
    const rest = [...versions.value.values()].filter((v) => !selected.includes(v))
    const choices = [...selected, ...rest].map((v) => ({ auditId: v.auditId, label: v.programName, detail: v.name }))
    return { hasPlan: Boolean(plan), choices, programIds, entryYear, loading: false }
  }, [plan, programs, versions])
}

/** Name and program of a selected requirement, for chips and the picker's summary. */
export function useRequirementLabel(req: ReqRef | null): { status: 'none' | 'loading' | 'missing' | 'ready'; name?: string; program?: string; path?: string[] } {
  const versions = useProgramVersions(req ? [req.auditId] : NO_PROGRAMS)
  return useMemo(() => {
    if (!req) return { status: 'none' }
    if (versions.status === 'loading') return { status: 'loading' }
    const v = versions.status === 'ready' ? versions.value.get(req.auditId) : undefined
    if (!v) return { status: 'missing' }
    const flat = flattenRequirements(v).find((f) => f.nodeId === req.nodeId)
    if (flat) return { status: 'ready', name: flat.name, program: v.programName, path: flat.path }
    // Wrappers and lone courses aren't in the picker's list; fall back to the raw tree.
    const node = findNode(v.root, req.nodeId)
    return node ? { status: 'ready', name: node.name, program: v.programName, path: [] } : { status: 'missing' }
  }, [req, versions])
}


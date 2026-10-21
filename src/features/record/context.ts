import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { buildEquivalence, createContext, termOrdinal, type CourseCredit, type RequisiteContext } from '../../lib/requisites'
import { entryGrade, useRecord, type RecordData } from '../../state/record'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'

export interface PlannedCourse {
  courseId: string
  /** Term code, e.g. "F26". */
  term: string
}

export interface ContextInput {
  record: RecordData
  catalog: CatalogIndex | null
  /** The term being checked, e.g. "S27". */
  term: string
  /** Courses taken in that same term (the schedule). They satisfy corequisites only. */
  sameTerm?: string[]
  /** Courses planned in other terms (degree planner). Those before `term` count as planned. */
  planned?: PlannedCourse[]
  /** Extra equivalence groups, e.g. a term's cross-listings. */
  equivalentGroups?: string[][]
}

/**
 * Requisite context for checking courses in `term`:
 * - record entries without a term, or from earlier terms, are completed;
 * - record entries from `term` itself count as same-term;
 * - planned courses from earlier terms count as planned; the schedule counts as same-term.
 */
export function buildRequisiteContext(input: ContextInput): RequisiteContext {
  const target = termOrdinal(input.term)
  const credits: CourseCredit[] = []
  for (const e of input.record.entries) {
    if (!e.courseId) continue
    const at = e.term ? termOrdinal(e.term) : null
    if (target !== null && at !== null && at > target) continue
    const timing = target !== null && at !== null && at === target ? 'concurrent' : 'completed'
    credits.push({ courseId: e.courseId, timing, source: e.source, grade: entryGrade(e), term: e.term })
  }
  for (const p of input.planned ?? []) {
    const at = termOrdinal(p.term)
    if (target === null || at === null || at >= target) continue
    credits.push({ courseId: p.courseId, timing: 'planned', source: 'plan', term: p.term })
  }
  for (const id of input.sameTerm ?? []) credits.push({ courseId: id, timing: 'concurrent', source: 'schedule', term: input.term })

  return createContext({
    credits,
    equivalents: buildEquivalence(input.catalog, input.equivalentGroups),
    overrides: input.record.overrides,
  })
}

export type ContextState =
  | { status: 'loading'; ctx: null; catalog: null }
  | { status: 'error'; error: string; ctx: null; catalog: null }
  | { status: 'ready'; ctx: RequisiteContext; catalog: CatalogIndex }

/** Cross-listed groups for the routed term (only when it matches `termId`). */
function useCrossListGroups(termId: string): string[][] {
  const term = useTerm()
  return useMemo(() => {
    if (term.meta.id !== termId) return []
    return term.courses.filter((c) => c.crossListed.length).map((c) => [c.id, ...c.crossListed])
  }, [term, termId])
}

/** Course ids in the active schedule for `termId` (visible entries). */
export function useScheduleCourseIds(termId: string): string[] {
  const schedule = useStore((s) => {
    const id = s.activeSchedule[termId]
    return id ? s.schedules[id] : undefined
  })
  return useMemo(() => (schedule?.entries ?? []).filter((e) => !e.hidden).map((e) => e.courseId), [schedule])
}

/**
 * Requisite context from the record plus the active schedule for `termId`.
 * The degree planner should call buildRequisiteContext() with its own planned courses instead.
 */
export function useRequisiteContext(termId: string): ContextState {
  const catalog = useCatalogIndex()
  const entries = useRecord((s) => s.entries)
  const overrides = useRecord((s) => s.overrides)
  const profile = useRecord((s) => s.profile)
  const sameTerm = useScheduleCourseIds(termId)
  const groups = useCrossListGroups(termId)

  const index = catalog.status === 'ready' ? catalog.value : null
  const ctx = useMemo(
    () => (index ? buildRequisiteContext({ record: { entries, overrides, profile }, catalog: index, term: termId, sameTerm, equivalentGroups: groups }) : null),
    [index, entries, overrides, profile, termId, sameTerm, groups],
  )

  if (catalog.status === 'error') return { status: 'error', error: catalog.error, ctx: null, catalog: null }
  if (!ctx || !index) return { status: 'loading', ctx: null, catalog: null }
  return { status: 'ready', ctx, catalog: index }
}

import { resolvePlan } from '../../lib/plan'
import { useMemo } from 'react'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { buildEquivalence, createContext, termOrdinal, type CourseCredit, type RequisiteContext } from '../../lib/requisites'
import { sameCourseTitle } from '../../lib/substitutes'
import { entryGrade, useRecord, type RecordData } from '../../state/record'
import { usePlans } from '../../state/plan'
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
    // Sections that meet together aren't always the same course (Intermediate French I and II share a room): only
    // the ones with the same title count for each other.
    return term.courses.flatMap((c) => {
      const same = c.crossListed.filter((id) => {
        const other = term.courseById.get(id)
        return other ? sameCourseTitle(c.title, other.title) : false
      })
      return same.length ? [[c.id, ...same]] : []
    })
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
 * Courses planned for other terms: the active degree plan's semesters plus the active schedule of every other
 * term. buildRequisiteContext keeps only those before the term being checked.
 */
export function usePlannedElsewhere(termId: string): PlannedCourse[] {
  const plan = usePlans((s) => (s.activePlanId ? s.plans[s.activePlanId] : undefined))
  const schedules = useStore((s) => s.schedules)
  const active = useStore((s) => s.activeSchedule)
  return useMemo(() => {
    const out: PlannedCourse[] = []
    const seen = new Set<string>()
    const add = (courseId: string, term: string) => {
      const key = `${courseId}@${term}`
      if (term === termId || seen.has(key)) return
      seen.add(key)
      out.push({ courseId, term })
    }
    // Synced semesters count their schedule's courses (resolvePlan), like the degree plan itself.
    for (const t of plan ? resolvePlan(plan, schedules).terms : []) for (const c of t.courses) add(c.courseId, t.term)
    for (const [term, id] of Object.entries(active)) {
      for (const e of schedules[id]?.entries ?? []) if (!e.hidden) add(e.courseId, term)
    }
    return out
  }, [plan, schedules, active, termId])
}

/**
 * Requisite context from the record, courses planned for earlier terms (active degree plan and other terms'
 * active schedules), and the active schedule for `termId` itself (same-term, so corequisites only).
 * The degree planner calls buildRequisiteContext() with its own plan instead.
 */
export function useRequisiteContext(termId: string): ContextState {
  const catalog = useCatalogIndex()
  const entries = useRecord((s) => s.entries)
  const overrides = useRecord((s) => s.overrides)
  const profile = useRecord((s) => s.profile)
  const sameTerm = useScheduleCourseIds(termId)
  const planned = usePlannedElsewhere(termId)
  const groups = useCrossListGroups(termId)

  const index = catalog.status === 'ready' ? catalog.value : null
  const ctx = useMemo(
    () =>
      index ? buildRequisiteContext({ record: { entries, overrides, profile }, catalog: index, term: termId, sameTerm, planned, equivalentGroups: groups }) : null,
    [index, entries, overrides, profile, termId, sameTerm, planned, groups],
  )

  if (catalog.status === 'error') return { status: 'error', error: catalog.error, ctx: null, catalog: null }
  if (!ctx || !index) return { status: 'loading', ctx: null, catalog: null }
  return { status: 'ready', ctx, catalog: index }
}

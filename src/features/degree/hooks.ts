import { useEffect, useMemo, useState } from 'react'
import { codeOf } from '../../lib/requisite-format'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { loadTerm } from '../../lib/data'
import { examById, examLabel } from '../../lib/exam-credit'
import { useFceSummary } from '../../lib/fce'
import {
  academicYearStart,
  checkPlan,
  currentTermCode,
  defaultTerms,
  incomingCredit,
  isVariableUnits,
  planColumns,
  planCourseUnits,
  planCoursePassFail,
  planToAuditInput,
  termTotals,
  type Plan,
  type PlanCheck,
  type PlanColumn,
  type RecordEntryLike,
  type RecordLike,
  type TermTotals,
  type UnitsOf,
} from '../../lib/plan'
import type { AuditInput } from '../../lib/plan-types'
import { isFactorableGrade, normalizeGrade } from '../../lib/requisites'
import { useRecord } from '../../state/record'
import { useTerm, useTerms } from '../../state/term'

/** The term in progress today. */
export function useCurrentTerm(): string {
  return useMemo(() => currentTermCode(), [])
}

export function useRecordLike(): RecordLike {
  const entries = useRecord((s) => s.entries)
  const overrides = useRecord((s) => s.overrides)
  return useMemo(() => ({ entries, overrides }), [entries, overrides])
}

/** FCE hours/week for a course, or null without data. */
export function useFceHours(): (courseId: string) => number | null {
  const fce = useFceSummary()
  return useMemo(() => (id: string) => fce?.courses.get(id)?.hours ?? null, [fce])
}

/** For plan terms that have published schedule data: term → set of offered course ids. */
export function useScheduledCourses(termIds: string[]): Map<string, Set<string>> {
  const terms = useTerms()
  const available = useMemo(() => {
    const known = new Set(terms.status === 'ready' ? terms.value.map((t) => t.id) : [])
    return termIds.filter((t) => known.has(t))
  }, [terms, termIds])
  const key = available.join(',')
  const [loaded, setLoaded] = useState<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    let cancelled = false
    for (const id of key ? key.split(',') : []) {
      if (loaded.has(id)) continue
      loadTerm(id).then(
        (t) => {
          if (cancelled) return
          setLoaded((prev) => (prev.has(id) ? prev : new Map(prev).set(id, new Set(t.courseById.keys()))))
        },
        () => {},
      )
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return loaded
}

/** Term ids that have published schedule data (and so a schedule planner). */
export function usePublishedTerms(): Set<string> {
  const terms = useTerms()
  return useMemo(() => new Set(terms.status === 'ready' ? terms.value.map((t) => t.id) : []), [terms])
}

export interface ColumnView extends PlanColumn {
  totals: TermTotals
  /** Units/grade facts for the read-only record rows. */
  recordUnits: Map<string, number>
}

export interface PlanDerived {
  catalog: CatalogIndex | null
  current: string
  columns: ColumnView[]
  incoming: RecordEntryLike[]
  checks: Map<string, PlanCheck>
  auditInput: AuditInput
  unitsOf: UnitsOf
  /** Units earned on the record plus everything planned. */
  totalUnits: number
  completedUnits: number
}

function examSource(examId: string, score: string): string {
  const exam = examById(examId)
  return exam ? `${examLabel(exam)} (${score})` : `Exam credit (${score})`
}

/** Everything the plan page shows, derived from the plan, the record, the catalog and FCEs. */
export function usePlanDerived(plan: Plan | null): PlanDerived | null {
  const catalogState = useCatalogIndex()
  const catalog = catalogState.status === 'ready' ? catalogState.value : null
  const term = useTerm()
  const record = useRecordLike()
  const fceHours = useFceHours()
  const current = useCurrentTerm()

  const unitsOf = useMemo<UnitsOf>(() => (id) => catalog?.courses[id]?.units ?? term.courseById.get(id)?.units ?? null, [catalog, term])

  return useMemo(() => {
    if (!plan) return null
    const columns: ColumnView[] = planColumns(plan, record, current).map((col) => {
      const recordUnits = new Map<string, number>()
      const items = [
        ...col.recorded.map((e) => {
          const units = e.units ?? unitsOf(e.courseId ?? '') ?? 0
          recordUnits.set(e.id, units)
          const grade = normalizeGrade(e.grade)
          return {
            courseId: e.courseId ?? '',
            units,
            passFail: isFactorableGrade(grade) === false || !!(e.courseId && catalog?.courses[e.courseId]?.passFail),
          }
        }),
        ...col.planned.map((c) => ({
          courseId: c.courseId,
          units: planCourseUnits(c, unitsOf),
          passFail: planCoursePassFail(c, catalog),
          variable: c.units === undefined && isVariableUnits(c.courseId, catalog),
        })),
      ]
      return { ...col, totals: termTotals(items, fceHours), recordUnits }
    })
    const auditInput = planToAuditInput(plan, record, catalog, { current, unitsOf, examLabel: examSource })
    const checks = checkPlan(plan, record, catalog)
    const completedUnits = auditInput.courses.filter((c) => c.status === 'completed' || c.status === 'credit').reduce((n, c) => n + c.units, 0)
    const generalTransfer = record.entries.filter((e) => !e.courseId && e.source === 'transfer').reduce((n, e) => n + (e.units ?? 0), 0)
    return {
      catalog,
      current,
      columns,
      incoming: incomingCredit(record),
      checks,
      auditInput,
      unitsOf,
      totalUnits: auditInput.courses.reduce((n, c) => n + c.units, 0) + generalTransfer,
      completedUnits: completedUnits + generalTransfer,
    }
  }, [plan, record, catalog, current, unitsOf, fceHours])
}

/** Fall and spring terms from six years back to next fall, for start-term pickers. */
export function useStartTermOptions(current: string): string[] {
  return useMemo(() => {
    const fall = academicYearStart(current)
    const year = Number(fall.slice(1))
    const from = `F${String(year - 6).padStart(2, '0')}`
    return defaultTerms(from, 16)
  }, [current])
}

export function entryYearOf(startTerm: string): number {
  return 2000 + Number(academicYearStart(startTerm).slice(1))
}

/** Data transfer type for dragging plan courses between semesters. */
export const DRAG_TYPE = 'application/x-courseweave-plan-course'

/** Where a course link should go: its page in the routed term if offered there, else the requisite explorer. */
export function useCourseHref(): (courseId: string) => string {
  const term = useTerm()
  return (id) => (term.courseById.has(id) ? `/${term.meta.id}/courses/${codeOf(id)}` : `/${term.meta.id}/requisites/${codeOf(id)}`)
}

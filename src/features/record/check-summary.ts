import { AlertTriangle, Check, Clock, Info } from 'lucide-react'
import type { CatalogEntry } from '../../lib/catalog-types'
import { defaultCode, describeRequisite, evaluateRequisite, termLabel, type CheckLevel, type CourseCheck, type RequisiteContext, type RequisiteResult } from '../../lib/requisites'
import type { StatusFn } from '../catalog/RequisiteExpression'

export const LEVEL_STYLE: Record<CheckLevel | 'none', { icon: typeof Check; color: string }> = {
  ok: { icon: Check, color: 'text-ok' },
  planned: { icon: Clock, color: 'text-warn' },
  unknown: { icon: Info, color: 'text-muted' },
  problem: { icon: AlertTriangle, color: 'text-danger' },
  none: { icon: Check, color: 'text-muted' },
}

export interface PlannedCondition {
  courseId: string
  /** The course actually planned, when an equivalent satisfies the requirement. */
  via?: string
  term?: string | null
  minGrade?: string
}

/**
 * The planned courses a satisfied-by-plan requisite depends on: for each "any"/"at least" group only the options it
 * needs, preferring completed ones (which need nothing).
 */
export function plannedConditions(result: RequisiteResult | null): PlannedCondition[] {
  if (!result || result.status !== 'planned') return []
  const node = result.node
  if (node.type === 'course') {
    const credit = result.match?.credit
    if (!credit || credit.timing === 'completed') return []
    return [{ courseId: node.id, via: result.match?.via, term: credit.term, minGrade: node.minGrade }]
  }
  const children = result.children ?? []
  if (node.type === 'all') return children.flatMap(plannedConditions)
  const need = node.type === 'atLeast' ? node.n : 1
  const met = children.filter((c) => c.status === 'met').length
  return children
    .filter((c) => c.status === 'planned')
    .slice(0, Math.max(0, need - met))
    .flatMap(plannedConditions)
}

function describeCondition(c: PlannedCondition): string {
  const code = defaultCode(c.via ?? c.courseId)
  const parts = [c.minGrade ? `${c.minGrade} or better` : null, c.term ? `planned for ${termLabel(c.term)}` : 'planned'].filter(Boolean)
  return `${code} (${parts.join(', ')})`
}

/** "Met if you pass 15-151 (C or better, planned for Fall 2026)". */
export function plannedText(conditions: PlannedCondition[]): string {
  if (!conditions.length) return 'Met with planned courses'
  const list = conditions.map(describeCondition)
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
  return `Met if you pass ${joined}`
}

/** One-line summary of a check, e.g. "Missing prerequisite: 15-122 (C or better)". */
export function summarizeCheck(check: CourseCheck, entry: CatalogEntry | undefined): { level: CheckLevel | 'none'; text: string } {
  const hasReqs = !!entry?.prereqs || (entry?.coreqs.length ?? 0) > 0
  const error = check.issues.find((i) => i.severity === 'error')
  if (check.level === 'problem' && error) {
    const more = check.issues.filter((i) => i.severity === 'error').length - 1
    return { level: 'problem', text: more > 0 ? `${error.message} (+${more} more)` : error.message }
  }
  const warning = check.issues.find((i) => i.severity === 'warning')
  const waived = check.waived.prereqs || check.waived.coreqs || check.waived.antireqs
  if (check.level === 'unknown') {
    const text = entry?.prereqs ? describeRequisite(entry.prereqs) : 'the catalog requirements'
    return { level: 'unknown', text: `Check prerequisite: ${text}` }
  }
  if (check.level === 'planned') {
    const coreqSameTerm = check.coreqs?.status === 'planned' && check.prereqs?.status !== 'planned'
    return { level: 'planned', text: coreqSameTerm ? 'Corequisite taken alongside' : plannedText(plannedConditions(check.prereqs)) }
  }
  if (warning) return { level: 'planned', text: warning.message }
  if (waived) return { level: 'ok', text: 'Requisites waived' }
  if (!hasReqs) return { level: 'none', text: 'No prerequisites' }
  return { level: 'ok', text: entry?.coreqs.length && !entry.prereqs ? 'Corequisite met' : 'Prerequisites met' }
}

/** Colors requisite chips by how the student stands on each course. */
export function statusFnFor(ctx: RequisiteContext, allowConcurrent: boolean): StatusFn {
  return (id) => {
    const s = evaluateRequisite({ type: 'course', id }, ctx, { allowConcurrent }).status
    return s === 'unknown' ? undefined : s
  }
}

import { AlertTriangle, Check, Clock, Info } from 'lucide-react'
import type { CatalogEntry } from '../../lib/catalog-types'
import { describeRequisite, evaluateRequisite, type CheckLevel, type CourseCheck, type RequisiteContext } from '../../lib/requisites'
import type { StatusFn } from '../catalog/RequisiteExpression'

export const LEVEL_STYLE: Record<CheckLevel | 'none', { icon: typeof Check; color: string }> = {
  ok: { icon: Check, color: 'text-ok' },
  planned: { icon: Clock, color: 'text-warn' },
  unknown: { icon: Info, color: 'text-muted' },
  problem: { icon: AlertTriangle, color: 'text-danger' },
  none: { icon: Check, color: 'text-muted' },
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
    return { level: 'planned', text: coreqSameTerm ? 'Corequisite taken alongside' : 'Met with planned courses' }
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

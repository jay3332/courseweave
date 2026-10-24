// Overall progress through a degree plan, split by how far along each part is: done (taken, or AP / transfer credit),
// in progress this semester, planned for later, and still needed.
import type { AuditResult, RequirementResult } from '../../lib/plan-types'

export interface DegreeProgress {
  /** Units toward the degree's unit total when a program has one; otherwise requirements met. */
  basis: 'units' | 'requirements'
  /** Completed courses and credit. */
  done: number
  /** The part of `done` from AP, IB and transfer credit (units only; 0 for requirements). */
  credit: number
  inProgress: number
  planned: number
  need: number
}

export interface RequirementTally {
  done: number
  inProgress: number
  planned: number
  /** Requirements counted: the leaves of every program, less the ones not needed and the advisor checks. */
  total: number
}

/** Counts a program's requirements by how far along each one is. */
export function tallyRequirements(r: RequirementResult, into: RequirementTally = { done: 0, inProgress: 0, planned: 0, total: 0 }): RequirementTally {
  if (r.skipped) return into
  if (r.children.length) {
    for (const c of r.children) tallyRequirements(c, into)
    return into
  }
  if (r.manual) return into
  into.total++
  if (r.state === 'complete') into.done++
  else if (r.state === 'complete-with-plan') {
    // Met once this semester ends, or only once later semesters do.
    if (r.assigned.some((a) => a.status === 'planned')) into.planned++
    else into.inProgress++
  }
  return into
}

export function degreeProgress(audit: AuditResult | null): DegreeProgress | null {
  if (!audit?.programs.length) return null
  // A double major can ask for more units than the first program; the largest target is the one to reach.
  const units = audit.programs
    .flatMap((p) => (p.totalUnits ? [p.totalUnits] : []))
    .reduce<NonNullable<AuditResult['programs'][number]['totalUnits']> | null>((best, t) => (!best || t.need > best.need ? t : best), null)
  if (units) {
    return { basis: 'units', done: units.have, credit: units.credit, inProgress: units.inProgress, planned: units.planned - units.inProgress, need: units.need }
  }
  const tally = { done: 0, inProgress: 0, planned: 0, total: 0 }
  for (const p of audit.programs) tallyRequirements(p.root, tally)
  return tally.total ? { basis: 'requirements', done: tally.done, credit: 0, inProgress: tally.inProgress, planned: tally.planned, need: tally.total } : null
}

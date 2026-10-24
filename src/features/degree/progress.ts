// Overall progress toward finishing a degree plan, split by how far along each part is: done (taken, or AP / transfer
// credit), in progress this semester, planned for later, and still needed. The plan is finished when it reaches the
// degree's unit total and meets every requirement, so "still needed" is whichever of the two asks for more.
import type { UnitsOf } from '../../lib/plan'
import type { AuditResult, PlannedCourse, RequirementResult } from '../../lib/plan-types'

/** Units assumed for a course a requirement asks for when nothing better is known (most CMU courses are 9 or 12). */
const TYPICAL_UNITS = 9

export interface DegreeProgress {
  /** Completed courses and credit. */
  done: number
  /** The part of `done` from AP, IB and transfer credit. */
  credit: number
  inProgress: number
  planned: number
  /** The degree's unit total, when a program sets one. */
  unitTarget: number | null
  /** Units still to add: enough to reach the unit total and to meet every requirement, whichever is more. */
  needed: number
  /** Estimated units the unmet requirements still need. */
  requirementUnits: number
  /** Unmet requirements, counted where the plan falls short (an unmet "1 of 9" elective counts once). */
  unmet: number
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

const met = (r: RequirementResult) => r.state === 'complete' || r.state === 'complete-with-plan'

/**
 * Roughly how many more units a requirement needs, and how many unmet requirements that is: a named course's units, a
 * pool's missing units or courses, and for a group the cheapest children that would complete it.
 */
export function requirementShortfall(r: RequirementResult, unitsOf: UnitsOf): { units: number; count: number } {
  if (r.skipped || r.manual || met(r)) return { units: 0, count: 0 }
  // Courses a pool still needs are about as big as the ones it already has.
  const perCourse = r.assigned.length ? r.assigned.reduce((n, a) => n + a.units, 0) / r.assigned.length : TYPICAL_UNITS
  const own = Math.max(
    r.units ? r.units.need - r.units.have - r.units.planned : 0,
    r.courses ? (r.courses.need - r.courses.have - r.courses.planned) * perCourse : 0,
    r.kind === 'course' && r.courseId ? (unitsOf(r.courseId) ?? TYPICAL_UNITS) : 0,
  )
  const kids = r.children.filter((c) => !c.skipped && !c.manual)
  // Anything unmet needs at least a course, so a plan can't look finished while a requirement is open.
  if (!kids.length) return { units: own > 0 ? own : TYPICAL_UNITS, count: 1 }
  const open = kids
    .filter((c) => !met(c))
    .map((c) => requirementShortfall(c, unitsOf))
    .sort((a, b) => a.units - b.units)
  const wanted = r.need ? Math.max(0, r.need.children - (kids.length - open.length)) : open.length
  const fromKids = open.slice(0, wanted).reduce((acc, x) => ({ units: acc.units + x.units, count: acc.count + x.count }), { units: 0, count: 0 })
  return { units: Math.max(own, fromKids.units) || TYPICAL_UNITS, count: Math.max(1, fromKids.count) }
}

/**
 * Progress toward finishing the plan. Units come from the program with the largest unit total (only units the degree
 * counts), or from every course in the plan when no program sets a total.
 */
export function degreeProgress(audit: AuditResult | null, courses: PlannedCourse[], unitsOf: UnitsOf): DegreeProgress | null {
  if (!audit?.programs.length) return null
  // A double major can ask for more units than the first program; the largest target is the one to reach.
  const target = audit.programs
    .flatMap((p) => (p.totalUnits ? [p.totalUnits] : []))
    .reduce<NonNullable<AuditResult['programs'][number]['totalUnits']> | null>((best, t) => (!best || t.need > best.need ? t : best), null)
  const sum = (pred: (c: PlannedCourse) => boolean) => courses.reduce((n, c) => n + (pred(c) ? c.units : 0), 0)
  const units = target
    ? { done: target.have, credit: target.credit, inProgress: target.inProgress, planned: target.planned - target.inProgress }
    : {
        done: sum((c) => c.status === 'completed' || c.status === 'credit'),
        credit: sum((c) => c.status === 'credit'),
        inProgress: sum((c) => c.status === 'in-progress'),
        planned: sum((c) => c.status === 'planned'),
      }
  const gap = audit.programs.reduce((acc, p) => {
    const x = requirementShortfall(p.root, unitsOf)
    return { units: acc.units + x.units, count: acc.count + x.count }
  }, { units: 0, count: 0 })
  const withPlan = units.done + units.inProgress + units.planned
  return {
    ...units,
    unitTarget: target?.need ?? null,
    needed: Math.max(0, target ? target.need - withPlan : 0, gap.units),
    requirementUnits: gap.units,
    unmet: gap.count,
  }
}

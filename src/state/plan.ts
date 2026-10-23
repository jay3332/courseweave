// Degree plans: named, multi-year course plans audited against program requirements.
// Completed coursework lives in the record store; plans hold what's planned (and, for past terms,
// what the student put there without adding it to the record).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { compareTerms, defaultTerms, type Plan, type PlanCourse, type PlanTerm } from '../lib/plan'
import type { ProgramSelection } from '../lib/plan-types'
import { termOrdinal } from '../lib/requisites'

export type { Plan, PlanCourse, PlanTerm }

interface PlanState {
  plans: Record<string, Plan>
  activePlanId: string | null

  createPlan(opts?: { name?: string; startTerm?: string; programs?: ProgramSelection[]; terms?: string[] }): string
  duplicatePlan(id: string): string
  renamePlan(id: string, name: string): void
  deletePlan(id: string): void
  setActivePlan(id: string | null): void

  setPrograms(planId: string, programs: ProgramSelection[]): void
  /** Moves the plan's start; adds default semesters from it and drops empty semesters before it. */
  setStartTerm(planId: string, startTerm: string): void
  addTerm(planId: string, term: string): void
  /** Removes a semester and the courses planned in it. */
  removeTerm(planId: string, term: string): void

  addCourse(planId: string, term: string, courseId: string, opts?: { passFail?: boolean; units?: number }): string
  removeCourse(planId: string, planCourseId: string): void
  /** Moves a course to another semester (created if needed), at `index` or the end. */
  moveCourse(planId: string, planCourseId: string, toTerm: string, index?: number): void
  updateCourse(planId: string, planCourseId: string, patch: Partial<Pick<PlanCourse, 'passFail' | 'units' | 'note'>>): void
  /** Replaces a semester's courses, e.g. with a schedule from the schedule planner. */
  setTermCourses(planId: string, term: string, courses: { courseId: string; passFail?: boolean }[]): void

  /**
   * Syncs a semester with a schedule: its courses then come from the schedule. `snapshot` (the courses at link
   * time) is kept as the fallback should the schedule be deleted.
   */
  linkTerm(planId: string, term: string, scheduleId: string, snapshot: SnapshotCourse[]): void
  /** Stops syncing; the semester keeps `courses` (normally the schedule's current courses) as planned courses. */
  unlinkTerm(planId: string, term: string, courses?: SnapshotCourse[]): void
  /** Units override for a course in a semester (variable-unit courses), creating its snapshot row if needed. */
  setCourseUnits(planId: string, term: string, courseId: string, units: number | undefined): void
  /** Note for a course in a semester, kept on the semester's own list (so synced semesters keep it too). */
  setCourseNote(planId: string, term: string, courseId: string, note: string): void
  /** Drops a course from a semester's own list by course id (keeps a synced semester's snapshot current). */
  removeCourseFromTerm(planId: string, term: string, courseId: string): void
}

export interface SnapshotCourse {
  courseId: string
  passFail?: boolean
  units?: number
  note?: string
}

const toPlanCourse = (c: SnapshotCourse): PlanCourse => ({
  id: uid(),
  courseId: c.courseId,
  ...(c.passFail ? { passFail: true } : {}),
  ...(c.units !== undefined ? { units: c.units } : {}),
  ...(c.note ? { note: c.note } : {}),
})

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function sortTerms(terms: PlanTerm[]): PlanTerm[] {
  return [...terms].sort((a, b) => compareTerms(a.term, b.term))
}

function nextPlanName(plans: Plan[]): string {
  let n = plans.length + 1
  while (plans.some((p) => p.name === `Plan ${n}`)) n++
  return `Plan ${n}`
}

function withTerm(terms: PlanTerm[], term: string): PlanTerm[] {
  return terms.some((t) => t.term === term) ? terms : sortTerms([...terms, { term, courses: [] }])
}

export const usePlans = create<PlanState>()(
  persist(
    (set, get) => {
      const update = (id: string, fn: (p: Plan) => Partial<Plan>) =>
        set((s) => {
          const p = s.plans[id]
          if (!p) return s
          return { plans: { ...s.plans, [id]: { ...p, ...fn(p), updatedAt: Date.now() } } }
        })

      return {
        plans: {},
        activePlanId: null,

        createPlan(opts = {}) {
          const id = uid()
          const now = Date.now()
          set((s) => {
            const startTerm = (opts.startTerm ?? 'F25').toUpperCase()
            const plan: Plan = {
              id,
              name: opts.name ?? nextPlanName(Object.values(s.plans)),
              programs: opts.programs ?? [],
              startTerm,
              terms: sortTerms((opts.terms ?? defaultTerms(startTerm)).map((term) => ({ term, courses: [] }))),
              createdAt: now,
              updatedAt: now,
            }
            return { plans: { ...s.plans, [id]: plan }, activePlanId: id }
          })
          return id
        },

        duplicatePlan(id) {
          const p = get().plans[id]
          if (!p) return id
          const copy = get().createPlan({ name: `${p.name} copy`, startTerm: p.startTerm, programs: p.programs.map((x) => ({ ...x })), terms: [] })
          update(copy, () => ({
            terms: p.terms.map((t) => ({ term: t.term, courses: t.courses.map((c) => ({ ...c, id: uid() })), ...(t.link ? { link: { ...t.link } } : {}) })),
          }))
          return copy
        },

        renamePlan(id, name) {
          update(id, () => ({ name: name.trim() || 'Untitled plan' }))
        },

        deletePlan(id) {
          set((s) => {
            const { [id]: _removed, ...rest } = s.plans
            const fallback = Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0]
            return { plans: rest, activePlanId: s.activePlanId === id ? (fallback?.id ?? null) : s.activePlanId }
          })
        },

        setActivePlan(id) {
          set({ activePlanId: id })
        },

        setPrograms(planId, programs) {
          update(planId, () => ({ programs }))
        },

        setStartTerm(planId, startTerm) {
          const start = startTerm.toUpperCase()
          const from = termOrdinal(start)
          if (from === null) return
          update(planId, (p) => {
            let terms = p.terms.filter((t) => t.courses.length > 0 || (termOrdinal(t.term) ?? 0) >= from)
            for (const t of defaultTerms(start)) terms = withTerm(terms, t)
            return { startTerm: start, terms }
          })
        },

        addTerm(planId, term) {
          if (termOrdinal(term) === null) return
          update(planId, (p) => ({ terms: withTerm(p.terms, term.toUpperCase()) }))
        },

        removeTerm(planId, term) {
          update(planId, (p) => ({ terms: p.terms.filter((t) => t.term !== term) }))
        },

        addCourse(planId, term, courseId, opts = {}) {
          const id = uid()
          update(planId, (p) => ({
            terms: withTerm(p.terms, term).map((t) =>
              t.term === term ? { ...t, courses: [...t.courses, { id, courseId, ...(opts.passFail ? { passFail: true } : {}), ...(opts.units !== undefined ? { units: opts.units } : {}) }] } : t,
            ),
          }))
          return id
        },

        removeCourse(planId, planCourseId) {
          update(planId, (p) => ({ terms: p.terms.map((t) => ({ ...t, courses: t.courses.filter((c) => c.id !== planCourseId) })) }))
        },

        moveCourse(planId, planCourseId, toTerm, index) {
          update(planId, (p) => {
            const course = p.terms.flatMap((t) => t.courses).find((c) => c.id === planCourseId)
            if (!course) return {}
            const without = p.terms.map((t) => ({ ...t, courses: t.courses.filter((c) => c.id !== planCourseId) }))
            return {
              terms: withTerm(without, toTerm).map((t) => {
                if (t.term !== toTerm) return t
                const courses = [...t.courses]
                courses.splice(index === undefined ? courses.length : Math.max(0, Math.min(index, courses.length)), 0, course)
                return { ...t, courses }
              }),
            }
          })
        },

        updateCourse(planId, planCourseId, patch) {
          update(planId, (p) => ({
            terms: p.terms.map((t) => ({
              ...t,
              courses: t.courses.map((c) => {
                if (c.id !== planCourseId) return c
                const next = { ...c, ...patch }
                if (!next.passFail) delete next.passFail
                if (next.units === undefined) delete next.units
                if (!next.note) delete next.note
                return next
              }),
            })),
          }))
        },

        setTermCourses(planId, term, courses) {
          update(planId, (p) => ({
            terms: withTerm(p.terms, term).map((t) =>
              t.term === term ? { ...t, courses: courses.map((c) => ({ id: uid(), courseId: c.courseId, ...(c.passFail ? { passFail: true } : {}) })) } : t,
            ),
          }))
        },

        linkTerm(planId, term, scheduleId, snapshot) {
          update(planId, (p) => ({
            terms: withTerm(p.terms, term).map((t) => (t.term === term ? { ...t, link: { scheduleId }, courses: snapshot.map(toPlanCourse) } : t)),
          }))
        },

        unlinkTerm(planId, term, courses) {
          update(planId, (p) => ({
            terms: p.terms.map((t) => (t.term === term ? { ...t, link: null, ...(courses ? { courses: courses.map(toPlanCourse) } : {}) } : t)),
          }))
        },

        setCourseNote(planId, term, courseId, note) {
          update(planId, (p) => ({
            terms: withTerm(p.terms, term).map((t) => {
              if (t.term !== term) return t
              const existing = t.courses.some((c) => c.courseId === courseId)
              const courses = existing
                ? t.courses.map((c) => {
                    if (c.courseId !== courseId) return c
                    const next: PlanCourse = { ...c, note }
                    if (!note) delete next.note
                    return next
                  })
                : note
                  ? [...t.courses, toPlanCourse({ courseId, note })]
                  : t.courses
              return { ...t, courses }
            }),
          }))
        },
        setCourseUnits(planId, term, courseId, units) {
          update(planId, (p) => ({
            terms: withTerm(p.terms, term).map((t) => {
              if (t.term !== term) return t
              const existing = t.courses.some((c) => c.courseId === courseId)
              const courses = existing
                ? t.courses.map((c) => {
                    if (c.courseId !== courseId) return c
                    const next = { ...c, units }
                    if (units === undefined) delete next.units
                    return next
                  })
                : [...t.courses, toPlanCourse({ courseId, units })]
              return { ...t, courses }
            }),
          }))
        },

        removeCourseFromTerm(planId, term, courseId) {
          update(planId, (p) => ({ terms: p.terms.map((t) => (t.term === term ? { ...t, courses: t.courses.filter((c) => c.courseId !== courseId) } : t)) }))
        },
      }
    },
    {
      name: 'courseweave-plan',
      version: 2,
      migrate: migratePlans,
    },
  ),
)

/** Plans, oldest first (tab order). */
export function usePlanList(): Plan[] {
  const plans = usePlans((s) => s.plans)
  return Object.values(plans).sort((a, b) => a.createdAt - b.createdAt)
}

/** v1 → v2: semesters gained an optional `link` to a schedule (none by default). */
export function migratePlans(persisted: unknown, version: number): PlanState {
  const state = (persisted ?? {}) as { plans?: Record<string, Plan>; activePlanId?: string | null }
  if (version < 2) {
    for (const p of Object.values(state.plans ?? {})) p.terms = (p.terms ?? []).map((t) => ({ ...t, link: t.link ?? null }))
  }
  return state as PlanState
}

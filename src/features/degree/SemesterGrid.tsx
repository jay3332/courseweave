import { LayoutGrid, Plus, Table2 } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { academicYearLabel, academicYearStart, compareTerms, isSummer, missingSemesters, nextTerm, type Plan } from '../../lib/plan'
import { requirementsByCourse } from '../../lib/plan-table'
import type { AuditResult } from '../../lib/plan-types'
import { termLabel } from '../../lib/requisites'
import { usePlans } from '../../state/plan'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { useCourseLookup } from '../record/hooks'
import { useFceHours, usePublishedTerms, useScheduledCourses, type ColumnView, type PlanDerived } from './hooks'
import { TermCard } from './TermCard'

interface SemesterGridProps {
  plan: Plan
  derived: PlanDerived
  /** Term → expanded, for the phone layout. */
  openTerms: Record<string, boolean>
  onToggleTerm(term: string): void
  isPhone: boolean
  dragEnabled: boolean
  /** The audit, for the table layout's Satisfies column. */
  audit: AuditResult | null
}

/** Semesters grouped into academic-year rows: Fall, Spring, then Summer when planned. */
export function SemesterGrid({ plan, derived, openTerms, onToggleTerm, isPhone, dragEnabled, audit }: SemesterGridProps) {
  const addTerm = usePlans((s) => s.addTerm)
  const layout = useStore((s) => s.planLayout)
  const setLayout = useStore((s) => s.setPlanLayout)
  const table = layout === 'table'
  const requirements = useMemo(() => (table ? requirementsByCourse(audit) : undefined), [table, audit])
  const fceHours = useFceHours()
  const published = usePublishedTerms()
  const scheduled = useScheduledCourses(derived.columns.map((c) => c.term))

  // Each year's semesters, plus a slot for each fall or spring missing between the plan's start and its last
  // semester (one the student removed), so it can be added back where it belongs.
  const years = new Map<string, Slot[]>()
  const put = (slot: Slot) => {
    const key = academicYearStart(slot.term)
    years.set(key, [...(years.get(key) ?? []), slot].sort((a, b) => compareTerms(a.term, b.term)))
  }
  for (const col of derived.columns) put({ term: col.term, col })
  for (const term of missingSemesters(plan.startTerm, derived.columns.map((c) => c.term))) put({ term, col: null })
  const last = derived.columns.at(-1)?.term ?? plan.startTerm
  const nextSemester = nextTerm(last)
  // A plan ending in a fall gets its spring added within that year (before the year's summer), not at the bottom.
  const nextInLastYear = derived.columns.length > 0 && academicYearStart(nextSemester) === academicYearStart(last)
  if (nextInLastYear) put({ term: nextSemester, col: null })
  const yearKeys = [...years.keys()].sort(compareTerms)

  return (
    <div className="flex flex-col gap-6">
      <div className="-mb-3 flex items-center justify-end">
        <div role="radiogroup" aria-label="Semester layout" className="flex rounded-lg border border-line-strong p-0.5 text-[12.5px]">
          {(
            [
              ['cards', 'Cards', LayoutGrid],
              ['table', 'Detailed', Table2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={layout === value}
              onClick={() => setLayout(value)}
              title={value === 'table' ? 'Each semester as a table with requirements, notes, offering and prerequisites' : 'Semesters side by side'}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 font-medium md:h-7 ${layout === value ? 'bg-surface-2 text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <IncomingCredit derived={derived} />
      {yearKeys.map((key) => {
        const slots = years.get(key)!
        const cols = slots.flatMap((s) => (s.col ? [s.col] : []))
        const summer = `M${String(Number(key.slice(1)) + 1).padStart(2, '0')}`
        const hasSummer = cols.some((c) => isSummer(c.term))
        const units = cols.reduce((n, c) => n + c.totals.units, 0)
        return (
          <section key={key} aria-label={`Academic year ${academicYearLabel(key)}`} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="display text-[22px] text-ink">{academicYearLabel(key)}</h2>
              <span className="text-[13px] text-muted">{units} units</span>
              {!hasSummer && !table ? (
                <button
                  type="button"
                  onClick={() => addTerm(plan.id, summer)}
                  className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:min-h-7"
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add {termLabel(summer)}
                </button>
              ) : null}
            </div>
            <div className={table ? 'flex flex-col gap-3' : `grid grid-cols-1 gap-3 md:grid-cols-2 ${hasSummer ? '2xl:grid-cols-3' : ''}`}>
              {slots.map(({ term, col }) =>
                col ? (
                  <TermCard
                    key={term}
                    plan={plan}
                    column={col}
                    derived={derived}
                    scheduled={scheduled.get(term)}
                    published={published.has(term)}
                    fceHours={fceHours}
                    open={openTerms[term] ?? col.phase !== 'past'}
                    onToggle={() => onToggleTerm(term)}
                    collapsible={isPhone}
                    dragEnabled={dragEnabled}
                    layout={layout}
                    requirements={requirements}
                  />
                ) : (
                  <button
                    key={term}
                    type="button"
                    onClick={() => addTerm(plan.id, term)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 text-[13.5px] font-medium text-ink-2 hover:border-ink-2 hover:text-ink ${table ? 'min-h-11' : 'min-h-28'}`}
                  >
                    <Plus aria-hidden className="size-4" />
                    Add {termLabel(term)}
                  </button>
                ),
              )}
              {/* Detailed layout: the summer goes after the year's spring, so that's where it's added. */}
              {!hasSummer && table ? (
                <button
                  type="button"
                  onClick={() => addTerm(plan.id, summer)}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-[13px] font-medium text-ink-2 hover:border-line-strong hover:text-ink md:min-h-8"
                >
                  <Plus aria-hidden className="size-3.5" />
                  Add {termLabel(summer)}
                </button>
              ) : null}
            </div>
          </section>
        )
      })}
      {!nextInLastYear ? (
        <button
          type="button"
          onClick={() => addTerm(plan.id, nextSemester)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[14px] font-medium text-ink-2 hover:border-ink-2 hover:text-ink"
        >
          <Plus aria-hidden className="size-4" />
          Add {termLabel(nextSemester)}
        </button>
      ) : null}
    </div>
  )
}

/** AP/IB, transfer credit and placements from the record. */
function IncomingCredit({ derived }: { derived: PlanDerived }) {
  const term = useTerm()
  const lookup = useCourseLookup()
  if (!derived.incoming.length) return null
  const units = derived.incoming.reduce((n, e) => n + (e.source === 'waiver' ? 0 : (e.units ?? (e.courseId ? (lookup(e.courseId).units ?? 0) : 0))), 0)
  return (
    <section aria-labelledby="incoming-credit" className="rounded-xl border border-line bg-surface">
      <header className="flex items-baseline gap-3 border-b border-line px-3 py-2">
        <h2 id="incoming-credit" className="display text-[19px] text-ink">
          Incoming credit
        </h2>
        <span className="text-[13px] text-muted">{units} units</span>
        <Link to={`/${term.meta.id}/record`} className="ml-auto text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
          Edit in record
        </Link>
      </header>
      <ul className="grid grid-cols-1 gap-x-4 px-1.5 py-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {derived.incoming.map((e) => {
          const info = e.courseId ? lookup(e.courseId) : null
          const kind = e.source === 'exam' ? 'Exam' : e.source === 'transfer' ? 'Transfer' : e.source === 'waiver' ? 'Placement' : 'Course'
          const u = e.source === 'waiver' ? 0 : (e.units ?? info?.units ?? 0)
          return (
            <li key={e.id} className="flex min-h-9 items-center gap-1.5 px-1.5 md:min-h-7">
              <span className="course-code shrink-0 text-[14px] text-ink-2">{info?.code ?? 'Units'}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{e.label ?? info?.title ?? e.institution ?? 'General credit'}</span>
              <span className="shrink-0 text-[11.5px] text-muted">{kind}</span>
              <span className="w-8 shrink-0 text-right text-[12.5px] text-muted tabular-nums">{u}u</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type Slot = { term: string; col: ColumnView | null }

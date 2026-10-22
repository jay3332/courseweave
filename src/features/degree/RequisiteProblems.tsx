import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { termPhase } from '../../lib/plan'
import { termLabel } from '../../lib/requisites'
import { codeOf } from '../../lib/requisite-format'
import type { PlanDerived } from './hooks'

/** Courses planned before their requisites are met, with jump links. Hidden when there are none. */
export function RequisiteProblems({ derived, onJump }: { derived: PlanDerived; onJump(planCourseId: string, term: string): void }) {
  const [open, setOpen] = useState(false)
  const problems = [...derived.checks.values()].filter((c) => c.check.level === 'problem' && termPhase(c.term, derived.current) !== 'past')
  if (!problems.length) return null
  return (
    <section aria-labelledby="plan-problems" className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_35%,var(--line))] bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="plan-problems-list"
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left"
      >
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-danger" />
        <h2 id="plan-problems" className="flex-1 text-[14.5px] font-semibold text-ink">
          {problems.length} planned course{problems.length === 1 ? '' : 's'} with unmet requisites
        </h2>
        <ChevronDown aria-hidden className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul id="plan-problems-list" className="flex flex-col border-t border-line px-1.5 py-1.5">
          {problems.map((p) => (
            <li key={p.planCourseId}>
              <button
                type="button"
                onClick={() => onJump(p.planCourseId, p.term)}
                className="flex min-h-10 w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2"
              >
                <span className="course-code w-[52px] shrink-0 text-[14px] text-ink">{codeOf(p.courseId)}</span>
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="block text-danger">{p.check.issues.find((i) => i.severity === 'error')?.message}</span>
                  <span className="text-muted">{termLabel(p.term)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

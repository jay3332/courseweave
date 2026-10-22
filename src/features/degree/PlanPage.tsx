import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/ui'
import { academicYearStart, defaultTerms, isSummer, suggestTerm, type Plan } from '../../lib/plan'
import type { ProgramSelection } from '../../lib/plan-types'
import { termLabel } from '../../lib/requisites'
import { usePlanList, usePlans } from '../../state/plan'
import { useRecord } from '../../state/record'
import { useTerm } from '../../state/term'
import { useMediaQuery } from '../planner/hooks'
import { AuditColumn, ProgramsField, useAuditResult } from './AuditArea'
import { entryYearOf, useCurrentTerm, usePlanDerived, useRecordLike, useScheduledCourses, useStartTermOptions } from './hooks'
import { PlanHeader } from './PlanHeader'
import { RequisiteProblems } from './RequisiteProblems'
import { addToTerm } from './linkActions'
import { SemesterGrid } from './SemesterGrid'

export function PlanPage() {
  const term = useTerm()
  const { planId } = useParams()
  const plans = usePlanList()
  const activePlanId = usePlans((s) => s.activePlanId)
  const setActivePlan = usePlans((s) => s.setActivePlan)

  const plan = planId ? plans.find((p) => p.id === planId) : (plans.find((p) => p.id === activePlanId) ?? plans[0])

  useEffect(() => {
    document.title = `Degree plan · Courseweave`
  }, [])
  useEffect(() => {
    if (plan && plan.id !== activePlanId) setActivePlan(plan.id)
  }, [plan, activePlanId, setActivePlan])

  if (planId && !plan) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <h1 className="display mb-2 text-3xl">Plan not found</h1>
          <p className="text-ink-2">
            This plan isn't saved in this browser. <Link className="text-accent underline" to={`/${term.meta.id}/plan`}>Open your plans</Link>.
          </p>
        </div>
      </div>
    )
  }

  return <div className="h-full overflow-y-auto">{plan ? <PlanView plan={plan} /> : <StartPlan />}</div>
}

function PlanView({ plan }: { plan: Plan }) {
  const term = useTerm()
  const derived = usePlanDerived(plan)
  const record = useRecordLike()
  const isPhone = useMediaQuery('(max-width: 767px)')
  const isWide = useMediaQuery('(min-width: 1180px)')
  const finePointer = useMediaQuery('(pointer: fine)')
  const [tab, setTab] = useState<'semesters' | 'requirements'>('semesters')
  const [openTerms, setOpenTerms] = useState<Record<string, boolean>>({})
  const audit = useAuditResult(derived?.auditInput ?? null)
  const scheduled = useScheduledCourses(plan.terms.map((t) => t.term))

  const toggleTerm = useCallback(
    (t: string) => {
      const col = derived?.columns.find((c) => c.term === t)
      setOpenTerms((prev) => ({ ...prev, [t]: !(prev[t] ?? col?.phase !== 'past') }))
    },
    [derived],
  )

  const jumpTo = useCallback((planCourseId: string, t: string) => {
    setTab('semesters')
    setOpenTerms((prev) => ({ ...prev, [t]: true }))
    requestAnimationFrame(() => {
      const el = document.getElementById(`plan-course-${planCourseId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
    })
  }, [])

  const addFromAudit = useCallback(
    (courseId: string) => {
      if (!derived) return
      const target = suggestTerm(derived.resolved, courseId, derived.catalog, derived.current, derived.unitsOf, (t) => scheduled.get(t), undefined, record)
      if (!target) return
      const id = addToTerm(plan, target, courseId)
      jumpTo(id, target)
    },
    [derived, plan, scheduled, jumpTo, record],
  )

  if (!derived) return null

  const grid = (
    <SemesterGrid plan={plan} derived={derived} openTerms={openTerms} onToggleTerm={toggleTerm} isPhone={isPhone} dragEnabled={finePointer && !isPhone} />
  )
  const auditPanel = <AuditColumn input={derived.auditInput} onAddCourse={addFromAudit} termLabel={termLabel} />

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
      <PlanHeader plan={plan} derived={derived} audit={audit} />
      <RequisiteProblems derived={derived} onJump={jumpTo} />

      {isWide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
          {grid}
          <aside aria-label="Requirements" className="sticky top-4 flex max-h-[calc(100dvh-10rem)] flex-col gap-3 overflow-y-auto">
            <h2 className="display text-[22px] text-ink">Requirements</h2>
            {auditPanel}
          </aside>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Plan views" className="grid grid-cols-2 rounded-lg border border-line bg-surface-2 p-1">
            {(['semesters', 'requirements'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls={`plan-panel-${t}`}
                onClick={() => setTab(t)}
                className={`min-h-10 rounded-md text-[14px] font-medium ${tab === t ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {t === 'semesters' ? 'Semesters' : 'Requirements'}
              </button>
            ))}
          </div>
          <div id={`plan-panel-${tab}`} role="tabpanel">
            {tab === 'semesters' ? grid : auditPanel}
          </div>
        </>
      )}
      <p className="text-[12.5px] text-muted">
        Courses from your <Link to={`/${term.meta.id}/record`} className="underline decoration-line-strong underline-offset-2 hover:text-ink">academic record</Link> appear
        in their semesters automatically. Unit limits and FCE comparisons are guidance; your college's rules and your advisor have the final say.
      </p>
    </div>
  )
}

/** First-run: choose a first semester and programs, then create the plan. */
function StartPlan() {
  const term = useTerm()
  const navigate = useNavigate()
  const current = useCurrentTerm()
  const profile = useRecord((s) => s.profile)
  const recordCount = useRecord((s) => s.entries.length)
  const createPlan = usePlans((s) => s.createPlan)
  const startOptions = useStartTermOptions(current)

  const suggested = useMemo(() => {
    const entry = profile.entryTerm?.toUpperCase()
    if (entry && !isSummer(entry) && startOptions.includes(entry)) return entry
    return academicYearStart(current)
  }, [profile, current, startOptions])

  const [start, setStart] = useState(suggested)
  const [programs, setPrograms] = useState<ProgramSelection[]>([])

  const create = () => {
    const id = createPlan({ startTerm: start, programs, terms: defaultTerms(start) })
    navigate(`/${term.meta.id}/plan/${id}`)
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:py-12">
      <div>
        <h1 className="display text-[34px] text-ink md:text-[42px]">Plan your degree</h1>
        <p className="mt-2 max-w-[60ch] text-[15px] text-ink-2">
          Lay out every semester, see which requirements each course covers, and catch prerequisite problems before registration.
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4 md:p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">First semester at CMU</span>
          <select value={start} onChange={(e) => setStart(e.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface pr-7 pl-2.5 text-[15px] text-ink">
            {startOptions.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </select>
          <span className="text-[12px] text-muted">The plan starts with eight fall and spring semesters. You can add summers and extra semesters later.</span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Programs</span>
          <ProgramsField value={programs} onChange={setPrograms} entryYearHint={entryYearOf(start)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={create}>
            Create plan
          </Button>
          <span className="text-[13px] text-muted">You can change programs any time.</span>
        </div>
      </div>

      <p className="text-[14px] text-ink-2">
        {recordCount > 0 ? (
          <>
            Your <Link to={`/${term.meta.id}/record`} className="text-accent underline underline-offset-2">academic record</Link> has {recordCount}{' '}
            {recordCount === 1 ? 'entry' : 'entries'}. Courses you've taken appear in their semesters, and AP, IB and transfer credit count toward requirements.
          </>
        ) : (
          <>
            Taken courses already, or have AP, IB or transfer credit? Add them to your{' '}
            <Link to={`/${term.meta.id}/record`} className="text-accent underline underline-offset-2">academic record</Link> and they'll show up in every plan.
          </>
        )}
      </p>
    </div>
  )
}

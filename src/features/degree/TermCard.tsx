import { CalendarDays, ChevronDown, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { Button, Dialog } from '../../components/ui'
import { loadWarnings, termPhase, type Plan, type PlanCheck } from '../../lib/plan'
import { termLabel } from '../../lib/requisites'
import { usePlans } from '../../state/plan'
import { useStore, type Schedule } from '../../state/store'
import { useCourseLookup } from '../record/hooks'
import { AddCourseInput } from './AddCourseInput'
import { PlanCourseRow, RecordCourseRow } from './CourseRows'
import { DRAG_TYPE, type ColumnView, type PlanDerived } from './hooks'
import { MenuItem, MenuLabel, Popover } from './Popover'

const PHASE_TAG = { past: 'Completed', current: 'In progress', future: null } as const

interface TermCardProps {
  plan: Plan
  column: ColumnView
  derived: PlanDerived
  scheduled: Set<string> | undefined
  /** The term has published schedule data (so a schedule planner page). */
  published: boolean
  fceHours(courseId: string): number | null
  open: boolean
  onToggle(): void
  /** Collapsing only applies on phones. */
  collapsible: boolean
  dragEnabled: boolean
}

export function TermCard({ plan, column, derived, scheduled, published, fceHours, open, onToggle, collapsible, dragEnabled }: TermCardProps) {
  const { term, totals } = column
  const lookup = useCourseLookup()
  const addCourse = usePlans((s) => s.addCourse)
  const removeCourse = usePlans((s) => s.removeCourse)
  const moveCourse = usePlans((s) => s.moveCourse)
  const updateCourse = usePlans((s) => s.updateCourse)
  const removeTerm = usePlans((s) => s.removeTerm)
  const setTermCourses = usePlans((s) => s.setTermCourses)
  const allSchedules = useStore((s) => s.schedules)
  const schedules = useMemo(() => Object.values(allSchedules).filter((s) => s.termId === term && s.entries.length > 0).sort((a, b) => a.createdAt - b.createdAt), [allSchedules, term])

  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [pendingImport, setPendingImport] = useState<Schedule | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const phase = termPhase(term, derived.current)
  const tag = PHASE_TAG[phase]
  const inPlan = useMemo(() => new Set(plan.terms.flatMap((t) => t.courses.map((c) => c.courseId))), [plan])
  const moveTargets = plan.terms.map((t) => t.term).filter((t) => t !== term)
  const warnings = loadWarnings(totals)
  const problems = column.planned.filter((c) => derived.checks.get(c.id)?.check.level === 'problem').length
  const empty = column.planned.length === 0 && column.recorded.length === 0

  const importSchedule = (s: Schedule) => {
    setTermCourses(
      plan.id,
      term,
      s.entries.filter((e) => !e.hidden).map((e) => ({ courseId: e.courseId, passFail: e.passFail })),
    )
    setPendingImport(null)
  }

  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DRAG_TYPE)
    setDragOver(false)
    if (!id) return
    e.preventDefault()
    moveCourse(plan.id, id, term)
  }

  const headingId = `term-${term}-heading`

  return (
    <section
      id={`term-${term}`}
      aria-labelledby={headingId}
      onDragOver={
        dragEnabled
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDragOver(true)
            }
          : undefined
      }
      onDragLeave={dragEnabled ? () => setDragOver(false) : undefined}
      onDrop={dragEnabled ? onDrop : undefined}
      className={`flex min-w-0 flex-col rounded-xl border bg-surface transition-colors ${dragOver ? 'border-accent ring-2 ring-[color-mix(in_oklab,var(--accent)_25%,transparent)]' : 'border-line'} ${
        phase === 'past' ? 'bg-surface-2/60' : ''
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`term-${term}-body`}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left"
          >
          {collapsible ? <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} /> : null}
          <h3 id={headingId} className="display truncate text-[19px] text-ink">
            {termLabel(term)}
          </h3>
          {tag ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2">{tag}</span> : null}
          {problems > 0 ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-danger" title="Courses with unmet requisites">
              {problems} {problems === 1 ? 'issue' : 'issues'}
            </span>
          ) : null}
          </button>
        ) : (
          <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2">
          {collapsible ? <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} /> : null}
          <h3 id={headingId} className="display truncate text-[19px] text-ink">
            {termLabel(term)}
          </h3>
          {tag ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2">{tag}</span> : null}
          {problems > 0 ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-danger" title="Courses with unmet requisites">
              {problems} {problems === 1 ? 'issue' : 'issues'}
            </span>
          ) : null}
          </div>
        )}
        <span className="shrink-0 text-right leading-none">
          <span className="display text-[20px] text-ink">{totals.units}</span>
          <span className="ml-1 text-[12px] text-muted">{totals.hasVariable ? 'u+' : 'u'}</span>
        </span>
        <Popover label={`Options for ${termLabel(term)}`} button={<MoreHorizontal />}>
          {(close) => (
            <>
              {published ? (
                <>
                  <MenuLabel>{schedules.length ? 'Use a schedule for this semester' : 'No schedules for this semester yet'}</MenuLabel>
                  {schedules.map((s) => (
                    <MenuItem
                      key={s.id}
                      onClick={() => {
                        close()
                        if (column.planned.length) setPendingImport(s)
                        else importSchedule(s)
                      }}
                    >
                      <CalendarDays aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="text-[12px] text-muted">{s.entries.filter((e) => !e.hidden).length} courses</span>
                    </MenuItem>
                  ))}
                  <Link
                    to={`/${term}/schedule`}
                    className="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-[14px] text-ink hover:bg-surface-2 md:min-h-8 md:text-[13.5px]"
                  >
                    <CalendarDays aria-hidden className="size-4 text-muted" />
                    Open the {termLabel(term)} schedule planner
                  </Link>
                  <div className="my-1 border-t border-line" />
                </>
              ) : null}
              <MenuItem
                danger
                disabled={column.fromRecordOnly}
                onClick={() => {
                  close()
                  if (column.planned.length) setConfirmRemove(true)
                  else removeTerm(plan.id, term)
                }}
              >
                <Trash2 aria-hidden />
                Remove semester
              </MenuItem>
            </>
          )}
        </Popover>
      </header>

      {open || !collapsible ? (
        <div id={`term-${term}-body`} className="flex flex-1 flex-col gap-1 px-1.5 py-1.5">
          {empty && !adding ? <p className="px-1.5 py-2 text-[13px] text-muted">{phase === 'past' ? 'Nothing recorded for this semester.' : 'Nothing planned yet.'}</p> : null}
          {column.recorded.length ? (
            <ul aria-label="From your record" className="flex flex-col">
              {column.recorded.map((e) => (
                <RecordCourseRow key={e.id} entry={e} title={e.courseId ? lookup(e.courseId).title : undefined} units={column.recordUnits.get(e.id) ?? 0} />
              ))}
            </ul>
          ) : null}
          {column.planned.length ? (
            <ul aria-label="Planned" className="flex flex-col">
              {column.planned.map((c) => (
                <PlanCourseRow
                  key={c.id}
                  course={c}
                  term={term}
                  current={derived.current}
                  catalog={derived.catalog}
                  unitsOf={derived.unitsOf}
                  title={lookup(c.courseId).title}
                  fceHours={fceHours(c.courseId)}
                  check={derived.checks.get(c.id) as PlanCheck | undefined}
                  scheduled={scheduled}
                  moveTargets={moveTargets}
                  draggable={dragEnabled}
                  onMove={(t) => moveCourse(plan.id, c.id, t)}
                  onRemove={() => removeCourse(plan.id, c.id)}
                  onUpdate={(patch) => updateCourse(plan.id, c.id, patch)}
                />
              ))}
            </ul>
          ) : null}

          {adding ? (
            <div className="px-0.5 pt-1">
              <AddCourseInput
                term={term}
                scheduled={scheduled}
                inPlan={inPlan}
                autoFocus
                onAdd={(id) => addCourse(plan.id, term, id)}
                onClose={() => setAdding(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-auto flex min-h-10 items-center gap-1.5 rounded-md px-1.5 text-[13.5px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:min-h-8"
            >
              <Plus aria-hidden className="size-4" />
              Add course
            </button>
          )}
        </div>
      ) : null}

      {totals.count > 0 ? (
        <footer className="flex flex-col gap-1 border-t border-line px-3 py-2 text-[12.5px]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ink-2">
            <span title="Factorable units count toward your QPA">
              <span className="font-semibold text-ink">{totals.factorable}</span> factorable
            </span>
            {totals.nonFactorable > 0 ? (
              <span title="Pass/fail units count toward graduation but not your QPA">
                <span className="font-semibold text-ink">{totals.nonFactorable}</span> pass/fail
              </span>
            ) : null}
            {totals.fceUnits > 0 ? (
              <span
                className="ml-auto"
                title={
                  (totals.peakHalf
                    ? `Busier half of the term (${totals.peakHalf} half): ${Math.round(totals.peakHours)} FCE hours a week, against ${Math.round(totals.otherHalfHours)} in the other half. Full-semester courses count in both halves; minis only in theirs, at their in-session hours. Units there suggest about ${Math.round(totals.peakExpected)} hours a week (mini units count double). Which half a mini runs in is estimated from past FCEs.`
                    : `FCE hours a week for the ${totals.fceUnits} units with evaluations.`) +
                  (totals.missingFce ? ` ${totals.missingFce} course${totals.missingFce === 1 ? ' has' : 's have'} no FCEs.` : '')
                }
              >
                <span className="font-semibold text-ink">{Math.round(totals.peakHours)}</span> FCE hrs/wk{totals.peakHalf ? ' at peak' : ''}
              </span>
            ) : null}
          </div>
          {warnings.map((w) => (
            <p key={w} className="text-warn">
              {w}. <span className="text-muted">Guidance, not policy.</span>
            </p>
          ))}
        </footer>
      ) : null}

      <Dialog open={pendingImport !== null} onClose={() => setPendingImport(null)} title="Replace planned courses">
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] text-ink-2">
            Replace the {column.planned.length} course{column.planned.length === 1 ? '' : 's'} planned for {termLabel(term)} with the{' '}
            {pendingImport?.entries.filter((e) => !e.hidden).length ?? 0} in “{pendingImport?.name}”?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => pendingImport && importSchedule(pendingImport)}>
              Replace courses
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove semester">
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] text-ink-2">
            Remove {termLabel(term)} and the {column.planned.length} course{column.planned.length === 1 ? '' : 's'} planned in it?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                removeTerm(plan.id, term)
                setConfirmRemove(false)
              }}
            >
              Remove semester
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}

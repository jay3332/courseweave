import { CalendarDays, ChevronDown, Copy, MoreHorizontal, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Dialog } from '../../components/ui'
import { coursesMissingFrom, loadWarnings, termPhase, type Plan, type PlanCheck, type PlanCourse } from '../../lib/plan'
import { courseColorStyle } from '../../lib/colors'
import { seasonsLabel, type requirementsByCourse } from '../../lib/plan-table'
import { codeOf, formatRequisite } from '../../lib/requisite-format'
import { termLabel } from '../../lib/requisites'
import { usePlans } from '../../state/plan'
import { useStore, type Schedule } from '../../state/store'
import { addToTerm, linkTermToSchedule, moveInPlan, removeFromPlan, setPlanNote, setPlanPassFail, setPlanUnits, unlinkTerm } from './linkActions'
import { useCourseLookup } from '../record/hooks'
import { AddCourseInput } from './AddCourseInput'
import { PlanCourseRow, PlanCourseTableRow, RecordCourseRow, RecordCourseTableRow, TABLE_COLUMNS } from './CourseRows'
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
  /** 'table': the detailed, spreadsheet-style layout (S1: Fall 2026, with Satisfies, Notes, Offered, Prerequisites). */
  layout?: 'cards' | 'table'
  /** Table layout: "S1", "Summer 1", … */
  ordinal?: string
  /** Table layout: palette index for the semester's header band. */
  tint?: number
  /** Table layout: the requirements each course counts toward. */
  requirements?: ReturnType<typeof requirementsByCourse>
}

export function TermCard({ plan, column, derived, scheduled, published, fceHours, open, onToggle, collapsible, dragEnabled, layout = 'cards', ordinal, tint = 0, requirements }: TermCardProps) {
  const table = layout === 'table'
  const { term, totals } = column
  const lookup = useCourseLookup()
  const navigate = useNavigate()
  const removeTerm = usePlans((s) => s.removeTerm)
  const setTermCourses = usePlans((s) => s.setTermCourses)
  const allSchedules = useStore((s) => s.schedules)
  const setActiveSchedule = useStore((s) => s.setActiveSchedule)
  const termSchedules = useMemo(() => Object.values(allSchedules).filter((s) => s.termId === term).sort((a, b) => a.createdAt - b.createdAt), [allSchedules, term])
  const schedules = termSchedules.filter((s) => s.entries.length > 0)

  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [pendingImport, setPendingImport] = useState<Schedule | null>(null)
  const [pendingLink, setPendingLink] = useState<{ schedule: Schedule; missing: PlanCourse[] } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const phase = termPhase(term, derived.current)
  const tag = PHASE_TAG[phase]
  const synced = derived.terms.get(term)
  const syncedSchedule = synced?.schedule ? allSchedules[synced.schedule.id] : undefined
  const inPlan = useMemo(() => new Set(derived.resolved.terms.flatMap((t) => t.courses.map((c) => c.courseId))), [derived.resolved])

  const startSync = (s: Schedule) => {
    const own = plan.terms.find((t) => t.term === term)?.courses ?? []
    const missing = coursesMissingFrom(own, s)
    if (missing.length) setPendingLink({ schedule: s, missing })
    else linkTermToSchedule(plan, term, s, 'as-is')
  }
  const openSchedule = (scheduleId: string) => {
    setActiveSchedule(term, scheduleId)
    navigate(`/${term}/schedule`)
  }
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
    moveInPlan(plan, id, term)
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
      <header
        className={`flex items-center gap-2 border-b border-line px-3 py-2 ${table ? 'rounded-t-xl' : ''}`}
        style={table ? { ...courseColorStyle(tint), background: 'color-mix(in oklab, var(--course) 15%, var(--surface))' } : undefined}
      >
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
            {table && ordinal ? `${ordinal}: ` : ''}
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
            {table && ordinal ? `${ordinal}: ` : ''}
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
              {published && syncedSchedule ? (
                <>
                  <MenuItem
                    onClick={() => {
                      close()
                      unlinkTerm(plan, term)
                    }}
                  >
                    <Unlink aria-hidden />
                    <span className="min-w-0 flex-1 truncate">Stop syncing with {syncedSchedule.name}</span>
                  </MenuItem>
                  <div className="my-1 border-t border-line" />
                </>
              ) : null}
              {published && !syncedSchedule && termSchedules.length ? (
                <>
                  <MenuLabel>Sync with a schedule</MenuLabel>
                  {termSchedules.map((s) => (
                    <MenuItem
                      key={s.id}
                      onClick={() => {
                        close()
                        startSync(s)
                      }}
                    >
                      <RefreshCw aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="text-[12px] text-muted">{s.entries.filter((e) => !e.hidden).length} courses</span>
                    </MenuItem>
                  ))}
                  <div className="my-1 border-t border-line" />
                </>
              ) : null}
              {published && !syncedSchedule ? (
                <>
                  <MenuLabel>{schedules.length ? 'Copy courses from a schedule' : 'No schedules for this semester yet'}</MenuLabel>
                  {schedules.map((s) => (
                    <MenuItem
                      key={s.id}
                      onClick={() => {
                        close()
                        if (column.planned.length) setPendingImport(s)
                        else importSchedule(s)
                      }}
                    >
                      <Copy aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="text-[12px] text-muted">{s.entries.filter((e) => !e.hidden).length} courses</span>
                    </MenuItem>
                  ))}
                </>
              ) : null}
              {published ? (
                <>
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

      {syncedSchedule ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <button
            type="button"
            onClick={() => openSchedule(syncedSchedule.id)}
            title={`This semester's courses come from “${syncedSchedule.name}”; changes here update that schedule.`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-2 hover:border-ink-2 hover:text-ink md:min-h-6"
          >
            <RefreshCw aria-hidden className="size-3.5 text-ok" />
            Synced with {syncedSchedule.name}
          </button>
        </div>
      ) : synced?.missing ? (
        <div role="status" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] text-warn">
          <span className="min-w-0 flex-1">The synced schedule was deleted; showing your planned courses.</span>
          <button type="button" onClick={() => unlinkTerm(plan, term)} className="min-h-8 rounded px-1 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
            Stop syncing
          </button>
        </div>
      ) : null}

      {open || !collapsible ? (
        <div id={`term-${term}-body`} className="flex flex-1 flex-col gap-1 px-1.5 py-1.5">
          {empty && !adding ? <p className="px-1.5 py-2 text-[13px] text-muted">{phase === 'past' ? 'Nothing recorded for this semester.' : 'Nothing planned yet.'}</p> : null}
          {table && (column.recorded.length || column.planned.length) ? (
            <div className="scrollbar-thin -mx-1.5 overflow-x-auto">
              <table className="w-full min-w-[960px] table-fixed text-left text-[13px]">
                <colgroup>
                  <col className="w-[86px]" />
                  <col className="min-w-[180px]" />
                  <col className="w-[48px]" />
                  <col className="w-[140px]" />
                  <col className="w-[150px]" />
                  <col className="w-[104px]" />
                  <col className="w-[196px]" />
                  <col className="w-[48px]" />
                  <col className="w-[40px]" />
                </colgroup>
                <thead className="text-[12px] text-muted">
                  <tr>
                    {TABLE_COLUMNS.map((c, i) => (
                      <th key={c || i} scope="col" className={`py-1.5 pr-2 font-medium ${i === 0 ? 'sticky left-0 z-[1] bg-surface pl-2' : ''} ${c === 'Units' || c === 'FCE' ? 'text-right' : ''}`}>
                        {c || <span className="sr-only">Options</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {column.recorded.map((e) => (
                    <RecordCourseTableRow
                      key={e.id}
                      entry={e}
                      title={e.courseId ? lookup(e.courseId).title : undefined}
                      units={column.recordUnits.get(e.id) ?? 0}
                      satisfies={e.courseId ? (requirements?.get(e.courseId, term) ?? null) : null}
                      offered={e.courseId ? seasonsLabel(derived.catalog?.courses[e.courseId]) : null}
                    />
                  ))}
                  {column.planned.map((c) => {
                    const entry = derived.catalog?.courses[c.courseId]
                    return (
                      <PlanCourseTableRow
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
                        removeLabel={syncedSchedule ? `Remove from ${syncedSchedule.name}` : undefined}
                        onMove={(t) => moveInPlan(plan, c.id, t)}
                        onRemove={() => removeFromPlan(plan, c.id)}
                        onUpdate={(patch) => {
                          if ('passFail' in patch) setPlanPassFail(plan, c.id, !!patch.passFail)
                          if ('units' in patch) setPlanUnits(plan, c.id, patch.units)
                        }}
                        satisfies={requirements?.get(c.courseId, term) ?? null}
                        freeElective={!!requirements?.free.has(c.courseId)}
                        offered={seasonsLabel(entry)}
                        prerequisites={entry?.prereqs ? formatRequisite(entry.prereqs) : entry ? null : 'Not in the catalog'}
                        onNote={(note) => setPlanNote(plan, c.id, note)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!table && column.recorded.length ? (
            <ul aria-label="From your record" className="flex flex-col">
              {column.recorded.map((e) => (
                <RecordCourseRow key={e.id} entry={e} title={e.courseId ? lookup(e.courseId).title : undefined} units={column.recordUnits.get(e.id) ?? 0} />
              ))}
            </ul>
          ) : null}
          {column.alsoRecorded.length ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1 text-[12.5px] text-muted">
              <span>
                {column.alsoRecorded.length === 1 ? '1 planned course is' : `${column.alsoRecorded.length} planned courses are`} already on your
                record for this semester{syncedSchedule ? ` (still in ${syncedSchedule.name})` : ''}.
              </span>
              {!syncedSchedule ? (
                <button
                  type="button"
                  className="min-h-9 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink md:min-h-0"
                  onClick={() => column.alsoRecorded.forEach((c) => removeFromPlan(plan, c.id))}
                >
                  Remove from plan
                </button>
              ) : null}
            </div>
          ) : null}
          {!table && column.planned.length ? (
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
                  removeLabel={syncedSchedule ? `Remove from ${syncedSchedule.name}` : undefined}
                  onMove={(t) => moveInPlan(plan, c.id, t)}
                  onRemove={() => removeFromPlan(plan, c.id)}
                  onUpdate={(patch) => {
                    if ('passFail' in patch) setPlanPassFail(plan, c.id, !!patch.passFail)
                    if ('units' in patch) setPlanUnits(plan, c.id, patch.units)
                  }}
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
                onAdd={(id) => addToTerm(plan, term, id)}
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

      <Dialog open={pendingLink !== null} onClose={() => setPendingLink(null)} title={`Sync ${termLabel(term)} with a schedule`}>
        {pendingLink ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-[15px] text-ink-2">
              {pendingLink.missing.length} course{pendingLink.missing.length === 1 ? '' : 's'} planned for {termLabel(term)}{' '}
              {pendingLink.missing.length === 1 ? "isn't" : "aren't"} in “{pendingLink.schedule.name}”:{' '}
              <span className="course-code text-ink">{pendingLink.missing.map((c) => codeOf(c.courseId)).join(', ')}</span>.
            </p>
            <p className="text-[13.5px] text-muted">Once synced, this semester shows the schedule's courses, and changes in either place update both.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingLink(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  linkTermToSchedule(plan, term, pendingLink.schedule, 'as-is')
                  setPendingLink(null)
                }}
              >
                Use the schedule as is
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  linkTermToSchedule(plan, term, pendingLink.schedule, 'merge')
                  setPendingLink(null)
                }}
              >
                Add {pendingLink.missing.length === 1 ? 'it' : `these ${pendingLink.missing.length}`} to the schedule
              </Button>
            </div>
          </div>
        ) : null}
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

import { coursePreview } from '../../components/CoursePreview'
import { AlertTriangle, ArrowRightLeft, Check, Clock, ExternalLink, GripVertical, Info, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { CatalogIndex } from '../../lib/catalog-types'
import { FCE_HOURS_HELP, formatHours } from '../../lib/fce'
import { isVariableUnits, offering, OFFERING_LABEL, planCourseUnits, planCoursePassFail, termPhase, type PlanCheck, type PlanCourse, type RecordEntryLike, type UnitsOf } from '../../lib/plan'
import { termLabel } from '../../lib/requisites'
import { codeOf } from '../../lib/requisite-format'
import { useRecord } from '../../state/record'
import { DRAG_TYPE, useCourseHref } from './hooks'
import { MenuItem, MenuLabel, Popover } from './Popover'

const LEVEL = {
  ok: { icon: Check, tone: 'text-ok', label: 'Requisites met' },
  planned: { icon: Clock, tone: 'text-warn', label: 'Requisites met by planned courses' },
  unknown: { icon: Info, tone: 'text-muted', label: 'Check requisites' },
  problem: { icon: AlertTriangle, tone: 'text-danger', label: 'Requisite problem' },
} as const

interface PlanCourseRowProps {
  course: PlanCourse
  term: string
  current: string
  catalog: CatalogIndex | null
  unitsOf: UnitsOf
  title: string | undefined
  fceHours: number | null
  check: PlanCheck | undefined
  scheduled: Set<string> | null | undefined
  /** Other semesters it can move to. */
  moveTargets: string[]
  draggable: boolean
  /** Label for the remove action (synced semesters remove from their schedule). */
  removeLabel?: string
  onMove(toTerm: string): void
  onRemove(): void
  onUpdate(patch: { passFail?: boolean; units?: number }): void
}

export function PlanCourseRow({ course, term, current, catalog, unitsOf, title, fceHours, check, scheduled, moveTargets, draggable, removeLabel, onMove, onRemove, onUpdate }: PlanCourseRowProps) {
  const href = useCourseHref()
  const setOverride = useRecord((s) => s.setOverride)
  const [showIssues, setShowIssues] = useState(false)
  const units = planCourseUnits(course, unitsOf)
  const passFailOnly = !!catalog?.courses[course.courseId]?.passFail
  const passFail = planCoursePassFail(course, catalog)
  const variable = isVariableUnits(course.courseId, catalog)
  const future = termPhase(term, current) !== 'past'
  const o = future ? offering(course.courseId, term, catalog, scheduled) : null
  const offeringWarning = o === 'not-scheduled' || o === 'other-seasons'

  const level = future && check ? check.check.level : null
  const issues = check?.check.issues.filter((i) => i.severity !== 'info') ?? []
  const Status = level ? LEVEL[level] : null
  const statusTitle = Status ? (issues.length ? issues.map((i) => i.message).join('\n') : Status.label) : undefined

  return (
    <li
      id={`plan-course-${course.id}`}
      tabIndex={-1}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, course.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="group rounded-md border border-transparent px-1.5 py-1 outline-none focus-visible:border-accent hover:bg-surface-2 target:border-accent"
    >
      <div className="flex min-h-9 items-center gap-1.5 md:min-h-7" {...coursePreview(course.courseId)}>
        {draggable ? <GripVertical aria-hidden className="size-3.5 shrink-0 cursor-grab text-line-strong group-hover:text-muted" /> : null}
        <Link to={href(course.courseId)} className="course-code shrink-0 text-[14.5px] text-ink hover:text-accent">
          {codeOf(course.courseId)}
        </Link>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={title}>
          {title ?? 'Not in the catalog'}
        </span>
        {passFail ? (
          <span title={passFailOnly ? 'Pass/fail only: units are not factorable' : 'Taking pass/fail: units are not factorable'} className="shrink-0 rounded border border-line px-1 text-[11px] font-semibold text-muted">
            P/F
          </span>
        ) : null}
        {offeringWarning ? (
          <span title={OFFERING_LABEL[o!]} className="shrink-0 text-warn">
            <AlertTriangle aria-label={OFFERING_LABEL[o!]} className="size-3.5" />
          </span>
        ) : null}
        {Status ? (
          <button
            type="button"
            onClick={() => setShowIssues(!showIssues)}
            aria-expanded={showIssues}
            aria-label={`${codeOf(course.courseId)}: ${statusTitle}`}
            title={statusTitle}
            className={`grid size-9 shrink-0 place-items-center rounded md:size-6 ${Status.tone} hover:bg-surface`}
          >
            <Status.icon aria-hidden className="size-3.5" />
          </button>
        ) : null}
        <span className="w-10 shrink-0 text-right text-[12px] text-muted tabular-nums" title={FCE_HOURS_HELP}>
          {fceHours !== null ? `${formatHours(fceHours)}h` : ''}
        </span>
        <span className="w-9 shrink-0 text-right text-[12.5px] text-ink-2 tabular-nums" title={variable ? 'Variable units' : undefined}>
          {units}
          {variable ? '*' : ''}u
        </span>
        <Popover label={`Options for ${codeOf(course.courseId)}`} button={<MoreHorizontal />}>
          {(close) => (
            <>
              <MenuLabel>Move to</MenuLabel>
              <div className="scrollbar-thin max-h-52 overflow-y-auto">
                {moveTargets.map((t) => (
                  <MenuItem
                    key={t}
                    onClick={() => {
                      onMove(t)
                      close()
                    }}
                  >
                    <ArrowRightLeft aria-hidden />
                    {termLabel(t)}
                  </MenuItem>
                ))}
              </div>
              <div className="my-1 border-t border-line" />
              <label className={`flex min-h-10 items-center gap-2 rounded-md px-2.5 text-[14px] md:min-h-8 md:text-[13.5px] ${passFailOnly ? 'text-muted' : 'text-ink hover:bg-surface-2'}`}>
                <input type="checkbox" checked={passFail} disabled={passFailOnly} onChange={(e) => onUpdate({ passFail: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                {passFailOnly ? 'Pass/fail only' : 'Take pass/fail'}
              </label>
              {variable ? (
                <label className="flex min-h-10 items-center gap-2 px-2.5 text-[14px] text-ink md:min-h-8 md:text-[13.5px]">
                  Units
                  <input
                    type="number"
                    min={0}
                    max={48}
                    step={1}
                    value={course.units ?? units}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      onUpdate({ units: Number.isFinite(n) && e.target.value !== '' ? n : undefined })
                    }}
                    className="h-8 w-20 rounded-md border border-line-strong bg-surface px-2 text-[14px]"
                  />
                </label>
              ) : null}
              <Link to={href(course.courseId)} className="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-[14px] text-ink hover:bg-surface-2 md:min-h-8 md:text-[13.5px]">
                <ExternalLink aria-hidden className="size-4 text-muted" />
                View course
              </Link>
              <MenuItem
                danger
                onClick={() => {
                  onRemove()
                  close()
                }}
              >
                <Trash2 aria-hidden />
                {removeLabel ?? 'Remove from plan'}
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
      {showIssues && check ? (
        <div className="mt-1 mb-1 ml-1 flex flex-col gap-1 border-l-2 border-line pl-2.5 text-[12.5px]">
          {check.check.issues.length === 0 ? <p className="text-muted">{Status?.label}</p> : null}
          {check.check.issues.map((i, n) => (
            <p key={n} className={i.severity === 'error' ? 'text-danger' : i.severity === 'warning' ? 'text-warn' : 'text-muted'}>
              {i.message}
            </p>
          ))}
          {issues.some((i) => i.kind === 'prereq' || i.kind === 'coreq') ? (
            <button
              type="button"
              onClick={() => setOverride(course.courseId, { prereqs: true, coreqs: true, note: 'Waived from the degree plan' })}
              className="self-start rounded px-1 py-1 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              Mark requisites as waived
            </button>
          ) : null}
          {check.check.waived.prereqs || check.check.waived.coreqs ? (
            <button
              type="button"
              onClick={() => setOverride(course.courseId, null)}
              className="self-start rounded px-1 py-1 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              Undo waiver
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** A read-only course from the academic record. */
export function RecordCourseRow({ entry, title, units }: { entry: RecordEntryLike; title: string | undefined; units: number }) {
  const href = useCourseHref()
  return (
    <li className="flex min-h-9 items-center gap-1.5 px-1.5 py-1 md:min-h-7" {...coursePreview(entry.courseId)}>
      <span className="sr-only">From your academic record:</span>
      {entry.courseId ? (
        <Link to={href(entry.courseId)} className="course-code shrink-0 text-[14.5px] text-ink-2 hover:text-accent">
          {codeOf(entry.courseId)}
        </Link>
      ) : (
        <span className="course-code shrink-0 text-[14.5px] text-ink-2">Transfer</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{entry.label ?? title ?? 'Not in the catalog'}</span>
      {entry.grade ? <span className="shrink-0 rounded bg-surface-2 px-1.5 text-[11.5px] font-semibold text-ink-2">{entry.grade}</span> : null}
      <span className="w-9 shrink-0 text-right text-[12.5px] text-muted tabular-nums">{units}u</span>
    </li>
  )
}

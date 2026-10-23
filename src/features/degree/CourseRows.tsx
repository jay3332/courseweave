import { coursePreview } from '../../components/CoursePreview'
import { AlertTriangle, ArrowRightLeft, Check, Clock, ExternalLink, GripVertical, Info, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import type { CatalogIndex } from '../../lib/catalog-types'
import type { Satisfies } from '../../lib/plan-table'
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

/** What a planned course row shows, shared by the card and table layouts. */
function useCourseRowInfo({ course, term, current, catalog, unitsOf, check, scheduled }: Pick<PlanCourseRowProps, 'course' | 'term' | 'current' | 'catalog' | 'unitsOf' | 'check' | 'scheduled'>) {
  const units = planCourseUnits(course, unitsOf)
  const passFailOnly = !!catalog?.courses[course.courseId]?.passFail
  const passFail = planCoursePassFail(course, catalog)
  const variable = isVariableUnits(course.courseId, catalog)
  const future = termPhase(term, current) !== 'past'
  const o = future ? offering(course.courseId, term, catalog, scheduled) : null
  const offeringWarning = o === 'not-scheduled' || o === 'other-seasons' ? OFFERING_LABEL[o] : null
  const level = future && check ? check.check.level : null
  const issues = check?.check.issues.filter((i) => i.severity !== 'info') ?? []
  const Status = level ? LEVEL[level] : null
  const statusTitle = Status ? (issues.length ? issues.map((i) => i.message).join('\n') : Status.label) : undefined
  return { units, passFailOnly, passFail, variable, offeringWarning, Status, statusTitle }
}

function StatusButton({ courseId, info, open, onToggle }: { courseId: string; info: ReturnType<typeof useCourseRowInfo>; open: boolean; onToggle(): void }) {
  const { Status, statusTitle } = info
  if (!Status) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${codeOf(courseId)}: ${statusTitle}`}
      title={statusTitle}
      className={`grid size-9 shrink-0 place-items-center rounded md:size-6 ${Status.tone} hover:bg-surface`}
    >
      <Status.icon aria-hidden className="size-3.5" />
    </button>
  )
}

/** Move, pass/fail, units, view and remove. */
function CourseOptions({ props, info }: { props: PlanCourseRowProps; info: ReturnType<typeof useCourseRowInfo> }) {
  const href = useCourseHref()
  const { course, moveTargets, removeLabel, onMove, onRemove, onUpdate } = props
  const { units, passFail, passFailOnly, variable } = info
  return (
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
              <UnitsInput value={course.units ?? units} onChange={(u) => onUpdate({ units: u })} />
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
  )
}

function UnitsInput({ value, onChange, className = 'h-8 w-20 rounded-md border border-line-strong bg-surface px-2 text-[14px]' }: { value: number; onChange(units: number | undefined): void; className?: string }) {
  return (
    <input
      type="number"
      min={0}
      max={48}
      step={1}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value)
        onChange(Number.isFinite(n) && e.target.value !== '' ? n : undefined)
      }}
      className={className}
    />
  )
}

/** The requisite issues under a row, with waive / undo. */
function CourseIssues({ course, check, statusLabel }: { course: PlanCourse; check: PlanCheck; statusLabel: string | undefined }) {
  const setOverride = useRecord((s) => s.setOverride)
  const issues = check.check.issues.filter((i) => i.severity !== 'info')
  return (
    <div className="mt-1 mb-1 ml-1 flex flex-col gap-1 border-l-2 border-line pl-2.5 text-[12.5px]">
      {check.check.issues.length === 0 ? <p className="text-muted">{statusLabel}</p> : null}
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
  )
}

const dragProps = (course: PlanCourse, draggable: boolean) => ({
  draggable,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, course.id)
    e.dataTransfer.effectAllowed = 'move'
  },
})

export function PlanCourseRow(props: PlanCourseRowProps) {
  const { course, title, fceHours, check, draggable } = props
  const href = useCourseHref()
  const [showIssues, setShowIssues] = useState(false)
  const info = useCourseRowInfo(props)
  const { units, passFailOnly, passFail, variable, offeringWarning, Status } = info

  return (
    <li
      id={`plan-course-${course.id}`}
      tabIndex={-1}
      {...dragProps(course, draggable)}
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
          <span title={offeringWarning} className="shrink-0 text-warn">
            <AlertTriangle aria-label={offeringWarning} className="size-3.5" />
          </span>
        ) : null}
        <StatusButton courseId={course.courseId} info={info} open={showIssues} onToggle={() => setShowIssues(!showIssues)} />
        <span className="w-10 shrink-0 text-right text-[12px] text-muted tabular-nums" title={FCE_HOURS_HELP}>
          {fceHours !== null ? `${formatHours(fceHours)}h` : ''}
        </span>
        <span className="w-9 shrink-0 text-right text-[12.5px] text-ink-2 tabular-nums" title={variable ? 'Variable units' : undefined}>
          {units}
          {variable ? '*' : ''}u
        </span>
        <CourseOptions props={props} info={info} />
      </div>
      {showIssues && check ? <CourseIssues course={course} check={check} statusLabel={Status?.label} /> : null}
    </li>
  )
}

/** Columns of the detailed (table) layout, in order. */
export const TABLE_COLUMNS = ['Course', 'Name', 'Units', 'Satisfies', 'Notes', 'Offered', 'Prerequisites', 'FCE', ''] as const

interface TableExtras {
  satisfies: Satisfies | null
  freeElective: boolean
  offered: string | null
  prerequisites: string | null
  onNote(note: string): void
}

function SatisfiesCell({ satisfies, freeElective }: { satisfies: Satisfies | null; freeElective: boolean }) {
  if (satisfies?.labels.length)
    return (
      <span className="line-clamp-2 text-ink-2" title={satisfies.paths.join('\n')}>
        {satisfies.labels.join(', ')}
      </span>
    )
  return freeElective ? <span className="text-muted">Free elective</span> : <span className="text-muted">—</span>
}

/** Notes save when you leave the field (or press Enter), not on every keystroke. */
function NoteInput({ value, label, onSave }: { value: string; label: string; onSave(note: string): void }) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : value
  return (
    <input
      value={shown}
      aria-label={label}
      placeholder="Add a note"
      maxLength={1000}
      onFocus={() => {
        setDraft(value)
        setEditing(true)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        if (editing && draft.trim() !== value) onSave(draft.trim())
        setEditing(false)
      }}
      className="h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-ink placeholder:text-line-strong hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none md:h-7"
    />
  )
}

/** A planned course as a spreadsheet row; everything the card row does, plus Satisfies, Notes, Offered and Prerequisites. */
export function PlanCourseTableRow(props: PlanCourseRowProps & TableExtras) {
  const { course, title, fceHours, check, draggable, satisfies, freeElective, offered, prerequisites, onNote, onUpdate } = props
  const href = useCourseHref()
  const [showIssues, setShowIssues] = useState(false)
  const info = useCourseRowInfo(props)
  const { units, passFailOnly, passFail, variable, offeringWarning, Status } = info
  const code = codeOf(course.courseId)
  return (
    <>
      <tr id={`plan-course-${course.id}`} tabIndex={-1} {...dragProps(course, draggable)} className="group border-t border-line outline-none hover:bg-surface-2 focus-visible:bg-surface-2">
        <td className="sticky left-0 z-[1] bg-surface py-1 pr-2 pl-2 align-middle whitespace-nowrap group-hover:bg-surface-2">
          <span className="flex items-center gap-1">
            {draggable ? <GripVertical aria-hidden className="size-3.5 shrink-0 cursor-grab text-line-strong group-hover:text-muted" /> : null}
            <Link to={href(course.courseId)} {...coursePreview(course.courseId)} className="course-code text-[14.5px] text-ink hover:text-accent">
              {code}
            </Link>
          </span>
        </td>
        <td className="max-w-0 py-1 pr-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-ink" title={title}>
              {title ?? 'Not in the catalog'}
            </span>
            {passFail ? (
              <span title={passFailOnly ? 'Pass/fail only: units are not factorable' : 'Taking pass/fail: units are not factorable'} className="shrink-0 rounded border border-line px-1 text-[11px] font-semibold text-muted">
                P/F
              </span>
            ) : null}
          </span>
        </td>
        <td className="py-1 pr-2 text-right tabular-nums">
          {variable ? (
            <UnitsInput value={course.units ?? units} onChange={(u) => onUpdate({ units: u })} className="h-8 w-14 rounded-md border border-line bg-surface px-1.5 text-right text-[13px] md:h-7" />
          ) : (
            units
          )}
        </td>
        <td className="py-1 pr-2 text-[12.5px]">
          <SatisfiesCell satisfies={satisfies} freeElective={freeElective} />
        </td>
        <td className="py-1 pr-2">
          <NoteInput value={course.note ?? ''} label={`Note for ${code}`} onSave={onNote} />
        </td>
        <td className={`py-1 pr-2 text-[12.5px] whitespace-nowrap ${offeringWarning ? 'text-warn' : 'text-ink-2'}`} title={offeringWarning ?? undefined}>
          {offeringWarning ? <AlertTriangle aria-label={offeringWarning} className="mr-1 inline size-3.5 align-[-2px]" /> : null}
          {offered ?? '—'}
        </td>
        <td className="max-w-0 py-1 pr-2 text-[12.5px] text-ink-2">
          <span className="flex min-w-0 items-center gap-1">
            <StatusButton courseId={course.courseId} info={info} open={showIssues} onToggle={() => setShowIssues(!showIssues)} />
            <span className="truncate" title={prerequisites ?? undefined}>
              {prerequisites ?? 'None'}
            </span>
          </span>
        </td>
        <td className="py-1 pr-2 text-right text-[12px] text-muted tabular-nums" title={FCE_HOURS_HELP}>
          {fceHours !== null ? `${formatHours(fceHours)}h` : ''}
        </td>
        <td className="py-1 pr-1 text-right">
          <CourseOptions props={props} info={info} />
        </td>
      </tr>
      {showIssues && check ? (
        <tr>
          <td colSpan={TABLE_COLUMNS.length} className="px-2 pb-1">
            <CourseIssues course={course} check={check} statusLabel={Status?.label} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** A course from the academic record as a (read-only) table row. */
export function RecordCourseTableRow({ entry, title, units, satisfies, offered }: { entry: RecordEntryLike; title: string | undefined; units: number; satisfies: Satisfies | null; offered: string | null }) {
  const href = useCourseHref()
  return (
    <tr className="border-t border-line text-ink-2">
      <td className="sticky left-0 z-[1] bg-surface py-1 pr-2 pl-2 whitespace-nowrap">
        <span className="sr-only">From your academic record:</span>
        {entry.courseId ? (
          <Link to={href(entry.courseId)} {...coursePreview(entry.courseId)} className="course-code pl-[18px] text-[14.5px] text-ink-2 hover:text-accent">
            {codeOf(entry.courseId)}
          </Link>
        ) : (
          <span className="course-code pl-[18px] text-[14.5px]">Transfer</span>
        )}
      </td>
      <td className="max-w-0 py-1 pr-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted">{entry.label ?? title ?? 'Not in the catalog'}</span>
          {entry.grade ? <span className="shrink-0 rounded bg-surface-2 px-1.5 text-[11.5px] font-semibold text-ink-2">{entry.grade}</span> : null}
        </span>
      </td>
      <td className="py-1 pr-2 text-right text-muted tabular-nums">{units}</td>
      <td className="py-1 pr-2 text-[12.5px]">
        <SatisfiesCell satisfies={satisfies} freeElective={false} />
      </td>
      <td className="py-1 pr-2 text-[12.5px] text-muted">On your record</td>
      <td className="py-1 pr-2 text-[12.5px] whitespace-nowrap text-muted">{offered ?? '—'}</td>
      <td className="py-1 pr-2 text-[12.5px] text-muted">—</td>
      <td />
      <td />
    </tr>
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

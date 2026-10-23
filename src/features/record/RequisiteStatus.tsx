import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { Button } from '../../components/ui'
import { useCatalogIndex } from '../../lib/catalog'
import type { CatalogEntry } from '../../lib/catalog-types'
import { checkCourse, type CourseCheck, type RequisiteContext } from '../../lib/requisites'
import { useRecord } from '../../state/record'
import { CourseChipList, RequisiteExpression } from '../catalog/RequisiteExpression'
import { LEVEL_STYLE, statusFnFor, summarizeCheck } from './check-summary'
import { useRequisiteContext } from './context'

interface RequisiteStatusProps {
  courseId: string
  /** The term the course would be taken in, e.g. "S27". */
  termId: string
  /** Supply a context to check against a custom plan (degree planner); defaults to record + active schedule. */
  context?: RequisiteContext
  defaultOpen?: boolean
  /** Hide the status line when there's nothing to report ("No prerequisites"). */
  hideWhenClear?: boolean
  /** Render the expanded details here instead of under the status line (e.g. a row below a bottom-aligned header). */
  detailsContainer?: HTMLElement | null
  className?: string
}

/**
 * Status line for one course's requisites with expandable details and waiver actions.
 * Green: met. Amber: met by planned or same-term courses. Red: missing or conflicting.
 */
export function RequisiteStatus({ courseId, termId, context, defaultOpen = false, hideWhenClear = false, detailsContainer, className = '' }: RequisiteStatusProps) {
  const own = useRequisiteContext(termId)
  const catalog = useCatalogIndex()
  const [open, setOpen] = useState(defaultOpen)
  const detailsId = useId()

  const ctx = context ?? own.ctx
  const entry = catalog.status === 'ready' ? catalog.value.courses[courseId] : undefined
  const check = useMemo(() => (ctx ? checkCourse(courseId, entry, ctx) : null), [ctx, courseId, entry])

  if (catalog.status === 'error') {
    return <p className={`text-[13px] text-muted ${className}`}>Requisites unavailable: {catalog.error}</p>
  }
  if (!check) return <p className={`min-h-6 text-[13px] text-muted ${className}`}>Checking requisites…</p>
  if (catalog.status === 'ready' && !entry) {
    return hideWhenClear ? null : <p className={`text-[13px] text-muted ${className}`}>No requisite information in the catalog.</p>
  }

  const summary = summarizeCheck(check, entry)
  if (hideWhenClear && summary.level === 'none') return null
  const { icon: Icon, color } = LEVEL_STYLE[summary.level]
  const expandable = summary.level !== 'none' || check.issues.length > 0

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex min-h-9 items-start gap-2 md:min-h-7">
        <Icon aria-hidden className={`mt-[3px] size-4 shrink-0 ${color}`} />
        <p className={`min-w-0 flex-1 text-[13.5px] leading-snug ${summary.level === 'problem' ? 'text-danger' : 'text-ink-2'}`}>{summary.text}</p>
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen(!open)}
            className="-my-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:min-h-7"
          >
            {open ? 'Hide' : 'Details'}
            <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>
      {open && ctx && entry
        ? detailsContainer
          ? createPortal(<RequisiteDetails id={detailsId} check={check} entry={entry} ctx={ctx} termId={termId} />, detailsContainer)
          : <RequisiteDetails id={detailsId} check={check} entry={entry} ctx={ctx} termId={termId} />
        : null}
    </div>
  )
}

function DetailBlock({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 md:min-h-7">
        <h4 className="text-[12.5px] font-semibold text-ink-2">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function RequisiteDetails({ id, check, entry, ctx, termId }: { id: string; check: CourseCheck; entry: CatalogEntry; ctx: RequisiteContext; termId: string }) {
  const setOverride = useRecord((s) => s.setOverride)
  const override = useRecord((s) => s.overrides[check.courseId])
  const prereqStatus = useMemo(() => statusFnFor(ctx, false), [ctx])
  const coreqStatus = useMemo(() => statusFnFor(ctx, true), [ctx])

  const waiveButton = (key: 'prereqs' | 'coreqs' | 'antireqs', label: string, needed: boolean) =>
    check.waived[key] ? (
      <Button size="sm" variant="ghost" className="min-h-9 md:min-h-7" onClick={() => setOverride(check.courseId, { [key]: false })}>
        Undo waiver
      </Button>
    ) : needed ? (
      <Button size="sm" variant="secondary" className="min-h-9 md:min-h-7" onClick={() => setOverride(check.courseId, { [key]: true })}>
        {label}
      </Button>
    ) : null

  const prereqMissing = check.prereqs?.status === 'missing' || check.prereqs?.status === 'unknown'
  const coreqMissing = check.coreqs?.status === 'missing'
  const warnings = check.issues.filter((i) => i.severity === 'warning')

  return (
    <div id={id} className="mt-2 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
      {entry.prereqs ? (
        <DetailBlock title={check.waived.prereqs ? 'Prerequisites (waived)' : 'Prerequisites'} action={waiveButton('prereqs', 'Mark as waived', prereqMissing)}>
          <RequisiteExpression req={entry.prereqs} status={prereqStatus} />
        </DetailBlock>
      ) : null}
      {entry.coreqs.length ? (
        <DetailBlock
          title={check.waived.coreqs ? 'Corequisite, before or same semester (waived)' : 'Corequisite, before or same semester'}
          action={waiveButton('coreqs', 'Mark as waived', coreqMissing)}
        >
          <CourseChipList ids={entry.coreqs} status={coreqStatus} joinWord="or" />
        </DetailBlock>
      ) : null}
      {check.antireqs.length || check.waived.antireqs ? (
        <DetailBlock title="Can't get credit alongside" action={waiveButton('antireqs', 'Ignore', check.antireqs.length > 0)}>
          {check.antireqs.length ? (
            <CourseChipList ids={check.antireqs.map((a) => a.courseId)} />
          ) : (
            <p className="text-[13px] text-muted">Ignored for this course.</p>
          )}
        </DetailBlock>
      ) : null}
      {warnings.length ? (
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w.message} className="flex items-start gap-2 text-[13px] text-ink-2">
              <AlertTriangle aria-hidden className="mt-[2px] size-3.5 shrink-0 text-warn" />
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
      {override?.note ? <p className="text-[13px] text-ink-2">Your note: {override.note}</p> : null}
      <p className="text-[12.5px] text-muted">
        Checked against your{' '}
        <Link to={`/${termId}/record`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
          academic record
        </Link>{' '}
        and this semester's schedule. Green is done, amber is planned, red is missing.
      </p>
    </div>
  )
}

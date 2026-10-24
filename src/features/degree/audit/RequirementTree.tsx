import { coursePreview } from '../../../components/CoursePreview'
import { ChevronRight, Info, Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { courseOptions, describeTarget } from '../../../lib/audit'
import type { CatalogIndex } from '../../../lib/catalog-types'
import type { ReqNode } from '../../../lib/degree-types'
import type { RequirementResult } from '../../../lib/plan-types'
import { codeOf } from '../../../lib/requisite-format'
import { DRAG_NEW_COURSE } from '../hooks'
import { displayState, fmt, progressText, STATE_LABEL } from './format'
import { ProgressBar, StateIcon } from './parts'

export interface TreeContext {
  termId: string
  termName: string
  offered(id: string): boolean
  title(id: string): string | undefined
  units(id: string): number | null
  node(nodeId: number): ReqNode | null
  catalog: CatalogIndex | null
  /** Courses already in the plan or record (not suggested again). */
  inPlan: Set<string>
  onAddCourse?(courseId: string, nodeId: number): void
  termLabel(term: string): string
  /** Where a course links (its course page in the semester it's planned for, …). */
  href(courseId: string, term?: string | null): string
  /** Beside the semesters: unplanned courses can be dragged onto one. */
  dragCourses?: boolean
}

/** Drag props for a course that isn't in the plan yet (dropping it on a semester adds it there). */
function dragNew(id: string, ctx: TreeContext) {
  if (!ctx.dragCourses) return {}
  return {
    draggable: true,
    title: `Drag ${codeOf(id)} onto a semester to add it`,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_NEW_COURSE, id)
      e.dataTransfer.setData('text/plain', codeOf(id))
      e.dataTransfer.effectAllowed = 'copy'
    },
  }
}


/** A requirement's children, with unneeded alternatives tucked behind a toggle. */
export function RequirementList({ results, ctx, depth }: { results: RequirementResult[]; ctx: TreeContext; depth: number }) {
  const [showOthers, setShowOthers] = useState(false)
  const visible = results.filter((r) => !r.skipped)
  const skipped = results.filter((r) => r.skipped)
  return (
    <ul className="flex flex-col">
      {visible.map((r) => (
        <RequirementRow key={r.nodeId} r={r} ctx={ctx} depth={depth} />
      ))}
      {skipped.length ? (
        <li>
          <button
            type="button"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-md px-1 text-[13px] text-muted hover:text-ink md:min-h-7"
          >
            <ChevronRight aria-hidden className={`size-3.5 transition-transform ${showOthers ? 'rotate-90' : ''}`} />
            {showOthers ? 'Hide' : 'Show'} {skipped.length} other option{skipped.length === 1 ? '' : 's'} not needed
          </button>
          {showOthers ? (
            <ul className="flex flex-col opacity-75">
              {skipped.map((r) => (
                <RequirementRow key={r.nodeId} r={r} ctx={ctx} depth={depth} />
              ))}
            </ul>
          ) : null}
        </li>
      ) : null}
    </ul>
  )
}

function RequirementRow({ r, ctx, depth }: { r: RequirementResult; ctx: TreeContext; depth: number }) {
  const state = displayState(r)
  const node = ctx.node(r.nodeId)
  const isGroup = r.kind === 'group' || r.children.length > 0
  const done = state === 'complete' || state === 'complete-with-plan'
  const [open, setOpen] = useState(() => !done && state !== 'skipped' && depth < 3)
  const childrenId = useId()

  if (r.kind === 'course' && r.courseId) return <CourseLeafRow r={r} ctx={ctx} />

  const target = node ? describeTarget(node) : null
  const needsWork = !done && state !== 'manual' && state !== 'skipped'

  return (
    <li id={`req-${r.nodeId}`} className="border-t border-line first:border-t-0">
      <div className="flex items-start gap-2 py-2">
        {isGroup ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${r.name}`}
            onClick={() => setOpen((v) => !v)}
            className="-my-1 -ml-1 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:size-7"
          >
            <ChevronRight aria-hidden className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : null}
        <StateIcon state={state} className={`mt-0.5 size-4 ${isGroup ? '' : 'ml-0'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={`text-[14px] leading-snug font-medium ${state === 'skipped' ? 'text-muted' : 'text-ink'}`}>{r.name}</span>
            <span className="sr-only">{STATE_LABEL[state]}</span>
            {target ? <span className="text-[12.5px] text-muted">{target}</span> : null}
          </div>

          {r.units ? <Progress p={r.units} unit="units" name={r.name} /> : r.courses && r.courses.need > 1 ? <Progress p={r.courses} unit="courses" name={r.name} /> : null}

          {r.assigned.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {r.assigned.map((a, i) => (
                <li key={`${a.courseId}-${i}`}>
                  <AssignedChip a={a} ctx={ctx} />
                </li>
              ))}
            </ul>
          ) : null}

          {state === 'manual' ? <p className="mt-1 text-[12.5px] text-muted">Your advisor or the registrar confirms this one.</p> : null}

          {needsWork && r.kind === 'pool' && node ? <WaysToSatisfy node={node} ctx={ctx} /> : null}

          {r.notes.length ? <Notes notes={r.notes} /> : null}
        </div>
      </div>
      {isGroup && open ? (
        <div id={childrenId} className="mb-1 ml-[15px] border-l border-line pl-3 md:ml-[13px]">
          <RequirementList results={r.children} ctx={ctx} depth={depth + 1} />
        </div>
      ) : null}
    </li>
  )
}

function Progress({ p, unit, name }: { p: { have: number; planned: number; need: number }; unit: 'units' | 'courses'; name: string }) {
  return (
    <div className="mt-1.5 flex max-w-[420px] items-center gap-2">
      <ProgressBar have={p.have} planned={p.planned} need={p.need} label={`${name} progress`} className="flex-1" />
      <span className="shrink-0 text-[12px] text-muted tabular-nums">{progressText(p, unit)}</span>
    </div>
  )
}

function statusText(a: RequirementResult['assigned'][number], ctx: TreeContext): string {
  if (a.status === 'credit') return 'Credit'
  const when = a.term ? ctx.termLabel(a.term) : ''
  if (a.status === 'completed') return when || 'Taken'
  if (a.status === 'in-progress') return when ? `${when}, in progress` : 'In progress'
  return when ? `${when}, planned` : 'Planned'
}

function AssignedChip({ a, ctx }: { a: RequirementResult['assigned'][number]; ctx: TreeContext }) {
  const done = a.status === 'completed' || a.status === 'credit'
  const title = ctx.title(a.courseId)
  return (
    <Link
      to={ctx.href(a.courseId, a.term)}
      aria-label={title ? `${codeOf(a.courseId)} ${title}` : codeOf(a.courseId)}
      {...coursePreview(a.courseId)}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors md:min-h-7 ${
        done
          ? 'border-[color-mix(in_oklab,var(--ok)_45%,transparent)] bg-[color-mix(in_oklab,var(--ok)_8%,var(--surface))] text-ink hover:border-ok'
          : 'border-dashed border-line-strong bg-surface text-ink hover:border-ink-2'
      }`}
    >
      <span className="course-code text-[13.5px] leading-none">{codeOf(a.courseId)}</span>
      <span className="text-muted">{statusText(a, ctx)}</span>
      {a.units ? <span className="text-muted tabular-nums">{fmt(a.units)}u</span> : null}
    </Link>
  )
}

function CourseLeafRow({ r, ctx }: { r: RequirementResult; ctx: TreeContext }) {
  const state = displayState(r)
  const id = r.courseId!
  const title = ctx.title(id)
  const a = r.assigned[0]
  const counted = a && a.courseId !== id ? a.courseId : null
  const done = state === 'complete' || state === 'complete-with-plan'
  const canDrag = !a && !done && state !== 'skipped' && !ctx.inPlan.has(id)
  return (
    <li
      id={`req-${r.nodeId}`}
      className={`flex min-h-10 items-center gap-2 border-t border-line py-1.5 first:border-t-0 md:min-h-9 ${canDrag && ctx.dragCourses ? 'cursor-grab' : ''}`}
      {...coursePreview(id)}
      {...(canDrag ? dragNew(id, ctx) : {})}
    >
      <StateIcon state={state} className="size-4" />
      <span className="sr-only">{STATE_LABEL[state]}</span>
      {/* In a draggable row the link mustn't start its own (browser) drag: the row's drag adds the course. */}
      <Link to={ctx.href(id, a?.term)} draggable={canDrag && ctx.dragCourses ? false : undefined} className="course-code shrink-0 text-[14.5px] text-ink hover:text-accent">
        {codeOf(id)}
      </Link>
      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${state === 'skipped' ? 'text-muted' : 'text-ink-2'}`}>
        {title ?? ''}
        {counted ? <span className="text-muted"> (as {codeOf(counted)})</span> : null}
      </span>
      {a ? (
        <span className="shrink-0 text-[12.5px] text-muted">{statusText(a, ctx)}</span>
      ) : !done && state !== 'skipped' && ctx.onAddCourse && !ctx.inPlan.has(id) ? (
        <AddButton id={id} nodeId={r.nodeId} ctx={ctx} />
      ) : !ctx.offered(id) && !done ? (
        <span className="shrink-0 text-[12px] text-muted">Not offered in {ctx.termName}</span>
      ) : null}
      {r.notes.length ? <NotesIcon notes={r.notes} /> : null}
    </li>
  )
}

function AddButton({ id, nodeId, ctx }: { id: string; nodeId: number; ctx: TreeContext }) {
  return (
    <button
      type="button"
      onClick={() => ctx.onAddCourse?.(id, nodeId)}
      aria-label={`Add ${codeOf(id)} to your plan`}
      title={ctx.offered(id) ? `Add ${codeOf(id)} to your plan` : `Add ${codeOf(id)} (not offered in ${ctx.termName})`}
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] font-medium text-ink hover:border-ink-2 md:h-7"
    >
      <Plus aria-hidden className="size-3.5" />
      Add
    </button>
  )
}

const OPTIONS_SHOWN = 8

function WaysToSatisfy({ node, ctx }: { node: ReqNode; ctx: TreeContext }) {
  const [all, setAll] = useState(false)
  const options = useMemo(() => {
    if (!ctx.catalog) return []
    return courseOptions(node, ctx.catalog, 120)
      .filter((id) => !ctx.inPlan.has(id))
      .sort((a, b) => Number(ctx.offered(b)) - Number(ctx.offered(a)) || a.localeCompare(b))
  }, [node, ctx])
  if (!options.length) return null
  const shown = all ? options : options.slice(0, OPTIONS_SHOWN)
  const offeredCount = options.filter((id) => ctx.offered(id)).length
  return (
    <div className="mt-2">
      <p className="text-[12.5px] text-muted">
        Ways to satisfy{offeredCount ? `, ${offeredCount} offered in ${ctx.termName}` : ''}
      </p>
      <ul className="mt-1 flex flex-col">
        {shown.map((id) => (
          <li key={id} className={`flex min-h-10 items-center gap-2 md:min-h-8 ${ctx.dragCourses ? 'cursor-grab' : ''}`} {...coursePreview(id)} {...dragNew(id, ctx)}>
            <Link
              to={ctx.href(id)}
              draggable={ctx.dragCourses ? false : undefined}
              className={`course-code shrink-0 text-[13.5px] hover:text-accent ${ctx.offered(id) ? 'text-ink' : 'text-muted'}`}
            >
              {codeOf(id)}
            </Link>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {ctx.title(id)}
            </span>
            {ctx.units(id) !== null ? <span className="shrink-0 text-[12px] text-muted tabular-nums">{fmt(ctx.units(id)!)}u</span> : null}
            {ctx.onAddCourse ? <AddButton id={id} nodeId={node.id} ctx={ctx} /> : null}
          </li>
        ))}
      </ul>
      {options.length > OPTIONS_SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 min-h-9 text-[12.5px] font-medium text-ink-2 underline-offset-2 hover:underline md:min-h-7">
          {all ? 'Show fewer' : `Show ${options.length - OPTIONS_SHOWN} more${options.length >= 120 ? '+' : ''}`}
        </button>
      ) : null}
    </div>
  )
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <details className="mt-1.5 text-[12.5px] text-muted">
      <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1 select-none hover:text-ink md:min-h-6">
        <Info aria-hidden className="size-3.5" />
        {notes.length === 1 ? '1 rule not checked here' : `${notes.length} rules not checked here`}
      </summary>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
        {notes.map((n) => (
          <li key={n} className="whitespace-pre-line">
            {n}
          </li>
        ))}
      </ul>
    </details>
  )
}

function NotesIcon({ notes }: { notes: string[] }) {
  return (
    <span title={notes.join('\n')} aria-label={notes.join('. ')} className="grid size-7 shrink-0 place-items-center text-muted">
      <Info aria-hidden className="size-3.5" />
    </span>
  )
}

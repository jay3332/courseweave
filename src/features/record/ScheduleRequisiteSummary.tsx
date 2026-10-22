import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useCatalogIndex } from '../../lib/catalog'
import { checkCourse, type CourseCheck, type RequisiteContext } from '../../lib/requisites'
import { useRecord } from '../../state/record'
import { useRequisiteContext } from './context'
import { summarizeCheck } from './check-summary'
import { RequisiteStatus } from './RequisiteStatus'

interface Props {
  /** Courses in the schedule (ResolvedEntry works as-is). */
  entries: ReadonlyArray<{ course: { id: string; code: string } }>
  termId: string
  /** Custom context (degree planner); defaults to record + active schedule. */
  context?: RequisiteContext
  className?: string
}

/**
 * Planner sidebar block: how many scheduled courses have unmet requisites, with a list to expand.
 * Renders a quiet "all met" line when there's nothing to fix.
 */
export function ScheduleRequisiteSummary({ entries, termId, context, className = '' }: Props) {
  const own = useRequisiteContext(termId)
  const catalog = useCatalogIndex()
  const recordSize = useRecord((s) => s.entries.length)
  const [open, setOpen] = useState(true)
  const ctx = context ?? own.ctx
  const index = catalog.status === 'ready' ? catalog.value : null

  const rows = useMemo(() => {
    if (!ctx || !index) return []
    const out: { code: string; check: CourseCheck; text: string; level: string }[] = []
    for (const { course } of entries) {
      const entry = index.courses[course.id]
      const check = checkCourse(course.id, entry, ctx)
      const summary = summarizeCheck(check, entry)
      if (summary.level === 'problem' || check.issues.some((i) => i.severity === 'warning')) out.push({ code: course.code, check, text: summary.text, level: summary.level })
    }
    return out
  }, [ctx, index, entries])

  if (!entries.length) return null
  if (catalog.status === 'error') return <p className={`text-[13px] text-muted ${className}`}>Requisites unavailable: {catalog.error}</p>
  if (!ctx || !index) return <p className={`min-h-9 text-[13px] text-muted ${className}`}>Checking requisites…</p>

  const problems = rows.filter((r) => r.level === 'problem').length
  if (!rows.length) {
    return (
      <p className={`flex min-h-9 items-center gap-2 text-[13.5px] text-ink-2 ${className}`}>
        <Check aria-hidden className="size-4 shrink-0 text-ok" />
        {recordSize ? 'Requisites look good for every course' : 'No requisite problems found'}
      </p>
    )
  }

  const heading = problems
    ? `${problems} ${problems === 1 ? 'course needs' : 'courses need'} requisites`
    : `${rows.length} ${rows.length === 1 ? 'course' : 'courses'} to double-check`

  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`} aria-label="Requisite check">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[14px] font-semibold text-ink"
      >
        <AlertTriangle aria-hidden className={`size-4 shrink-0 ${problems ? 'text-danger' : 'text-warn'}`} />
        <span className="min-w-0 flex-1">{heading}</span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-line px-3 pt-2 pb-3">
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.check.courseId} className="flex min-w-0 flex-col gap-0.5">
                <span className="course-code text-[14px] text-ink">{r.code}</span>
                <RequisiteStatus courseId={r.check.courseId} termId={termId} context={context} />
              </li>
            ))}
          </ul>
          {recordSize === 0 ? (
            <p className="text-[12.5px] text-muted">
              Courses you've already taken count toward prerequisites.{' '}
              <Link to={`/${termId}/record`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
                Add them to your record
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

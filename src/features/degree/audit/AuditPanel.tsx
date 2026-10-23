import { coursePreview } from '../../../components/CoursePreview'
import { ListChecks } from 'lucide-react'
import { isGeneralCredit } from '../../../lib/plan'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Spinner } from '../../../components/ui'
import type { CatalogIndex } from '../../../lib/catalog-types'
import type { ProgramVersion, ReqNode } from '../../../lib/degree-types'
import type { AuditInput, ProgramAuditResult } from '../../../lib/plan-types'
import { useAuditData } from '../../../lib/programs'
import { codeOf } from '../../../lib/requisite-format'
import { termLabel as defaultTermLabel } from '../../../lib/requisites'
import { useTerm } from '../../../state/term'
import { useCourseHref } from '../hooks'
import { displayState, fmt } from './format'
import { ProgressBar, StateBadge } from './parts'
import { RequirementList, type TreeContext } from './RequirementTree'

export { ProgramPicker } from './ProgramPicker'

export interface AuditPanelProps {
  input: AuditInput
  /** Called with a suggested course and the requirement it would satisfy. Omit to hide "Add" buttons. */
  onAddCourse?(courseId: string, nodeId: number): void
  /** Formats term codes ("F25" → "Fall 2025"). */
  termLabel?(term: string): string
  /** Beside the semesters: unplanned courses can be dragged onto one. */
  dragCourses?: boolean
}

/** Degree audit: per program, overall progress and the requirement tree with what's left. */
export function AuditPanel({ input, onAddCourse, termLabel = defaultTermLabel, dragCourses = false }: AuditPanelProps) {
  const term = useTerm()
  const data = useAuditData(input)
  const href = useCourseHref()

  if (!input.programs.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
        <ListChecks aria-hidden className="size-6 text-muted" />
        <p className="text-[14px] font-medium text-ink">Pick a major to check requirements</p>
        <p className="max-w-[40ch] text-[13px] text-muted">The audit shows which requirements your courses cover and suggests courses for the rest.</p>
      </div>
    )
  }
  if (data.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-6 text-[13.5px] text-muted">
        <Spinner label="Checking requirements" />
        Checking requirements
      </div>
    )
  }
  if (data.status === 'error') {
    return <p className="rounded-lg border border-line-strong bg-surface px-4 py-3 text-[13.5px] text-danger">{data.error}</p>
  }

  const { result, versions, catalog } = data.value
  const inPlan = new Set(input.courses.map((c) => c.courseId))
  const selected = result.programs.filter((p) => p.attachedTo === undefined)
  const attachedTo = (catalogId: number) => result.programs.filter((p) => p.attachedTo === catalogId)
  const freeUnits = input.courses.filter((c) => result.unassigned.includes(c.courseId)).reduce((n, c) => n + c.units, 0)

  const shared = { termId: term.meta.id, termName: term.meta.name, catalog, inPlan, onAddCourse, termLabel, href, dragCourses }

  return (
    <div className="flex flex-col gap-6">
      {selected.map((p) => (
        <section key={p.auditId} aria-label={p.name} className="flex flex-col gap-4">
          <ProgramAudit program={p} version={versions.get(p.auditId)} shared={shared} offered={(id) => term.courseById.has(id)} />
          {attachedTo(p.catalogId).map((a) => (
            <div key={a.auditId} className="rounded-xl border border-line bg-surface-2 p-3 md:p-4">
              <p className="mb-2 text-[12.5px] text-muted">Required with {p.name}</p>
              <ProgramAudit program={a} version={versions.get(a.auditId)} shared={shared} offered={(id) => term.courseById.has(id)} nested />
            </div>
          ))}
        </section>
      ))}

      {result.unassigned.length ? (
        <section aria-labelledby="audit-free" className="border-t border-line pt-4">
          <h3 id="audit-free" className="text-[14px] font-semibold text-ink">
            Free electives
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {fmt(freeUnits)} units that don't count toward a specific requirement. They still count toward your degree's unit total.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {result.unassigned.map((id) =>
              isGeneralCredit(id) ? (
                <li key={id}>
                  <span className="inline-flex min-h-9 items-center rounded-md border border-dashed border-line-strong bg-surface px-2 text-[13px] text-ink-2 md:min-h-7">
                    {input.courses.find((c) => c.courseId === id)?.source ?? 'Transfer credit'}, {fmt(input.courses.find((c) => c.courseId === id)?.units ?? 0)} units
                  </span>
                </li>
              ) : (
              <li key={id}>
                <Link
                  to={href(id, input.courses.find((c) => c.courseId === id)?.term)}
                  aria-label={catalog?.courses[id]?.title ? `${codeOf(id)} ${catalog.courses[id].title}` : codeOf(id)}
                  {...coursePreview(id)}
                  className="course-code inline-flex min-h-9 items-center rounded-md border border-line-strong bg-surface px-2 text-[13.5px] text-ink hover:border-ink-2 md:min-h-7"
                >
                  {codeOf(id)}
                </Link>
              </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

interface Shared {
  termId: string
  termName: string
  catalog: CatalogIndex | null
  inPlan: Set<string>
  onAddCourse?(courseId: string, nodeId: number): void
  termLabel(term: string): string
  href(courseId: string, term?: string | null): string
  dragCourses: boolean
}

function indexNodes(root: ReqNode | undefined): Map<number, ReqNode> {
  const out = new Map<number, ReqNode>()
  const walk = (n: ReqNode) => {
    out.set(n.id, n)
    n.children.forEach(walk)
  }
  if (root) walk(root)
  return out
}

function ProgramAudit({
  program,
  version,
  shared,
  offered,
  nested = false,
}: {
  program: ProgramAuditResult
  version: ProgramVersion | undefined
  shared: Shared
  offered(id: string): boolean
  nested?: boolean
}) {
  const nodes = useMemo(() => indexNodes(version?.root), [version])
  const ctx: TreeContext = useMemo(
    () => ({
      ...shared,
      offered,
      title: (id) => shared.catalog?.courses[id]?.title,
      units: (id) => shared.catalog?.courses[id]?.units ?? null,
      node: (id) => nodes.get(id) ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, shared.catalog, shared.inPlan, shared.onAddCourse, shared.termId, shared.href, shared.dragCourses],
  )

  const areas = program.root.children.filter((c) => !c.skipped && !c.manual)
  const areasDone = areas.filter((c) => c.state === 'complete').length
  const areasPlanned = areas.filter((c) => c.state === 'complete-with-plan').length
  const state = displayState({ state: program.state })

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className={nested ? 'text-[15px] font-semibold text-ink' : 'display text-[22px] text-ink'}>{program.programName ?? program.name}</h3>
          <StateBadge state={state} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-muted">
          {program.versionName ? <span>{program.versionName} requirements</span> : null}
          {areas.length ? (
            <span>
              {areasDone} of {areas.length} areas done{areasPlanned ? `, ${areasPlanned} more planned` : ''}
            </span>
          ) : null}
          {program.manualCount ? (
            <span>
              {program.manualCount} {program.manualCount === 1 ? 'item needs' : 'items need'} an advisor's check
            </span>
          ) : null}
        </div>
        {program.totalUnits ? (
          <div className="flex max-w-[520px] items-center gap-2">
            <ProgressBar have={program.totalUnits.have} planned={program.totalUnits.planned} need={program.totalUnits.need} label="Degree units" className="h-2 flex-1" />
            <span className="shrink-0 text-[12.5px] text-ink-2 tabular-nums">
              {fmt(program.totalUnits.have)}
              {program.totalUnits.planned ? ` + ${fmt(program.totalUnits.planned)} planned` : ''} of {fmt(program.totalUnits.need)} units
            </span>
          </div>
        ) : null}
      </header>
      {version ? (
        <RequirementList results={program.root.children.length ? program.root.children : [program.root]} ctx={ctx} depth={0} />
      ) : (
        <p className="text-[13px] text-muted">Requirements for this program version couldn't be loaded.</p>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { Link } from 'react-router'
import { Spinner } from '../../components/ui'
import { useCatalogIndex } from '../../lib/catalog'
import { useAuditVersions } from '../../lib/programs'
import { requirementsForCourse, type CourseRequirementMatch } from '../../lib/requirement-match'
import { usePlans } from '../../state/plan'
import { reqParam } from './filters'

const NO_PROGRAMS: never[] = []

/** Which requirements of the active degree plan (and its gen-eds) a course can count toward. */
export function CountsToward({ courseId, termId }: { courseId: string; termId: string }) {
  const plan = usePlans((s) => (s.activePlanId ? (s.plans[s.activePlanId] ?? null) : null))
  const programs = plan?.programs ?? NO_PROGRAMS
  const versions = useAuditVersions(programs)
  const catalog = useCatalogIndex()

  const matches = useMemo(() => {
    if (versions.status !== 'ready' || catalog.status === 'loading') return null
    return requirementsForCourse(versions.value.values(), courseId, catalog.status === 'ready' ? catalog.value : null, {
      term: termId,
      programIds: programs.map((p) => p.catalogId),
    })
  }, [versions, catalog, courseId, termId, programs])

  const heading = (
    <h2 id="detail-counts" className="display mb-2 text-[17px]">
      Counts toward
    </h2>
  )

  if (!plan || !programs.length) {
    return (
      <section aria-labelledby="detail-counts">
        {heading}
        <p className="text-[13px] text-muted">
          <Link to={`/${termId}/plan`} className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
            {plan ? 'Pick your major in your degree plan' : 'Start a degree plan'}
          </Link>{' '}
          to see which requirements this course can count toward.
        </p>
      </section>
    )
  }

  if (versions.status === 'error') return null

  // Group by program, keeping the plan's order.
  const groups = new Map<number, { program: string; items: CourseRequirementMatch[] }>()
  for (const m of matches ?? []) {
    const g = groups.get(m.auditId) ?? { program: m.programName, items: [] }
    g.items.push(m)
    groups.set(m.auditId, g)
  }

  return (
    <section aria-labelledby="detail-counts">
      {heading}
      {matches === null ? (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner label="Checking requirements" /> Checking your programs’ requirements
        </span>
      ) : !matches.length ? (
        <p className="text-[13px] text-muted">No specific requirement in {plan.name}’s programs. It can still count toward your unit total as a free elective.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {[...groups.entries()].map(([auditId, g]) => (
            <div key={auditId}>
              <p className="mb-1 text-[12.5px] text-muted">{g.program}</p>
              <ul className="flex flex-col gap-1">
                {g.items.map((m) => (
                  <li key={m.nodeId}>
                    <Link
                      to={`/${termId}/courses?req=${reqParam({ auditId: m.auditId, nodeId: m.filterNodeId })}`}
                      title="Show courses that count toward this"
                      className="group flex min-h-9 items-baseline gap-2 rounded-md px-2 py-1 hover:bg-surface-2 md:min-h-0"
                    >
                      <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
                        {m.path.length ? <span className="text-muted">{m.path.join(' › ')} › </span> : null}
                        <span className="text-ink underline decoration-line-strong underline-offset-2 group-hover:decoration-accent">{m.name}</span>
                      </span>
                      {m.target ? <span className="shrink-0 text-[12px] text-muted">{m.target}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

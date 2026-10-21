import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Spinner } from '../../components/ui'
import { buildUnlocks, prerequisiteDepth, useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { parseCourseCode } from '../../lib/data'
import { codeOf } from '../../lib/requisite-format'
import { formatUnits } from '../../lib/time'
import { useTerm } from '../../state/term'
import { useChipContext, type ChipContext } from './chip-context'
import { CourseChip } from './CourseChip'
import { RequisiteSearch } from './RequisiteSearch'
import { ReqNode } from './RequiresTree'
import { UnlocksList } from './UnlocksList'

/**
 * Requisite explorer: a course's prerequisite tree (what it needs) and the courses it unlocks.
 * Every course link re-centers the explorer, so you can walk the graph in either direction.
 */
export function RequisitesPage() {
  const term = useTerm()
  const termId = term.meta.id
  const { courseCode } = useParams()
  const navigate = useNavigate()
  const index = useCatalogIndex()
  const id = courseCode ? parseCourseCode(courseCode) : null
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [id])

  const ready = index.status === 'ready' ? index.value : null
  // Don't pop the on-screen keyboard on phones.
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  const explore = (courseId: string) => navigate(`/${termId}/requisites/${codeOf(courseId)}`)

  return (
    <div ref={scrollRef} className="h-full overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-5 pb-12 md:px-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
          <div>
            <h1 className="display text-[28px] text-ink">Requisites</h1>
            <p className="mt-1 max-w-[60ch] text-[14px] text-ink-2">See what a course requires, and which courses it opens up. Select any course to follow the chain.</p>
          </div>
          <div className="w-full md:w-[380px]">
            <RequisiteSearch index={ready} onPick={explore} autoFocus={!id && wide} />
          </div>
        </header>

        {index.status === 'loading' ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner label="Loading the course catalog" />
          </div>
        ) : index.status === 'error' ? (
          <p className="text-[14px] text-danger">{index.error}</p>
        ) : id ? (
          <Explorer id={id} index={index.value} />
        ) : (
          <Gateways index={index.value} />
        )}
      </div>
    </div>
  )
}

function Explorer({ id, index }: { id: string; index: CatalogIndex }) {
  const term = useTerm()
  const termId = term.meta.id
  const recenter = useMemo(() => (courseId: string) => `/${termId}/requisites/${codeOf(courseId)}`, [termId])
  const ctx = useChipContext(undefined, recenter)
  const [expandAll, setExpandAll] = useState(false)

  const entry = index.courses[id]
  const offered = term.courseById.get(id)
  const unlocks = useMemo(() => buildUnlocks(index).get(id) ?? [], [index, id])
  const depth = useMemo(() => prerequisiteDepth(index, id), [index, id])
  const title = offered?.title ?? entry?.title

  if (!title) {
    return (
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="display text-[20px]">No course {codeOf(id)}</h2>
        <p className="mt-1 text-[14px] text-ink-2">
          It isn’t in the catalog or this term’s schedule. Search for another course above, or{' '}
          <Link to={`/${termId}/requisites`} className="underline decoration-line-strong underline-offset-2 hover:decoration-accent">
            start from the most common gateway courses
          </Link>
          .
        </p>
      </div>
    )
  }

  const units = offered?.units ?? entry?.units ?? null
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 md:flex-row md:items-end md:justify-between md:p-5">
        <div className="min-w-0">
          <div className="course-code text-[40px] leading-none text-ink">{codeOf(id)}</div>
          <h2 className="display mt-1 text-[22px] text-ink">{title}</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            {units === null ? 'Variable units' : `${formatUnits(units)} units`}
            {entry?.passFail ? ', pass/fail only' : ''}
          </p>
          <p className="mt-2 text-[13.5px]">
            {offered ? (
              <Link to={`/${termId}/courses/${codeOf(id)}`} className="inline-flex min-h-9 items-center font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent md:min-h-0">
                View sections in {term.meta.name}
              </Link>
            ) : (
              <span className="text-muted">Not offered in {term.meta.name}</span>
            )}
          </p>
        </div>
        <dl className="flex shrink-0 gap-8 text-[13px] md:text-right">
          <div>
            <dt className="text-muted">Prerequisite chain</dt>
            <dd className="display text-[26px] text-ink" title="Courses in the shortest chain of prerequisites below this one">
              {depth === 0 ? 'None' : `${depth} deep`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Unlocks</dt>
            <dd className="display text-[26px] text-ink">{unlocks.length}</dd>
          </div>
        </dl>
      </section>

      <div className="grid min-w-0 gap-5 md:grid-cols-2 md:gap-6">
        <section aria-labelledby="requires-heading" className="min-w-0 rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 id="requires-heading" className="display text-[18px]">
              Requires
            </h3>
            {entry?.prereqs ? (
              <button
                type="button"
                aria-pressed={expandAll}
                onClick={() => setExpandAll(!expandAll)}
                className="min-h-9 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:min-h-7"
              >
                {expandAll ? 'Collapse all' : 'Expand all'}
              </button>
            ) : null}
          </div>
          {entry?.prereqs ? (
            <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
              <ul key={String(expandAll)} className="min-w-fit">
                <ReqNode req={entry.prereqs} index={index} ctx={ctx} path={[id]} depth={0} expandAll={expandAll} />
              </ul>
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">{entry ? 'No prerequisites listed.' : 'The catalog has no requisite data for this course.'}</p>
          )}
          {entry?.coreqs.length ? <CoreqList ids={entry.coreqs} ctx={ctx} /> : null}
          {entry?.antireqs.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <h4 className="text-[13px] font-semibold text-ink">Can’t also get credit for</h4>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {entry.antireqs.map((a) => (
                  <CourseChip key={a} id={a} ctx={ctx} />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="unlocks-heading" className="min-w-0 rounded-lg border border-line bg-surface p-4">
          <h3 id="unlocks-heading" className="display mb-2 text-[18px]">
            Unlocks
          </h3>
          <UnlocksList unlocks={unlocks} ctx={ctx} />
        </section>
      </div>
    </div>
  )
}

function CoreqList({ ids, ctx }: { ids: string[]; ctx: ChipContext }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h4 className="text-[13px] font-semibold text-ink">Corequisites</h4>
      <p className="text-[12.5px] text-muted">{ids.length > 1 ? 'One of these, before or in the same semester' : 'Before or in the same semester'}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {ids.map((c, i) => (
          <span key={c} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-[12.5px] text-muted">or</span> : null}
            <CourseChip id={c} ctx={ctx} />
          </span>
        ))}
      </div>
    </div>
  )
}

/** Empty state: the courses that unlock the most others, as starting points. */
function Gateways({ index }: { index: CatalogIndex }) {
  const term = useTerm()
  const termId = term.meta.id
  const recenter = useMemo(() => (courseId: string) => `/${termId}/requisites/${codeOf(courseId)}`, [termId])
  const ctx = useChipContext(undefined, recenter)
  const top = useMemo(() => {
    const unlocks = buildUnlocks(index)
    return [...unlocks]
      .filter(([cid]) => index.courses[cid])
      .map(([cid, list]) => ({ id: cid, count: list.length, required: list.filter((u) => u.required).length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 18)
  }, [index])

  return (
    <section aria-labelledby="gateways-heading" className="min-w-0">
      <h2 id="gateways-heading" className="display text-[20px]">
        Gateway courses
      </h2>
      <p className="mt-1 mb-3 text-[13.5px] text-ink-2">The courses that the most other courses list as a requisite.</p>
      <ul className="grid min-w-0 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {top.map((g) => (
          <li key={g.id} className="flex min-w-0 items-center gap-2 border-t border-line py-1.5">
            <CourseChip id={g.id} ctx={ctx} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{ctx.title(g.id)}</span>
            <span className="shrink-0 text-[12.5px] text-muted" title={`${g.required} of these require it outright`}>
              {g.count} courses
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

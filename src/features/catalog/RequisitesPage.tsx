import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Spinner } from '../../components/ui'
import { buildUnlocks, prerequisiteDepth, useCatalogIndex } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import { parseCourseCode } from '../../lib/data'
import { codeOf } from '../../lib/requisite-format'
import { formatUnits } from '../../lib/time'
import { useTerm } from '../../state/term'
import { useChipContext } from './chip-context'
import { CourseChip } from './CourseChip'
import { RequisiteSearch } from './RequisiteSearch'
import { RequiresAndUnlocks } from './RequiresAndUnlocks'

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
            {/* Reached from a course's page (Courses), so the way back leads there. */}
            <Link
              to={id && term.courseById.has(id) ? `/${termId}/courses/${codeOf(id)}` : `/${termId}/courses`}
              className="mb-1 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink md:min-h-0"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Courses
            </Link>
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

      <RequiresAndUnlocks id={id} index={index} ctx={ctx} unlocks={unlocks} />
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

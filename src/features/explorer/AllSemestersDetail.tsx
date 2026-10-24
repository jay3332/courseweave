import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { departmentName } from '../../lib/departments'
import { nearestTerm } from '../../lib/offerings'
import { termLabel, termOrdinal } from '../../lib/requisites'
import { formatUnits } from '../../lib/time'
import type { Course } from '../../lib/types'
import { useTerm, useTerms } from '../../state/term'
import { CourseAbout } from '../catalog/CourseAbout'
import { CourseSyllabi } from '../catalog/CourseSyllabi'
import { CourseFcePanel } from '../fce/CourseFcePanel'
import { statusFnFor } from '../record/check-summary'
import { useRequisiteContext } from '../record/context'
import { RequisiteStatus } from '../record/RequisiteStatus'
import { CountsToward } from './CountsToward'

/**
 * A course in the all-semesters view: what doesn't depend on a semester (description, requisites, requirements,
 * FCEs) and the semesters that offer it, which link to its sections there.
 */
export function AllSemestersDetail({ course, terms, closeHref, search }: { course: Course; terms: string[]; closeHref: string; search: string }) {
  // The semester underneath (the one last visited), for requisite checks and requirement links.
  const term = useTerm()
  const termId = term.meta.id
  const requisites = useRequisiteContext(termId)
  const chipStatus = useMemo(() => (requisites.ctx ? statusFnFor(requisites.ctx, false) : undefined), [requisites.ctx])
  const span = useBuiltSpan()
  const next = nearestTerm(terms, termId)
  const termHref = (t: string) => `/${t}/courses/${course.code}${search}`

  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Units', value: course.units === null ? 'Variable' : formatUnits(course.units) },
    ...(course.dept ? [{ label: 'Department', value: departmentName(course.dept) }] : []),
    { label: 'Level', value: course.level === 'G' ? 'Graduate' : 'Undergraduate' },
    {
      label: 'Offered',
      value: terms.length ? (
        <span className="flex flex-wrap gap-x-3">
          {terms.map((t) => (
            <Link key={t} to={termHref(t)} className="underline decoration-line-strong underline-offset-2 hover:decoration-accent">
              {termLabel(t)}
            </Link>
          ))}
        </span>
      ) : (
        <span className="text-ink-2">Not in any semester here{span ? ` (${span})` : ''}</span>
      ),
    },
  ]

  return (
    <article className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur">
        <Link to={closeHref} className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[14px] font-medium text-ink-2 hover:text-ink md:hidden">
          <ArrowLeft className="size-4" />
          All courses
        </Link>
        <span className="course-code hidden text-[15px] text-muted md:inline">{course.code}</span>
        <Link
          to={closeHref}
          aria-label="Close course details"
          title="Close"
          className="ml-auto hidden size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:inline-grid"
        >
          <X className="size-4" />
        </Link>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-5 pb-10 sm:px-5">
        <header>
          <div className="course-code text-[44px] leading-none text-ink">{course.code}</div>
          <h1 className="display mt-1.5 text-[26px] text-ink">{course.title}</h1>
          <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
          {next ? (
            <Link
              to={termHref(next)}
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-ink hover:brightness-110 md:h-9"
            >
              Sections in {termLabel(next)}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
          <RequisiteStatus courseId={course.id} termId={termId} context={requisites.ctx ?? undefined} className="mt-3" />
        </header>

        <CourseAbout courseId={course.id} status={chipStatus} />

        <CountsToward courseId={course.id} termId={termId} />

        <CourseFcePanel courseId={course.id} units={course.units} currentInstructors={[]} />

        <CourseSyllabi courseId={course.id} code={course.code} />
      </div>
    </article>
  )
}

/** "Fall 2025–Spring 2027": the semesters with schedule data. */
function useBuiltSpan(): string | null {
  const terms = useTerms()
  if (terms.status !== 'ready' || !terms.value.length) return null
  const ids = terms.value.map((t) => t.id).sort((a, b) => (termOrdinal(a) ?? 0) - (termOrdinal(b) ?? 0))
  return `${termLabel(ids[0])}–${termLabel(ids.at(-1)!)}`
}

import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { coursePreview } from '../../components/CoursePreview'
import { Tag } from '../../components/ui'
import { departmentName } from '../../lib/departments'
import { codeOf } from '../../lib/requisite-format'
import { termLabel } from '../../lib/requisites'
import { ALL_SEMESTERS } from '../../state/term-scope'
import { useCourseLookup, type AllInstructor } from './allInstructors'
import { InstructorFce } from './InstructorFce'

/**
 * An instructor across every semester: what they teach in each one (linking to that semester's schedule for them)
 * and their whole FCE history.
 */
export function AllInstructorDetail({ inst }: { inst: AllInstructor }) {
  const lookup = useCourseLookup()
  const links = { title: (id: string) => lookup?.title(id), href: (code: string) => `/${ALL_SEMESTERS}/courses/${code}` }

  return (
    <article className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <header>
        <h1 className="display text-[34px] text-ink sm:text-[40px]">{inst.name}</h1>
        {inst.depts.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Departments">
            {inst.depts.map((d) => (
              <li key={d}>
                <Tag title={d}>{departmentName(d)}</Tag>
              </li>
            ))}
          </ul>
        ) : null}
        {inst.terms.length ? (
          <dl className="mt-5 grid max-w-md grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
            <Stat label="Semesters" value={inst.terms.length} />
            <Stat label="Courses" value={inst.courseIds.length} />
            <Stat label="Sections" value={inst.sectionCount} />
          </dl>
        ) : null}
      </header>

      <section className="mt-9" aria-labelledby="teaching-heading">
        <h2 id="teaching-heading" className="display text-[22px] text-ink">
          Teaching by semester
        </h2>
        {inst.terms.length ? (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {inst.terms.map((t) => (
              <li key={t.term} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex items-baseline justify-between gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0.5">
                  <span className="font-semibold text-ink">{termLabel(t.term)}</span>
                  <Link
                    to={`/${t.term}/instructors/${inst.slug}`}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent"
                  >
                    {t.sections} {t.sections === 1 ? 'section' : 'sections'}, schedule
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </div>
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {t.courses.map((id) => (
                    <li key={id} className="flex min-w-0 items-baseline gap-2 text-[14px]">
                      <Link {...coursePreview(codeOf(id))} to={`/${t.term}/courses/${codeOf(id)}`} className="course-code shrink-0 text-[15px] text-ink hover:text-accent">
                        {codeOf(id)}
                      </Link>
                      <span className="truncate text-ink-2">{lookup?.title(id) ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-ink-2">Not teaching in any semester here. Their course evaluations are below.</p>
        )}
      </section>

      <InstructorFce name={inst.name} links={links} />
    </article>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="display mt-0.5 text-[26px] text-ink tabular-nums">{value}</dd>
    </div>
  )
}

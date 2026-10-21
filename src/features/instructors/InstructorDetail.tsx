import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { WeekGrid, type CalendarBlock } from '../../components/WeekGrid'
import { Tag } from '../../components/ui'
import { isUnscheduled, sectionBlocks, sectionLabel } from '../../lib/blocks'
import { hashColor } from '../../lib/colors'
import { instructorSlug, type Instructor } from '../../lib/data'
import { departmentName } from '../../lib/departments'
import { formatDays, formatLocation, formatTimeRange, formatUnits } from '../../lib/time'
import { useTerm } from '../../state/term'
import { InstructorFce } from './InstructorFce'
import { coInstructors, taughtSections, weeklyHours } from './instructorData'
import { useMediaQuery } from './useMediaQuery'

export function InstructorDetail({ inst }: { inst: Instructor }) {
  const term = useTerm()
  const termId = term.meta.id
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width: 639px)')

  const taught = useMemo(() => taughtSections(inst, term), [inst, term])
  const hours = useMemo(() => weeklyHours(taught.map((t) => t.section), term), [taught, term])
  const partners = useMemo(() => coInstructors(inst, taught), [inst, taught])

  const blocks = useMemo<CalendarBlock[]>(
    () =>
      taught.flatMap(({ course, section }) =>
        sectionBlocks(course, section, hashColor(course.id), {
          onClick: () => navigate(`/${termId}/courses/${course.code}`),
          tooltip: `${course.code} ${section.title ?? course.title}, ${sectionLabel(section)}. Open course`,
        }),
      ),
    [taught, navigate, termId],
  )
  const unscheduled = taught.filter((t) => isUnscheduled(t.section))
  const miniName = (n: number) => term.meta.minis.find((m) => m.number === n)?.name ?? `Mini ${n}`

  return (
    <article className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <header>
        <h1 className="display text-[34px] text-ink sm:text-[40px]">{inst.name}</h1>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Departments">
          {inst.depts.map((d) => (
            <li key={d}>
              <Tag title={d}>{departmentName(d)}</Tag>
            </li>
          ))}
        </ul>
        <dl className="mt-5 grid max-w-md grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
          <Stat label="Courses" value={inst.courseIds.length} />
          <Stat label="Sections" value={inst.sectionCount} />
          <Stat
            label="Class hours a week"
            value={hours ? (Number.isInteger(hours) ? hours : hours.toFixed(1)) : '—'}
            title="Scheduled class time in the busiest week, counting overlapping cross-listed sections once"
          />
        </dl>
      </header>

      <section className="mt-9" aria-labelledby="teaching-heading">
        <h2 id="teaching-heading" className="display text-[22px] text-ink">
          Teaching in {term.meta.name}
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface md:hidden">
          {taught.map(({ course, section }) => {
            const others = section.instructors.filter((n) => n !== inst.name)
            return (
              <li key={`${course.id}-${section.name}`} className="px-3 py-2.5 text-[13.5px]">
                <div className="flex items-baseline gap-2">
                  <Link to={`/${termId}/courses/${course.code}`} className="course-code text-[15px] text-ink hover:text-accent">
                    {course.code}
                  </Link>
                  <span className="text-ink-2">{sectionLabel(section)}</span>
                  {section.mini ? <span className="text-[12px] text-muted">{miniName(section.mini)}</span> : null}
                </div>
                <div className="text-ink">{section.title ?? course.title}</div>
                {section.meetings.map((m, i) => (
                  <div key={i} className="text-[13px] text-ink-2 tabular-nums">
                    {m.days.length ? `${formatDays(m.days)} ${formatTimeRange(m.start, m.end)}` : 'Time TBA'}
                    <span className="text-muted">, {formatLocation(m)}</span>
                  </div>
                ))}
                {others.length ? (
                  <div className="mt-0.5 text-[12.5px] text-muted">
                    With{' '}
                    {others.map((n, i) => (
                      <span key={n}>
                        {i ? ', ' : ''}
                        <Link to={`/${termId}/instructors/${instructorSlug(n)}`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent">
                          {n}
                        </Link>
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        <div className="scrollbar-thin mt-3 hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead className="border-b border-line bg-surface-2 text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Course</th>
                <th scope="col" className="px-3 py-2 font-medium">Title</th>
                <th scope="col" className="px-3 py-2 font-medium">Section</th>
                <th scope="col" className="px-3 py-2 font-medium">Meets</th>
                <th scope="col" className="px-3 py-2 font-medium">Where</th>
                <th scope="col" className="px-3 py-2 font-medium">Co-instructors</th>
              </tr>
            </thead>
            <tbody>
              {taught.map(({ course, section }) => {
                const others = section.instructors.filter((n) => n !== inst.name)
                return (
                  <tr key={`${course.id}-${section.name}`} className="border-b border-line/70 align-top last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/${termId}/courses/${course.code}`} className="course-code text-[15px] text-ink hover:text-accent">
                        {course.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{section.title ?? course.title}</div>
                      {section.title ? <div className="text-[12px] text-muted">{course.title}</div> : null}
                      <div className="text-[12px] text-muted">{formatUnits(course.units)} units</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-ink">{sectionLabel(section)}</div>
                      {section.mini ? <div className="text-[12px] text-muted">{miniName(section.mini)}</div> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {section.meetings.map((m, i) => (
                        <div key={i} className="tabular-nums">
                          {m.days.length ? (
                            <>
                              <span className="inline-block w-12 font-medium">{formatDays(m.days)}</span>
                              {formatTimeRange(m.start, m.end)}
                            </>
                          ) : (
                            <span className="text-muted">TBA</span>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                      {section.meetings.map((m, i) => (
                        <div key={i}>{formatLocation(m)}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2">
                      {others.length ? (
                        <ul className="space-y-0.5">
                          {others.map((n) => (
                            <li key={n}>
                              <Link to={`/${termId}/instructors/${instructorSlug(n)}`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent hover:decoration-accent">
                                {n}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-9" aria-labelledby="week-heading">
        <h2 id="week-heading" className="display text-[22px] text-ink">
          Weekly timetable
        </h2>
        {blocks.length ? (
          <>
            <p className="mt-1 text-[13px] text-muted">Select a class to open the course.</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
              <WeekGrid blocks={blocks} hourHeight={narrow ? 36 : 44} compact={narrow} />
            </div>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-ink-2">None of these sections has a scheduled meeting time yet.</p>
        )}
        {unscheduled.length && blocks.length ? (
          <div className="mt-4">
            <h3 className="text-[14px] font-semibold text-ink">No set meeting time</h3>
            <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
              {unscheduled.map(({ course, section }) => (
                <li key={`${course.id}-${section.name}`} className="text-[13.5px]">
                  <Link to={`/${termId}/courses/${course.code}`} className="course-code text-ink hover:text-accent">
                    {course.code}
                  </Link>{' '}
                  <span className="text-ink-2">{sectionLabel(section)}</span>{' '}
                  <span className="text-muted">{section.title ?? course.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <InstructorFce name={inst.name} />

      {partners.length ? (
        <section className="mt-9" aria-labelledby="with-heading">
          <h2 id="with-heading" className="display text-[22px] text-ink">
            Teaches with
          </h2>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {partners.map((p) => (
              <li key={p.name} className="flex items-baseline justify-between gap-3 border-b border-line/70 py-1.5">
                <Link to={`/${termId}/instructors/${p.slug}`} className="truncate font-medium text-ink hover:text-accent">
                  {p.name}
                </Link>
                <span className="flex shrink-0 gap-2">
                  {p.courseIds.map((id) => {
                    const course = term.courseById.get(id)
                    return course ? (
                      <Link key={id} to={`/${termId}/courses/${course.code}`} className="course-code text-[13px] text-muted hover:text-accent">
                        {course.code}
                      </Link>
                    ) : null
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function Stat({ label, value, title }: { label: string; value: number | string; title?: string }) {
  return (
    <div className="px-4 py-3" title={title}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="display mt-0.5 text-[26px] text-ink tabular-nums">{value}</dd>
    </div>
  )
}

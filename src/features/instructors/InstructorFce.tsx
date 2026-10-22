import { Link } from 'react-router'
import { Spinner } from '../../components/ui'
import { FCE_HOURS_HELP, formatHours, formatRating, termName, useFceAccess, useInstructorFce, weightedMean } from '../../lib/fce'
import { useTerm } from '../../state/term'
import { FceSignIn } from '../fce/FceSignIn'
import { LineChart } from '../fce/LineChart'

const RECENT_TERMS = 4

/** An instructor's FCE history: recent ratings, teaching rating over time, and per-course results. */
export function InstructorFce({ name }: { name: string }) {
  const term = useTerm()
  const fce = useInstructorFce(name)
  const access = useFceAccess()

  return (
    <section className="mt-9" aria-labelledby="evals-heading">
      <h2 id="evals-heading" className="display text-[22px] text-ink">
        Course evaluations
      </h2>
      {access === 'locked' ? (
        <FceSignIn className="mt-3" />
      ) : fce === undefined ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner label="Loading evaluations" /> Loading evaluations
        </div>
      ) : fce === null ? (
        <p className="mt-2 text-[14px] text-ink-2">No FCE history matches {name}. New instructors, and anyone whose name is spelled differently in FCEs, won’t have any.</p>
      ) : (
        <Body fce={fce} termId={term.meta.id} courseById={term.courseById} />
      )}
    </section>
  )
}

function Body({ fce, termId, courseById }: { fce: NonNullable<ReturnType<typeof useInstructorFce>>; termId: string; courseById: ReturnType<typeof useTerm>['courseById'] }) {
  const recent = fce.terms.slice(-RECENT_TERMS)
  const recentRating = weightedMean(recent, (t) => t.teachingRate, (t) => t.responses)
  const responses = fce.terms.reduce((n, t) => n + t.responses, 0)
  const first = fce.terms[0]?.term

  return (
    <>
      <p className="mt-1 text-[13px] text-muted">
        {fce.terms.length} {fce.terms.length === 1 ? 'term' : 'terms'} with responses{first ? ` since ${termName(first)}` : ''}, {responses.toLocaleString()} responses in all
      </p>
      <div className="mt-3 grid gap-5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <dl className="grid grid-cols-2 divide-x divide-line self-start rounded-lg border border-line bg-surface md:grid-cols-1 md:divide-x-0 md:divide-y">
          <div className="px-4 py-3" title={`Overall teaching rating over the last ${RECENT_TERMS} terms with responses, weighted by responses`}>
            <dt className="text-[12px] text-muted">Recent teaching rating</dt>
            <dd className="mt-0.5">
              <span className="display text-[26px] text-ink">{formatRating(recentRating)}</span>
              <span className="ml-1 text-[12px] text-muted">of 5</span>
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-[12px] text-muted">Courses evaluated</dt>
            <dd className="display mt-0.5 text-[26px] text-ink">{fce.courses.length}</dd>
          </div>
        </dl>
        {fce.terms.length >= 2 ? (
          <figure className="min-w-0 rounded-lg border border-line bg-surface px-3 pt-2 pb-1">
            <figcaption className="mb-1 text-[12.5px] font-medium text-ink-2">Teaching rating by term</figcaption>
            <LineChart
              label={`${fce.name}'s overall teaching rating by term`}
              domain={[1, 5]}
              height={150}
              format={(v) => v.toFixed(Number.isInteger(v) ? 0 : 2)}
              points={fce.terms.map((t) => ({
                label: t.term,
                title: termName(t.term),
                value: t.teachingRate === null ? null : Math.round(t.teachingRate * 100) / 100,
                sub: `${t.responses} responses`,
              }))}
            />
          </figure>
        ) : null}
      </div>

      <div className="scrollbar-thin mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line bg-surface-2 text-[12px] text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Course
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                Taught
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Overall teaching rating">
                Teach
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Overall course rating">
                Course
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title={FCE_HOURS_HELP}>
                Hrs
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {fce.courses.map((c) => {
              const course = courseById.get(c.courseId)
              const code = `${c.courseId.slice(0, 2)}-${c.courseId.slice(2)}`
              return (
                <tr key={c.courseId} className="border-b border-line/70 align-top last:border-b-0">
                  <td className="px-3 py-1.5">
                    {course ? (
                      <Link to={`/${termId}/courses/${code}`} className="course-code text-[14px] text-ink hover:text-accent">
                        {code}
                      </Link>
                    ) : (
                      <span className="course-code text-[14px] text-ink-2" title="Not offered this term">
                        {code}
                      </span>
                    )}
                    {course ? <div className="max-w-[16rem] truncate text-[12px] text-muted">{course.title}</div> : null}
                    <div className="text-[12px] text-muted sm:hidden">
                      {c.terms} {c.terms === 1 ? 'term' : 'terms'}, last {c.last}
                    </div>
                  </td>
                  <td className="hidden px-3 py-1.5 whitespace-nowrap text-ink-2 sm:table-cell" title={`${termName(c.first)} to ${termName(c.last)}`}>
                    {c.terms} {c.terms === 1 ? 'term' : 'terms'}, last {c.last}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">{formatRating(c.teachingRate)}</td>
                  <td className="px-3 py-1.5 text-right text-ink">{formatRating(c.courseRate)}</td>
                  <td className="px-3 py-1.5 text-right text-ink">{formatHours(c.hours)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Spinner } from '../../components/ui'
import {
  FCE_HOURS_HELP,
  WORKLOAD_TONE_CLASS,
  WORKLOAD_TONE_LABEL,
  courseIsMini,
  expectedHours,
  fceByTerm,
  formatHours,
  formatRating,
  sameInstructor,
  termName,
  termOrder,
  useCourseFce,
  useFceAccess,
  useFceSummary,
  rowsExpectedHours,
  weightedMean,
  workloadRatio,
  workloadTone,
  type FceRow,
} from '../../lib/fce'
import { displayFceName, fceNameKeys } from '../../lib/fce-names'
import { useTerm } from '../../state/term'
import { FceSignIn } from './FceSignIn'
import { LineChart } from './LineChart'
import { WorkloadMeter } from './WorkloadMeter'

interface CourseFcePanelProps {
  courseId: string
  /** Defaults to the routed term's units for the course. */
  units?: number | null
  /** Defaults to the routed term's instructors for the course; they're marked in the tables. */
  currentInstructors?: string[]
  /** Full-width layout: history by instructor and by term side by side instead of behind a toggle. */
  wide?: boolean
}

/** FCE summary, trends and history for one course. Renders a short note when there's no data. */
export function CourseFcePanel({ courseId, units: unitsProp, currentInstructors: currentProp, wide = false }: CourseFcePanelProps) {
  const term = useTerm()
  const course = term.courseById.get(courseId)
  const units = unitsProp !== undefined ? unitsProp : (course?.units ?? null)
  const current = currentProp ?? course?.instructors ?? []
  const summaryData = useFceSummary()
  const access = useFceAccess()
  const rows = useCourseFce(courseId)
  const summary = summaryData?.courses.get(courseId)

  if (access === 'locked') {
    return (
      <Section>
        <FceSignIn />
      </Section>
    )
  }

  if (summaryData === undefined || rows === undefined) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner label="Loading course evaluations" /> Loading course evaluations
        </div>
      </Section>
    )
  }
  if (summaryData === null) {
    return (
      <Section>
        <p className="text-[13.5px] text-ink-2">Course evaluation data isn’t available in this build. Run npm run data with access to the FCE export.</p>
      </Section>
    )
  }
  if (!rows.length || !summary) {
    return (
      <Section>
        <p className="text-[13.5px] text-ink-2">No FCEs for this course number yet. New courses and courses whose instructors opted out have none.</p>
      </Section>
    )
  }

  // The routed term's sections decide when the course is offered there; otherwise its recent FCE sections do.
  const mini = courseIsMini(course, summary)
  const expected = expectedHours(units, mini)
  const tone = workloadTone(workloadRatio(summary.hours, units, mini))
  return (
    <Section
      meta={`Last ${summary.terms} ${summary.terms === 1 ? 'term' : 'terms'} with responses, through ${termName(summary.last)}; ${summary.responses.toLocaleString()} responses`}
    >
      <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
        <div className="px-3 py-2.5" title={FCE_HOURS_HELP}>
          <dt className="text-[12px] text-muted">Hours a week</dt>
          <dd className="mt-0.5">
            <span className="display text-[24px] text-ink">{formatHours(summary.hours)}</span>
            {units !== null ? <span className="ml-1 text-[12px] text-muted">for {mini ? `a ${units}-unit mini` : `${units} units`}</span> : null}
            <WorkloadMeter hours={summary.hours} units={units} mini={mini} className="mt-1.5" />
          </dd>
        </div>
        <div className="px-3 py-2.5" title="Overall course rating, 1 to 5">
          <dt className="text-[12px] text-muted">Course rating</dt>
          <dd className="mt-0.5">
            <span className="display text-[24px] text-ink">{formatRating(summary.courseRate)}</span>
            <span className="ml-1 text-[12px] text-muted">of 5</span>
          </dd>
        </div>
        <div className="px-3 py-2.5" title="Overall teaching rating, 1 to 5">
          <dt className="text-[12px] text-muted">Teaching</dt>
          <dd className="mt-0.5">
            <span className="display text-[24px] text-ink">{formatRating(summary.teachingRate)}</span>
            <span className="ml-1 text-[12px] text-muted">of 5</span>
          </dd>
        </div>
      </dl>
      {tone ? (
        <p className={`mt-2 text-[13px] ${WORKLOAD_TONE_CLASS[tone]}`}>
          {WORKLOAD_TONE_LABEL[tone]}
          <span className="text-muted">
            {' '}
            (about {formatHours(summary.hours)} hours a week against the {expected} hours its units suggest
            {mini ? ` while it runs, since a ${units}-unit mini packs a full ${units} units into half a semester` : ''}
            {summary.hoursDelta !== null && Math.abs(summary.hoursDelta) >= 1
              ? `; ${summary.hoursDelta > 0 ? 'up' : 'down'} ${Math.abs(summary.hoursDelta).toFixed(1)} from the terms before`
              : ''}
            )
          </span>
        </p>
      ) : null}

      <Trends rows={rows} units={units} />
      {wide ? (
        <div className="grid min-w-0 gap-x-6 xl:grid-cols-2">
          <History rows={rows} current={current} units={units} fixedMode="instructor" />
          <History rows={rows} current={current} units={units} fixedMode="term" />
        </div>
      ) : (
        <History rows={rows} current={current} units={units} />
      )}
    </Section>
  )
}

function Section({ meta, children }: { meta?: string; children: ReactNode }) {
  return (
    <section aria-labelledby="fce-heading" className="min-w-0">
      <h2 id="fce-heading" className="display text-[20px] text-ink">
        Course evaluations
      </h2>
      {meta ? <p className="mt-0.5 mb-3 text-[12.5px] text-muted">{meta}</p> : <div className="mb-2" />}
      {children}
    </section>
  )
}

function Trends({ rows, units }: { rows: FceRow[]; units: number | null }) {
  const terms = useMemo(() => fceByTerm(rows).reverse(), [rows])
  if (terms.filter((t) => t.responses > 0).length < 2) return null
  // Per term: the hours the units suggest, doubled in terms the course mostly ran as a mini.
  const refs = terms.map((t) => expectedHours(units, t.miniShare >= 0.5))
  const constant = refs.every((r) => r === refs[0])
  const anyMini = refs.some((r) => r !== null && r !== units)
  const maxHours = Math.max(...refs.map((r) => r ?? 0), ...terms.map((t) => t.hours ?? 0))
  const hoursTop = Math.max(6, Math.ceil((maxHours + 1) / 3) * 3)
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <figure className="min-w-0">
        <figcaption className="mb-1 text-[12.5px] font-medium text-ink-2" title={`${FCE_HOURS_HELP} The flat line marks the hours its units suggest${anyMini ? '; it doubles in terms the course ran as a mini' : ''}.`}>
          Hours a week by term
        </figcaption>
        <LineChart
          label="FCE hours per week by term"
          domain={[0, hoursTop]}
          format={(v) => v.toFixed(Number.isInteger(v) ? 0 : 1)}
          reference={units && refs[0] !== null ? { value: constant ? refs[0] : refs, label: `${constant ? refs[0] : refs.at(-1)}h` } : undefined}
          points={terms.map((t) => ({ label: t.term, title: termName(t.term), value: t.hours === null ? null : Math.round(t.hours * 10) / 10, sub: `${t.responses} responses` }))}
        />
      </figure>
      <figure className="min-w-0">
        <figcaption className="mb-1 text-[12.5px] font-medium text-ink-2">Course rating by term</figcaption>
        <LineChart
          label="FCE overall course rating by term"
          domain={[1, 5]}
          format={(v) => v.toFixed(Number.isInteger(v) ? 0 : 2)}
          points={terms.map((t) => ({ label: t.term, title: termName(t.term), value: t.courseRate === null ? null : Math.round(t.courseRate * 100) / 100, sub: `${t.responses} responses` }))}
        />
      </figure>
    </div>
  )
}

// ---- History tables ----

type Mode = 'instructor' | 'term'
type SortDir = 'asc' | 'desc'

interface InstructorRow {
  /** Hours their sections' units suggest (2 × units in mini sections), response-weighted. */
  expected: number | null
  /** Response-weighted share of their sections that were minis. */
  miniShare: number
  key: string
  name: string
  raw: string
  terms: number
  last: string
  responses: number
  teaching: number | null
  courseRate: number | null
  hours: number | null
  current: boolean
}

function byInstructor(rows: FceRow[], current: string[], units: number | null): InstructorRow[] {
  const groups = new Map<string, FceRow[]>()
  for (const r of rows) {
    if (!r.instructor) continue
    const key = fceNameKeys(r.instructor).full
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.entries()].map(([key, list]) => {
    const answered = list.filter((r) => r.responses > 0)
    const terms = [...new Set(list.map((r) => r.term))].sort((a, b) => termOrder(b) - termOrder(a))
    const currentName = current.find((n) => sameInstructor(list[0].instructor, n))
    return {
      key,
      name: currentName ?? displayFceName(list[0].instructor),
      raw: list[0].instructor,
      terms: terms.length,
      last: terms[0],
      responses: answered.reduce((n, r) => n + r.responses, 0),
      teaching: weightedMean(answered, (r) => r.teachingRate, (r) => r.responses),
      courseRate: weightedMean(answered, (r) => r.courseRate, (r) => r.responses),
      hours: weightedMean(answered, (r) => r.hours, (r) => r.responses),
      expected: rowsExpectedHours(answered, units),
      miniShare: weightedMean(answered, (r) => (r.mini !== null ? 1 : 0), (r) => r.responses) ?? 0,
      current: Boolean(currentName),
    }
  })
}

function cmp(a: number | string | null, b: number | string | null): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  return typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number)
}

const PREVIEW_ROWS = 8

/** Hours, colored by how they compare with what the units suggest for that row (doubled for minis). */
function HoursCell({ hours, expected, mini }: { hours: number | null; expected: number | null; mini: boolean }) {
  const tone = hours !== null && expected ? workloadTone(hours / expected) : null
  const title =
    hours === null ? undefined : `${formatHours(hours)} h/wk${expected !== null ? ` against about ${formatHours(expected)} its units suggest${mini ? ' as a mini' : ''}` : ''}${tone ? `: ${WORKLOAD_TONE_LABEL[tone].toLowerCase()}` : ''}`
  return (
    <td className={`px-2 py-1.5 text-right ${tone && tone !== 'even' ? WORKLOAD_TONE_CLASS[tone] : 'text-ink'}`} title={title}>
      {formatHours(hours)}
    </td>
  )
}

function History({ rows, current, units, fixedMode }: { rows: FceRow[]; current: string[]; units: number | null; fixedMode?: Mode }) {
  const [chosenMode, setMode] = useState<Mode>('instructor')
  const mode = fixedMode ?? chosenMode
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: 'last', dir: 'desc' })
  const [expanded, setExpanded] = useState(false)

  const instructors = useMemo(() => byInstructor(rows, current, units), [rows, current, units])

  const sortBy = (key: string, defaultDir: SortDir = 'desc') =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir }))
  const dir = sort.dir === 'asc' ? 1 : -1

  const sortedInstructors = useMemo(() => {
    const value = (r: InstructorRow): number | string | null =>
      sort.key === 'name' ? r.name : sort.key === 'terms' ? r.terms : sort.key === 'teaching' ? r.teaching : sort.key === 'course' ? r.courseRate : sort.key === 'hours' ? r.hours : termOrder(r.last)
    // Current instructors first when sorted by recency, so section choices are easy to compare.
    return [...instructors].sort((a, b) => (sort.key === 'last' ? Number(b.current) - Number(a.current) : 0) || dir * cmp(value(a), value(b)) || a.name.localeCompare(b.name))
  }, [instructors, sort, dir])

  const sortedRows = useMemo(() => {
    const value = (r: FceRow): number | string | null =>
      sort.key === 'name' ? displayFceName(r.instructor) : sort.key === 'teaching' ? r.teachingRate : sort.key === 'course' ? r.courseRate : sort.key === 'hours' ? r.hours : sort.key === 'responses' ? r.responses : termOrder(r.term)
    return [...rows].sort((a, b) => dir * cmp(value(a), value(b)) || termOrder(b.term) - termOrder(a.term) || a.section.localeCompare(b.section))
  }, [rows, sort, dir])

  const list = mode === 'instructor' ? sortedInstructors : sortedRows
  const shown = expanded ? list.length : Math.min(list.length, PREVIEW_ROWS)

  const th = (key: string, label: string, className = '', defaultDir: SortDir = 'desc', title?: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 py-1.5 font-medium ${className}`}>
      <button type="button" onClick={() => sortBy(key, defaultDir)} title={title} className="inline-flex min-h-6 items-center gap-0.5 hover:text-ink">
        {label}
        {sort.key === key ? sort.dir === 'asc' ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" /> : null}
      </button>
    </th>
  )

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">{fixedMode ? `History by ${fixedMode}` : 'History'}</h3>
        <div role="radiogroup" aria-label="Group history" className={`flex rounded-md border border-line-strong p-0.5 text-[12.5px] ${fixedMode ? 'hidden' : ''}`}>
          {(
            [
              ['instructor', 'By instructor'],
              ['term', 'By term'],
            ] as [Mode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                setMode(value)
                setExpanded(false)
              }}
              className={`h-8 rounded-[4px] px-2.5 font-medium sm:h-6 ${mode === value ? 'bg-surface-2 text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line bg-surface-2 text-[12px] text-muted">
            {mode === 'instructor' ? (
              <tr>
                {th('name', 'Instructor', '', 'asc')}
                {th('terms', 'Terms', 'text-right hidden sm:table-cell')}
                {th('last', 'Last', 'text-right')}
                {th('teaching', 'Teach', 'text-right', 'desc', 'Overall teaching rating')}
                {th('course', 'Course', 'text-right', 'desc', 'Overall course rating')}
                {th('hours', 'Hrs', 'text-right', 'asc', FCE_HOURS_HELP)}
              </tr>
            ) : (
              <tr>
                {th('last', 'Term')}
                <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
                  Sec
                </th>
                {th('name', 'Instructor', '', 'asc')}
                {th('responses', 'Resp', 'text-right hidden sm:table-cell', 'desc', 'Responses out of enrolled students')}
                {th('teaching', 'Teach', 'text-right', 'desc', 'Overall teaching rating')}
                {th('course', 'Course', 'text-right', 'desc', 'Overall course rating')}
                {th('hours', 'Hrs', 'text-right', 'asc', FCE_HOURS_HELP)}
              </tr>
            )}
          </thead>
          <tbody className="tabular-nums">
            {mode === 'instructor'
              ? sortedInstructors.slice(0, shown).map((r) => (
                  <tr key={r.key} className="border-b border-line/70 last:border-b-0">
                    <td className="max-w-[11rem] px-2 py-1.5">
                      <span className={`block truncate ${r.current ? 'font-semibold text-ink' : 'text-ink-2'}`} title={r.current ? `${r.name} teaches this course this term` : r.name}>
                        {r.name}
                      </span>
                      {r.current ? <span className="text-[11.5px] text-accent">Teaching this term</span> : null}
                    </td>
                    <td className="hidden px-2 py-1.5 text-right text-ink-2 sm:table-cell">{r.terms}</td>
                    <td className="px-2 py-1.5 text-right text-ink-2">{r.last}</td>
                    <td className="px-2 py-1.5 text-right text-ink">{formatRating(r.teaching)}</td>
                    <td className="px-2 py-1.5 text-right text-ink">{formatRating(r.courseRate)}</td>
                    <HoursCell hours={r.hours} expected={r.expected} mini={r.miniShare >= 0.5} />
                  </tr>
                ))
              : sortedRows.slice(0, shown).map((r, i) => (
                  <tr key={`${r.term}-${r.section}-${r.instructor}-${i}`} className="border-b border-line/70 last:border-b-0">
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink-2" title={termName(r.term)}>
                      {r.term}
                    </td>
                    <td className="hidden px-2 py-1.5 text-ink-2 sm:table-cell">
                      {r.section}
                      {r.mini !== null ? <span className="ml-1 text-[11px] text-muted">mini</span> : null}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-ink-2">{r.instructor ? displayFceName(r.instructor) : '—'}</td>
                    <td className="hidden px-2 py-1.5 text-right text-muted sm:table-cell">
                      {r.responses}/{r.enrolled}
                    </td>
                    <td className="px-2 py-1.5 text-right text-ink">{r.responses ? formatRating(r.teachingRate) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-ink">{r.responses ? formatRating(r.courseRate) : '—'}</td>
                    {r.responses ? <HoursCell hours={r.hours} expected={expectedHours(units, r.mini !== null)} mini={r.mini !== null} /> : <td className="px-2 py-1.5 text-right text-ink">—</td>}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {list.length > PREVIEW_ROWS ? (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-2 inline-flex min-h-9 items-center text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
          {expanded ? 'Show fewer' : `Show all ${list.length} ${mode === 'instructor' ? 'instructors' : 'rows'}`}
        </button>
      ) : null}
    </div>
  )
}

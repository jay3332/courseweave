import { coursePreview } from '../../components/CoursePreview'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, IconButton } from '../../components/ui'
import { codeOf } from '../../lib/requisite-format'
import { isFactorableGrade, termOrdinal } from '../../lib/requisites'
import { entryUnits, useRecord, type RecordEntry } from '../../state/record'
import { useTerm } from '../../state/term'
import { parsePastedCourses, takenEntry, unitsError } from './forms'
import { termLabel, useCourseLookup, useTermOptions, type CourseInfo } from './hooks'
import { CoursePicker, Empty, Field, Section, Select, TextInput } from './shared'

const GRADE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No grade yet' },
  ...['A', 'B', 'C', 'D'].map((g) => ({ value: g, label: g })),
  { value: 'R', label: 'R (failed)' },
  { value: 'P', label: 'P (pass)' },
  { value: 'N', label: 'N (no pass)' },
  { value: 'S', label: 'S (satisfactory)' },
  { value: 'W', label: 'W (withdrew)' },
  { value: 'I', label: 'I (incomplete)' },
  { value: 'O', label: 'O (audit)' },
  ...['A+', 'A-', 'B+', 'B-', 'C+', 'C-', 'D+'].map((g) => ({ value: g, label: `${g} (graduate scale)` })),
]

function gradeNote(grade: string | undefined, info: CourseInfo): string | null {
  const factor = isFactorableGrade(grade)
  if (info.passFail && factor) return 'This course is graded pass/fail only.'
  if (factor === false) return 'Not factored into QPA'
  return null
}

export function TakenSection() {
  const term = useTerm()
  const entries = useRecord((s) => s.entries)
  const profile = useRecord((s) => s.profile)
  const addEntry = useRecord((s) => s.addEntry)
  const addEntries = useRecord((s) => s.addEntries)
  const lookup = useCourseLookup()
  const termOptions = useTermOptions(profile.entryTerm)

  const [courseId, setCourseId] = useState<string | null>(null)
  const [termCode, setTermCode] = useState(() => termOptions[1] ?? termOptions[0] ?? '')
  const [grade, setGrade] = useState('')
  const [units, setUnits] = useState('')
  const [paste, setPaste] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const taken = useMemo(
    () =>
      entries
        .filter((e) => e.source === 'taken')
        .sort((a, b) => (termOrdinal(b.term ?? '') ?? 0) - (termOrdinal(a.term ?? '') ?? 0) || (a.courseId ?? '').localeCompare(b.courseId ?? '')),
    [entries],
  )
  const groups = useMemo(() => {
    const out = new Map<string, RecordEntry[]>()
    for (const e of taken) {
      const key = e.term ?? ''
      out.set(key, [...(out.get(key) ?? []), e])
    }
    return [...out.entries()]
  }, [taken])

  const picked = courseId ? lookup(courseId) : null
  const duplicate = courseId ? taken.find((e) => e.courseId === courseId && (e.term ?? '') === termCode) : undefined

  const draft = takenEntry({ courseId, term: termCode, grade, units, catalogUnits: picked?.units })
  const unitsMessage = unitsError(units)

  const add = () => {
    if (!draft || !draft.courseId) return
    addEntry(draft)
    setMessage(`Added ${codeOf(draft.courseId)}${termCode ? ` for ${termLabel(termCode)}` : ''}.`)
    setCourseId(null)
    setGrade('')
    setUnits('')
  }

  const pasted = useMemo(() => parsePastedCourses(paste), [paste])

  const addPasted = () => {
    const fresh = pasted.filter((id) => !taken.some((e) => e.courseId === id && (e.term ?? '') === termCode))
    addEntries(fresh.map((id) => ({ courseId: id, source: 'taken' as const, ...(termCode ? { term: termCode } : {}) })))
    setMessage(fresh.length ? `Added ${fresh.length} ${fresh.length === 1 ? 'course' : 'courses'}${termCode ? ` for ${termLabel(termCode)}` : ''}.` : 'Those courses are already on your record for that term.')
    setPaste('')
    setPasteOpen(false)
  }

  return (
    <Section
      id="record-taken"
      title="Courses taken"
      description="CMU courses you've finished or are taking now. Grades are optional; without one, Courseweave assumes the course was passed."
    >
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px_90px]">
          <Field label="Course" group>
            <CoursePicker
              label="Course taken"
              value={courseId}
              onChange={(id) => {
                setCourseId(id)
                setMessage(null)
                setUnits(id ? String(lookup(id).units ?? '') : '')
              }}
            />
          </Field>
          <Field label="Semester">
            <Select value={termCode} onChange={(e) => setTermCode(e.target.value)}>
              {(termCode && !termOptions.includes(termCode) ? [termCode, ...termOptions] : termOptions).map((t) => (
                <option key={t} value={t}>
                  {termLabel(t)}
                </option>
              ))}
              <option value="">Not sure</option>
            </Select>
          </Field>
          <Field label="Grade">
            <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Units" error={unitsMessage}>
            <TextInput
              inputMode="decimal"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder={picked?.units === null ? 'VAR' : ''}
              aria-invalid={unitsMessage ? true : undefined}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!draft} onClick={add}>
            <Plus aria-hidden className="size-4" />
            Add course
          </Button>
          <Button variant="ghost" onClick={() => setPasteOpen(!pasteOpen)} aria-expanded={pasteOpen}>
            Paste a list instead
          </Button>
          {duplicate ? <span className="text-[13px] text-warn">Already on your record for {termLabel(termCode)}.</span> : null}
          {message && !duplicate ? (
            <span role="status" className="text-[13px] text-ok">
              {message}
            </span>
          ) : null}
        </div>
        {pasteOpen ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Field label={`Course numbers for ${termCode ? termLabel(termCode) : 'an unknown semester'}`} hint="Paste from SIO or type them: 15-122, 21-127, 76101. Grades can be added after.">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[15px] text-ink placeholder:text-muted focus:border-ink-2 focus:outline-none md:text-[14px]"
                placeholder="15-122, 21-127, 76-101"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!pasted.length} onClick={addPasted}>
                Add {pasted.length || ''} {pasted.length === 1 ? 'course' : 'courses'}
              </Button>
              {pasted.length ? <span className="min-w-0 text-[13px] text-muted">{pasted.map(codeOf).join(', ')}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <Empty>
          Nothing here yet. Add the courses you've taken so prerequisites can be checked in the{' '}
          <Link to={`/${term.meta.id}/schedule`} className="text-ink-2 underline decoration-line-strong underline-offset-2">
            schedule planner
          </Link>
          .
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([termCode, list]) => (
            <TermGroup key={termCode || 'none'} termCode={termCode} entries={list} />
          ))}
        </div>
      )}
    </Section>
  )
}

function TermGroup({ termCode, entries }: { termCode: string; entries: RecordEntry[] }) {
  const lookup = useCourseLookup()
  const units = entries.reduce((n, e) => n + entryUnits(e, e.courseId ? lookup(e.courseId).units : null), 0)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{termCode ? termLabel(termCode) : 'Semester not set'}</h3>
        <span className="text-[13px] text-muted">{units} units</span>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {entries.map((e) => (
          <TakenRow key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  )
}

function TakenRow({ entry }: { entry: RecordEntry }) {
  const term = useTerm()
  const lookup = useCourseLookup()
  const updateEntry = useRecord((s) => s.updateEntry)
  const removeEntry = useRecord((s) => s.removeEntry)
  const info = entry.courseId ? lookup(entry.courseId) : null
  const units = entryUnits(entry, info?.units)
  const note = info ? gradeNote(entry.grade, info) : null
  const offered = entry.courseId ? term.courseById.has(entry.courseId) : false
  const href = info ? (offered ? `/${term.meta.id}/courses/${info.code}` : `/${term.meta.id}/requisites/${info.code}`) : null

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_150px_70px_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          {href ? (
            <Link {...coursePreview(info!.code)} to={href} className="course-code shrink-0 text-[15px] text-ink hover:underline">
              {info!.code}
            </Link>
          ) : null}
          <span className="min-w-0 truncate text-[14px] text-ink-2">{entry.label ?? info?.title ?? 'Not in the catalog'}</span>
        </div>
        {note ? <p className="text-[12px] text-muted">{note}</p> : null}
      </div>
      <IconButton label={`Remove ${info?.code ?? 'course'}`} onClick={() => removeEntry(entry.id)} className="md:order-last">
        <Trash2 />
      </IconButton>
      <label className="col-span-2 flex items-center gap-2 md:col-span-1">
        <span className="text-[13px] text-muted md:sr-only">Grade</span>
        <Select
          value={entry.grade ?? ''}
          onChange={(ev) => updateEntry(entry.id, { grade: ev.target.value || undefined })}
          className="max-w-[180px] md:max-w-none"
          aria-label={`Grade for ${info?.code ?? 'course'}`}
        >
          {GRADE_OPTIONS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[13px] text-ink-2 tabular-nums md:hidden">{units} units</span>
      </label>
      <span className="hidden text-right text-[13.5px] text-ink-2 tabular-nums md:block">{units} units</span>
    </li>
  )
}

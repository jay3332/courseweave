import { coursePreview } from '../../components/CoursePreview'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Chip, IconButton } from '../../components/ui'
import { awardFor, EXAM_SOURCES, EXAMS, examById, type ExamBoard } from '../../lib/exam-credit'
import { COLLEGES, useRecord, type RecordEntry } from '../../state/record'
import { manualExamEntry, unitsError } from './forms'
import { useCourseLookup } from './hooks'
import { CoursePicker, Empty, Field, Section, Select, TextInput } from './shared'

const BOARDS: ExamBoard[] = ['AP', 'IB', 'A-Level']
const BOARD_LABEL: Record<ExamBoard, string> = { AP: 'AP', IB: 'IB (HL)', 'A-Level': 'A-Level' }

export function ExamSection() {
  const entries = useRecord((s) => s.entries)
  const college = useRecord((s) => s.profile.college)
  const addEntries = useRecord((s) => s.addEntries)
  const removeExam = useRecord((s) => s.removeExam)

  const [board, setBoard] = useState<ExamBoard>('AP')
  const exams = useMemo(() => EXAMS.filter((e) => e.board === board).sort((a, b) => a.name.localeCompare(b.name)), [board])
  const [examId, setExamId] = useState('')
  const exam = examId ? examById(examId) : undefined
  const [score, setScore] = useState('')
  const [manualOpen, setManualOpen] = useState(false)

  const examEntries = useMemo(() => entries.filter((e) => e.source === 'exam' || (e.source === 'waiver' && e.exam)), [entries])
  const takenExams = [...new Set(examEntries.map((e) => e.exam?.id).filter((x): x is string => !!x))]
  const result = exam && score ? awardFor(exam, score, college, takenExams.filter((id) => id !== exam.id)) : null
  const already = exam ? takenExams.includes(exam.id) : false

  const add = () => {
    if (!exam || !result?.award) return
    removeExam(exam.id)
    addEntries(
      result.award.courses.map((c) => ({
        courseId: c.courseId,
        source: result.award!.waiverOnly ? ('waiver' as const) : ('exam' as const),
        units: result.award!.waiverOnly ? 0 : c.units,
        label: c.title,
        exam: { id: exam.id, score },
      })),
    )
    setExamId('')
    setScore('')
  }

  const grouped = useMemo(() => {
    const out = new Map<string, RecordEntry[]>()
    for (const e of examEntries) {
      const key = e.exam?.id ?? `manual:${e.id}`
      out.set(key, [...(out.get(key) ?? []), e])
    }
    return [...out.entries()]
  }, [examEntries])

  const collegeName = COLLEGES.find((c) => c.code === college)?.name

  return (
    <Section
      id="record-exams"
      title="AP, IB and A-Level credit"
      description={
        <>
          Pick an exam and score to see what CMU awards, from the registrar's charts (updated March 2026). Exam credit earns units but never counts
          toward QPA.
        </>
      }
    >
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exam program">
          {BOARDS.map((b) => (
            <Chip
              key={b}
              selected={board === b}
              onClick={() => {
                setBoard(b)
                setExamId('')
                setScore('')
              }}
              className="h-9 px-3.5 md:h-7"
            >
              {BOARD_LABEL[b]}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Exam">
            <Select
              value={examId}
              onChange={(e) => {
                setExamId(e.target.value)
                setScore('')
              }}
            >
              <option value="">Choose an exam</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={board === 'A-Level' ? 'Grade' : 'Score'}>
            <Select value={score} onChange={(e) => setScore(e.target.value)} disabled={!exam}>
              <option value="">{exam ? 'Choose' : 'Pick an exam first'}</option>
              {exam?.scores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {result ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3" role="status">
            {result.award ? (
              <>
                <p className="text-[14px] text-ink">
                  {result.award.waiverOnly ? 'Places you out of' : result.eligible ? 'Earns' : 'Would earn'}
                </p>
                <ul className="flex flex-col gap-1">
                  {result.award.courses.map((c) => (
                    <li key={c.courseId} className="flex min-w-0 items-baseline gap-2">
                      <span {...coursePreview(c.courseId)} className="course-code shrink-0 text-[15px] text-ink">{`${c.courseId.slice(0, 2)}-${c.courseId.slice(2)}`}</span>
                      <span className="min-w-0 flex-1 text-[14px] text-ink-2">{c.title}</span>
                      <span className="shrink-0 text-[13px] text-muted">{result.award!.waiverOnly ? 'No units' : `${c.units} units`}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {result.notes.map((n) => (
              <p key={n} className={`text-[13px] ${n.startsWith('No ') || n.startsWith('Not ') ? 'text-warn' : 'text-ink-2'}`}>
                {n}
              </p>
            ))}
            {result.award?.colleges && !college ? (
              <p className="text-[13px] text-ink-2">Set your college above so this can be checked for you.</p>
            ) : null}
            {result.award?.colleges && college && !result.eligible ? <p className="text-[13px] text-muted">Your college: {collegeName}.</p> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!result?.award || !result.eligible} onClick={add}>
            <Plus aria-hidden className="size-4" />
            {already ? 'Replace credit' : 'Add credit'}
          </Button>
          <Button variant="ghost" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}>
            Add exam credit manually
          </Button>
          <a href={EXAM_SOURCES[board].url} target="_blank" rel="noreferrer" className="text-[13px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
            Official {board} chart (PDF)
          </a>
        </div>
        <p className="text-[12.5px] text-muted">{EXAM_SOURCES[board].policy}</p>
        {manualOpen ? <ManualExamForm onDone={() => setManualOpen(false)} /> : null}
      </div>

      {grouped.length === 0 ? (
        <Empty>No exam credit yet.</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {grouped.map(([key, list]) => (
            <ExamRow key={key} entries={list} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function ExamRow({ entries }: { entries: RecordEntry[] }) {
  const lookup = useCourseLookup()
  const removeExam = useRecord((s) => s.removeExam)
  const removeEntry = useRecord((s) => s.removeEntry)
  const first = entries[0]
  const exam = first.exam ? examById(first.exam.id) : undefined
  const units = entries.reduce((n, e) => n + (e.source === 'waiver' ? 0 : (e.units ?? lookup(e.courseId ?? '').units ?? 0)), 0)
  const title = exam ? `${exam.board} ${exam.name}` : (first.note ?? 'Exam credit')
  const remove = () => (first.exam && exam ? removeExam(first.exam.id) : entries.forEach((e) => removeEntry(e.id)))

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-ink">
          {title}
          {first.exam ? <span className="font-normal text-muted">, {exam?.board === 'A-Level' ? 'grade' : 'score'} {first.exam.score}</span> : null}
        </p>
        <p className="text-[13.5px] text-ink-2">
          {entries.map((e, i) => (
            <span key={e.id}>
              {i > 0 ? ', ' : ''}
              <span {...coursePreview(e.courseId)} className="course-code text-ink">{lookup(e.courseId ?? '').code}</span>
              {e.source === 'waiver' ? ' (placement, no credit)' : ''}
            </span>
          ))}
          <span className="text-muted"> for {units} units</span>
        </p>
      </div>
      <IconButton label={`Remove ${title}`} onClick={remove}>
        <Trash2 />
      </IconButton>
    </li>
  )
}

/** For credit the charts don't cover (department review, college-specific mappings). */
function ManualExamForm({ onDone }: { onDone(): void }) {
  const addEntry = useRecord((s) => s.addEntry)
  const lookup = useCourseLookup()
  const [courseId, setCourseId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [units, setUnits] = useState('')

  const draft = manualExamEntry({ courseId, name, units })
  const unitsMessage = unitsError(units)

  const add = () => {
    if (!draft) return
    addEntry(draft)
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px]">
        <Field label="CMU course awarded" group>
          <CoursePicker
            label="CMU course awarded"
            value={courseId}
            onChange={(id) => {
              setCourseId(id)
              setUnits(id ? String(lookup(id).units ?? '') : '')
            }}
          />
        </Field>
        <Field label="Exam" hint="For example: IB Further Mathematics HL, department review">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Units" error={unitsMessage}>
          <TextInput inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} aria-invalid={unitsMessage ? true : undefined} />
        </Field>
      </div>
      <div>
        <Button variant="secondary" disabled={!draft} onClick={add}>
          Add exam credit
        </Button>
      </div>
    </div>
  )
}

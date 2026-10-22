import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button, IconButton } from '../../components/ui'
import { useRecord } from '../../state/record'
import { useTerm } from '../../state/term'
import { useCourseLookup } from './hooks'
import { CoursePicker, Empty, Field, Section, TextInput } from './shared'

const FLAG_LABEL = { prereqs: 'prerequisites', coreqs: 'corequisites', antireqs: 'anti-requisites' } as const

export function WaiversSection() {
  const term = useTerm()
  const entries = useRecord((s) => s.entries)
  const overrides = useRecord((s) => s.overrides)
  const addEntry = useRecord((s) => s.addEntry)
  const removeEntry = useRecord((s) => s.removeEntry)
  const setOverride = useRecord((s) => s.setOverride)
  const lookup = useCourseLookup()

  const [placedId, setPlacedId] = useState<string | null>(null)
  const [placedNote, setPlacedNote] = useState('')
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [flags, setFlags] = useState({ prereqs: true, coreqs: false, antireqs: false })
  const [overrideNote, setOverrideNote] = useState('')

  // Placements that came from an exam are listed with the exam.
  const placements = entries.filter((e) => e.source === 'waiver' && !e.exam)
  const overrideList = Object.entries(overrides).sort((a, b) => a[0].localeCompare(b[0]))

  const addPlacement = () => {
    if (!placedId) return
    addEntry({ courseId: placedId, source: 'waiver', units: 0, ...(placedNote.trim() ? { note: placedNote.trim() } : {}) })
    setPlacedId(null)
    setPlacedNote('')
  }

  const addOverride = () => {
    if (!overrideId || (!flags.prereqs && !flags.coreqs && !flags.antireqs)) return
    setOverride(overrideId, { ...flags, ...(overrideNote.trim() ? { note: overrideNote.trim() } : {}) })
    setOverrideId(null)
    setOverrideNote('')
  }

  return (
    <Section
      id="record-waivers"
      title="Placements and overrides"
      description="Placements count as having taken a course for prerequisites, without earning units. Overrides record permission to take a course without its requisites."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4">
          <h3 className="text-[15px] font-semibold text-ink">Placed out of a course</h3>
          <Field label="Course">
            <CoursePicker label="Course placed out of" value={placedId} onChange={setPlacedId} />
          </Field>
          <Field label="Note (optional)" hint="For example: math placement exam, language placement">
            <TextInput value={placedNote} onChange={(e) => setPlacedNote(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" disabled={!placedId} onClick={addPlacement}>
              <Plus aria-hidden className="size-4" />
              Add placement
            </Button>
          </div>
          {placements.length === 0 ? (
            <Empty>No placements yet.</Empty>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {placements.map((e) => {
                const info = lookup(e.courseId ?? '')
                return (
                  <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-baseline gap-2">
                        <span className="course-code shrink-0 text-[15px] text-ink">{info.code}</span>
                        <span className="min-w-0 truncate text-[14px] text-ink-2">{info.title ?? ''}</span>
                      </p>
                      {e.note ? <p className="text-[13px] text-muted">{e.note}</p> : null}
                    </div>
                    <IconButton label={`Remove placement for ${info.code}`} onClick={() => removeEntry(e.id)}>
                      <Trash2 />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4">
          <h3 className="text-[15px] font-semibold text-ink">Requisite override</h3>
          <Field label="Course you have permission to take">
            <CoursePicker label="Course with an override" value={overrideId} onChange={setOverrideId} />
          </Field>
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Waive its</legend>
            {(Object.keys(FLAG_LABEL) as (keyof typeof FLAG_LABEL)[]).map((k) => (
              <label key={k} className="flex min-h-9 items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                {FLAG_LABEL[k].charAt(0).toUpperCase() + FLAG_LABEL[k].slice(1)}
              </label>
            ))}
          </fieldset>
          <Field label="Note (optional)" hint="For example: instructor permission, advisor approved">
            <TextInput value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" disabled={!overrideId || (!flags.prereqs && !flags.coreqs && !flags.antireqs)} onClick={addOverride}>
              <Plus aria-hidden className="size-4" />
              Save override
            </Button>
          </div>
          {overrideList.length === 0 ? (
            <Empty>No overrides yet. You can also waive requisites from a course's requisite details.</Empty>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {overrideList.map(([id, o]) => {
                const info = lookup(id)
                const waived = (Object.keys(FLAG_LABEL) as (keyof typeof FLAG_LABEL)[]).filter((k) => o[k]).map((k) => FLAG_LABEL[k])
                const offered = term.courseById.has(id)
                return (
                  <li key={id} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-baseline gap-2">
                        <Link
                          to={offered ? `/${term.meta.id}/courses/${info.code}` : `/${term.meta.id}/requisites/${info.code}`}
                          className="course-code shrink-0 text-[15px] text-ink hover:underline"
                        >
                          {info.code}
                        </Link>
                        <span className="min-w-0 truncate text-[14px] text-ink-2">{info.title ?? ''}</span>
                      </p>
                      <p className="text-[13px] text-muted">
                        Waives {waived.join(' and ')}
                        {o.note ? `. ${o.note}` : ''}
                      </p>
                    </div>
                    <IconButton label={`Remove override for ${info.code}`} onClick={() => setOverride(id, null)}>
                      <Trash2 />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}

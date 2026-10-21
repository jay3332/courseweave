import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, IconButton } from '../../components/ui'
import { useRecord } from '../../state/record'
import { CoursePicker, Empty, Field, Section, Select, TextInput, termLabel, useCourseLookup, useTermOptions } from './shared'

export function TransferSection() {
  const entries = useRecord((s) => s.entries)
  const profile = useRecord((s) => s.profile)
  const addEntry = useRecord((s) => s.addEntry)
  const removeEntry = useRecord((s) => s.removeEntry)
  const lookup = useCourseLookup()
  const termOptions = useTermOptions(profile.entryTerm)

  const [general, setGeneral] = useState(false)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [units, setUnits] = useState('')
  const [institution, setInstitution] = useState('')
  const [termCode, setTermCode] = useState('')

  const transfers = entries.filter((e) => e.source === 'transfer')
  const unitsNum = Number(units)
  const unitsValid = units.trim() !== '' && Number.isFinite(unitsNum) && unitsNum >= 0
  const canAdd = general ? label.trim() !== '' && unitsValid : !!courseId

  const add = () => {
    if (!canAdd) return
    addEntry({
      courseId: general ? null : courseId,
      source: 'transfer',
      ...(unitsValid ? { units: unitsNum } : {}),
      ...(general ? { label: label.trim() } : {}),
      ...(institution.trim() ? { institution: institution.trim() } : {}),
      ...(termCode ? { term: termCode } : {}),
    })
    setCourseId(null)
    setLabel('')
    setUnits('')
  }

  return (
    <Section
      id="record-transfer"
      title="Transfer credit"
      description="Courses from other schools that CMU accepted. Transfer credit earns units without a grade, so it never counts toward QPA."
    >
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4">
        <label className="flex min-h-9 items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          No CMU equivalent (general elective units)
        </label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_90px]">
          {general ? (
            <Field label="Description" hint="For example: Calculus III at Pitt, free elective">
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          ) : (
            <Field label="CMU equivalent">
              <CoursePicker
                label="CMU equivalent course"
                value={courseId}
                onChange={(id) => {
                  setCourseId(id)
                  setUnits(id ? String(lookup(id).units ?? '') : '')
                }}
              />
            </Field>
          )}
          <Field label="Units">
            <TextInput inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Institution (optional)">
            <TextInput value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </Field>
          <Field label="Semester (optional)">
            <Select value={termCode} onChange={(e) => setTermCode(e.target.value)}>
              <option value="">Before CMU</option>
              {termOptions.map((t) => (
                <option key={t} value={t}>
                  {termLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <Button variant="primary" disabled={!canAdd} onClick={add}>
            <Plus aria-hidden className="size-4" />
            Add transfer credit
          </Button>
        </div>
      </div>

      {transfers.length === 0 ? (
        <Empty>No transfer credit yet.</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {transfers.map((e) => {
            const info = e.courseId ? lookup(e.courseId) : null
            const u = e.units ?? info?.units ?? 0
            return (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-2">
                    {info ? <span className="course-code shrink-0 text-[15px] text-ink">{info.code}</span> : null}
                    <span className="min-w-0 truncate text-[14px] text-ink-2">{e.label ?? info?.title ?? 'Transfer credit'}</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    {[`${u} units`, e.institution, e.term ? termLabel(e.term) : null].filter(Boolean).join(', ')}
                  </p>
                </div>
                <IconButton label={`Remove ${info?.code ?? e.label ?? 'transfer credit'}`} onClick={() => removeEntry(e.id)}>
                  <Trash2 />
                </IconButton>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

import { Download, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, Dialog } from '../../components/ui'
import { COLLEGES, exportRecord, parseRecordExport, recordTotals, useRecord, type RecordData } from '../../state/record'
import { useTerm } from '../../state/term'
import { ExamSection } from './ExamSection'
import { termLabel, useCourseLookup, useTermOptions } from './hooks'
import { Field, Select } from './shared'
import { TakenSection } from './TakenSection'
import { TransferSection } from './TransferSection'
import { WaiversSection } from './WaiversSection'

export function RecordPage() {
  const term = useTerm()
  useEffect(() => {
    document.title = 'Academic record · Courseweave'
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[980px] flex-col gap-8 px-4 pt-6 pb-16 md:px-8 md:pt-8">
        <Header />
        <ProfileAndTotals />
        <TakenSection />
        <ExamSection />
        <TransferSection />
        <WaiversSection />
        <p className="border-t border-line pt-4 text-[12.5px] text-muted">
          Your record stays in this browser. Export it to keep a backup or move it to another device. Checking against {term.meta.name}{' '}
          course data; exam credit charts from the University Registrar.
        </p>
      </div>
    </div>
  )
}

function Header() {
  const entries = useRecord((s) => s.entries)
  const overrides = useRecord((s) => s.overrides)
  const profile = useRecord((s) => s.profile)
  const importRecord = useRecord((s) => s.importRecord)
  const clearRecord = useRecord((s) => s.clearRecord)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<RecordData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const empty = entries.length === 0 && Object.keys(overrides).length === 0

  const download = () => {
    const blob = new Blob([JSON.stringify(exportRecord({ entries, overrides, profile }), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `courseweave-record-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onFile = async (file: File) => {
    setError(null)
    try {
      const parsed = parseRecordExport(JSON.parse(await file.text()))
      if ('error' in parsed) setError(parsed.error)
      else if (empty) {
        importRecord(parsed.data, 'replace')
        setNotice(`Imported ${parsed.data.entries.length} entries.`)
      } else setPending(parsed.data)
    } catch {
      setError("That file couldn't be read as JSON. Choose a file exported from Courseweave.")
    }
  }

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[34px] text-ink md:text-[40px]">Academic record</h1>
          <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">
            What you've already earned: CMU courses, exam and transfer credit, and placements. Courseweave uses it to check prerequisites in your
            schedules.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={download} disabled={empty}>
            <Download aria-hidden className="size-4" />
            Export
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden className="size-4" />
            Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
          {!empty ? (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>
              Clear record
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-[14px] text-ok">
          {notice}
        </p>
      ) : null}

      <Dialog open={pending !== null} onClose={() => setPending(null)} title="Import record">
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] text-ink-2">
            The file has {pending?.entries.length ?? 0} entries and {Object.keys(pending?.overrides ?? {}).length} overrides. Add them to your
            current record, or replace it entirely?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending) importRecord(pending, 'replace')
                setNotice('Replaced your record with the imported file.')
                setPending(null)
              }}
            >
              Replace
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) importRecord(pending, 'merge')
                setNotice('Merged the imported file into your record.')
                setPending(null)
              }}
            >
              Merge
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear record">
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] text-ink-2">This removes every course, credit, placement and override from this browser. Export first if you might want it back.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearRecord()
                setConfirmClear(false)
                setNotice('Cleared your record.')
              }}
            >
              Clear record
            </Button>
          </div>
        </div>
      </Dialog>
    </header>
  )
}

function ProfileAndTotals() {
  const entries = useRecord((s) => s.entries)
  const profile = useRecord((s) => s.profile)
  const setProfile = useRecord((s) => s.setProfile)
  const lookup = useCourseLookup()
  const termOptions = useTermOptions()
  const term = useTerm()
  const totals = useMemo(() => recordTotals(entries, (id) => lookup(id).units), [entries, lookup])

  // Graduation options run from the routed term to five years out.
  const gradOptions = useMemo(() => {
    const year = Number(term.meta.id.slice(1))
    const out: string[] = []
    for (let y = year; y <= year + 5; y++) out.push(`S${String(y).padStart(2, '0')}`, `F${String(y).padStart(2, '0')}`)
    return withValue(out, profile.expectedGraduation)
  }, [term, profile.expectedGraduation])
  const entryOptions = useMemo(() => withValue(termOptions.filter((t) => !t.startsWith('M')), profile.entryTerm), [termOptions, profile.entryTerm])

  const sources = [
    { label: 'CMU courses', units: totals.bySource.taken },
    { label: 'Exam credit', units: totals.bySource.exam },
    { label: 'Transfer credit', units: totals.bySource.transfer },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 md:grid-cols-1 md:p-4 lg:grid-cols-2">
        <Field label="College" hint="Some exam credit depends on it." className="sm:col-span-2 md:col-span-1 lg:col-span-2">
          <Select value={profile.college ?? ''} onChange={(e) => setProfile({ college: e.target.value || undefined })}>
            <option value="">Not set</option>
            {COLLEGES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First semester at CMU">
          <Select value={profile.entryTerm ?? ''} onChange={(e) => setProfile({ entryTerm: e.target.value || undefined })}>
            <option value="">Not set</option>
            {entryOptions.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expected graduation">
          <Select value={profile.expectedGraduation ?? ''} onChange={(e) => setProfile({ expectedGraduation: e.target.value || undefined })}>
            <option value="">Not set</option>
            {gradOptions.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 md:p-4" aria-label="Unit totals">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className="flex items-baseline gap-1.5">
            <span className="display text-[40px] leading-none text-ink">{totals.earned}</span>
            <span className="text-[14px] text-muted">units earned</span>
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="display text-[26px] leading-none text-ink">{totals.factorable}</span>
            <span className="text-[13.5px] text-muted">factorable</span>
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="display text-[26px] leading-none text-ink">{totals.nonFactorable}</span>
            <span className="text-[13.5px] text-muted">non-factorable</span>
          </p>
          {totals.qpa !== null ? (
            <p className="flex items-baseline gap-1.5">
              <span className="display text-[26px] leading-none text-ink">{totals.qpa.toFixed(2)}</span>
              <span className="text-[13.5px] text-muted">QPA</span>
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3">
          {sources.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="truncate text-[12.5px] text-muted">{s.label}</dt>
              <dd className="text-[16px] font-semibold text-ink tabular-nums">{s.units}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] text-muted">
          Factorable units have letter grades (A–D, or R) and count toward QPA. Pass/fail, transfer and exam credit earn units without affecting QPA.
          {totals.ungraded ? ` ${totals.ungraded} units have no grade yet.` : ''}
        </p>
        <Link
          to={`/${term.meta.id}/plan`}
          className="text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent"
        >
          See how this counts toward your degree
        </Link>
      </div>
    </div>
  )
}

/** Keeps a saved value selectable even when it falls outside the generated range (e.g. an imported record). */
function withValue(options: string[], value: string | undefined): string[] {
  return value && !options.includes(value) ? [value, ...options] : options
}

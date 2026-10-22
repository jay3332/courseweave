// "Import from SIO": read the unofficial academic record PDF in the browser and choose what to add to the record.
import { FileText, Upload } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { coursePreview } from '../../components/CoursePreview'
import { Button, Dialog, Spinner, type ButtonProps } from '../../components/ui'
import { codeOf } from '../../lib/requisite-format'
import { termLabel } from '../../lib/requisites'
import { NotSioRecordError, type SioRecord } from '../../lib/sio-record'
import { COLLEGES, useRecord } from '../../state/record'
import { useTerm } from '../../state/term'
import { PHONE_FULLSCREEN } from '../schedule-tools/dialog'
import { useCourseLookup } from './hooks'
import { planSioImport, type ImportItem, type ImportPlan } from './SioImportPlan'

type State = { kind: 'closed' } | { kind: 'reading' } | { kind: 'error'; message: string } | { kind: 'review'; record: SioRecord; plan: ImportPlan }

const STATUS_TEXT: Record<ImportItem['status'], string> = {
  graded: '',
  'in-progress': 'In progress',
  'no-grade': 'No grade',
  credit: '',
}

/** pdf.js names for errors caused by the file itself (corrupt, encrypted, empty), not by the browser. */
const BAD_FILE_ERRORS = new Set(['InvalidPDFException', 'PasswordException', 'FormatError'])

function importErrorMessage(e: unknown): string {
  if (e instanceof NotSioRecordError) return e.message
  if (e instanceof Error && BAD_FILE_ERRORS.has(e.name)) return "That PDF couldn't be read. Download it from SIO again and retry."
  return "This browser couldn't read the PDF. Update it, or try again in another browser such as Chrome or Firefox."
}

export function SioImportButton({
  onImported,
  variant = 'secondary',
  children,
}: {
  onImported(message: string): void
  variant?: ButtonProps['variant']
  /** A custom trigger in place of the default button. */
  children?: (choose: () => void, reading: boolean) => ReactNode
}) {
  const term = useTerm()
  const lookup = useCourseLookup()
  const entries = useRecord((s) => s.entries)
  const profile = useRecord((s) => s.profile)
  const addEntries = useRecord((s) => s.addEntries)
  const setProfile = useRecord((s) => s.setProfile)
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'closed' })
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [useProfile, setUseProfile] = useState(true)

  const onFile = async (file: File) => {
    setState({ kind: 'reading' })
    try {
      const { readSioRecord } = await import('./SioImportPdf')
      const record = await readSioRecord(file)
      const plan = planSioImport(record, entries, {
        knows: (id) => Boolean(lookup(id).title),
        currentTerm: term.meta.id,
        profile: { college: profile.college, entryTerm: profile.entryTerm },
      })
      setChecked(new Set(plan.groups.flatMap((g) => g.items.filter((i) => !i.already).map((i) => i.key))))
      setUseProfile(true)
      setState({ kind: 'review', record, plan })
    } catch (e) {
      console.error('SIO import failed', e)
      setState({ kind: 'error', message: importErrorMessage(e) })
    }
  }

  const close = () => setState({ kind: 'closed' })

  const doImport = () => {
    if (state.kind !== 'review') return
    const chosen = state.plan.groups.flatMap((g) => g.items).filter((i) => checked.has(i.key))
    if (chosen.length) addEntries(chosen.map((i) => i.entry))
    const profilePatch = useProfile ? state.plan.profile : {}
    if (profilePatch.college || profilePatch.entryTerm) setProfile(profilePatch)
    close()
    onImported(
      chosen.length
        ? `Imported ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} from your SIO record.`
        : 'Updated your profile from your SIO record.',
    )
  }

  return (
    <>
      {children ? (
        children(() => fileRef.current?.click(), state.kind === 'reading')
      ) : (
        <Button variant={variant} onClick={() => fileRef.current?.click()} disabled={state.kind === 'reading'}>
          {state.kind === 'reading' ? <Spinner label="Reading the PDF" /> : <FileText aria-hidden className="size-4" />}
          Import from SIO
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />

      <Dialog
        open={state.kind === 'error' || state.kind === 'review'}
        onClose={close}
        title="Import from SIO"
        className={`w-[min(94vw,760px)] ${PHONE_FULLSCREEN}`}
      >
        {state.kind === 'error' ? (
          <div className="flex flex-col gap-4 p-5">
            <p role="alert" className="text-[15px] text-danger">
              {state.message}
            </p>
            <HowTo />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Close
              </Button>
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden className="size-4" />
                Choose another file
              </Button>
            </div>
          </div>
        ) : state.kind === 'review' ? (
          <Review
            record={state.record}
            plan={state.plan}
            checked={checked}
            setChecked={setChecked}
            useProfile={useProfile}
            setUseProfile={setUseProfile}
            onCancel={close}
            onImport={doImport}
          />
        ) : null}
      </Dialog>
    </>
  )
}

export function HowTo() {
  return (
    <p className="text-[13px] text-muted">
      In SIO, open <span className="text-ink-2">Academic Record</span> and select <span className="text-ink-2">PDF</span> under Unofficial
      Academic Record. The file is read on this device and never uploaded.
    </p>
  )
}

function Review({
  record,
  plan,
  checked,
  setChecked,
  useProfile,
  setUseProfile,
  onCancel,
  onImport,
}: {
  record: SioRecord
  plan: ImportPlan
  checked: Set<string>
  setChecked(next: Set<string>): void
  useProfile: boolean
  setUseProfile(v: boolean): void
  onCancel(): void
  onImport(): void
}) {
  const total = useMemo(() => plan.groups.reduce((n, g) => n + g.items.filter((i) => checked.has(i.key)).length, 0), [plan, checked])
  const profileText = [
    plan.profile.college ? `college to ${COLLEGES.find((c) => c.code === plan.profile.college)?.name ?? plan.profile.college}` : null,
    plan.profile.entryTerm ? `first semester to ${termLabel(plan.profile.entryTerm)}` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const toggle = (key: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(key)
    else next.delete(key)
    setChecked(next)
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        <p className="text-[14px] text-ink-2">
          {record.asOf ? `Your unofficial academic record as of ${record.asOf}. ` : ''}Choose what to add to your Courseweave record. Items
          already in it start unchecked.
        </p>

        {profileText ? (
          <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5">
            <input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" />
            <span className="text-[14px] text-ink">Set your {profileText}</span>
          </label>
        ) : null}

        {plan.groups.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[14px] text-ink-2">
            {record.warnings.length ? 'No courses or credit could be read from this record.' : 'This record has no courses or credit yet.'}
          </p>
        ) : null}

        {plan.groups.map((group) => {
          const keys = group.items.map((i) => i.key)
          const on = keys.filter((k) => checked.has(k)).length
          return (
            <section key={group.key} aria-label={group.subtitle ? `${group.title}, ${group.subtitle}` : group.title}>
              <div className="flex items-center gap-3 border-b border-line pb-1.5">
                <label className="flex min-h-9 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={on === keys.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < keys.length
                    }}
                    onChange={(e) => {
                      const next = new Set(checked)
                      for (const k of keys) {
                        if (e.target.checked) next.add(k)
                        else next.delete(k)
                      }
                      setChecked(next)
                    }}
                    className="size-4 shrink-0 accent-[var(--ink)]"
                  />
                  <span className="display text-[17px] text-ink">{group.title}</span>
                </label>
                {group.subtitle ? <span className="text-[13px] text-muted">{group.subtitle}</span> : null}
                <span className="ml-auto text-[12.5px] text-muted">
                  {on} of {keys.length}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {group.items.map((item) => (
                  <ItemRow key={item.key} item={item} checked={checked.has(item.key)} onChange={(v) => toggle(item.key, v)} />
                ))}
              </ul>
            </section>
          )
        })}

        {record.warnings.length ? (
          <details className="text-[13px] text-muted">
            <summary className="cursor-pointer">
              {record.warnings.length} {record.warnings.length === 1 ? 'line' : 'lines'} couldn't be read
            </summary>
            <ul className="mt-1 list-disc pl-5">
              {record.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <p className="mr-auto text-[13px] text-muted">
          {total} {total === 1 ? 'item' : 'items'} selected
        </p>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onImport} disabled={total === 0 && !(useProfile && profileText)}>
          {total ? `Import ${total} ${total === 1 ? 'item' : 'items'}` : 'Update profile'}
        </Button>
      </div>
    </div>
  )
}

function ItemRow({ item, checked, onChange }: { item: ImportItem; checked: boolean; onChange(v: boolean): void }) {
  const lookup = useCourseLookup()
  const info = lookup(item.row.courseId)
  const title = info.title ?? item.entry.label ?? item.row.title
  const status = STATUS_TEXT[item.status]
  return (
    <li>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5 md:min-h-9">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--ink)]" />
        <span {...coursePreview(item.row.courseId)} className="course-code w-[52px] shrink-0 text-[14.5px] text-ink">
          {codeOf(item.row.courseId)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-ink-2">{title}</span>
          {item.already ? <span className="block text-[12px] text-muted">Already in your record</span> : null}
        </span>
        <span className="shrink-0 text-[13px] text-muted tabular-nums">{item.row.units}u</span>
        <span className="w-[76px] shrink-0 text-right text-[12.5px]">
          {item.entry.grade ? (
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-semibold text-ink-2">{item.entry.grade}</span>
          ) : status ? (
            <span className={item.status === 'in-progress' ? 'text-warn' : 'text-muted'}>{status}</span>
          ) : null}
        </span>
      </label>
    </li>
  )
}

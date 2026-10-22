// Ways into the academic record for students who haven't added one yet: the first-run dialog, the record page's
// empty state and a nudge on pages that depend on it.
import { Check, FileText, PencilLine, X, type LucideIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, Dialog, IconButton, Spinner } from '../../components/ui'
import { useOnboarding } from '../../state/onboarding'
import { useSession } from '../../state/session'
import { useTerm } from '../../state/term'
import { HowTo, SioImportButton } from './SioImport'

/** The record page's sections, for "add by hand" shortcuts. */
export const RECORD_SECTIONS = [
  { id: 'record-taken', label: 'Courses taken' },
  { id: 'record-exams', label: 'AP, IB and A-Level credit' },
  { id: 'record-transfer', label: 'Transfer credit' },
  { id: 'record-waivers', label: 'Placements and overrides' },
]

function useOpenRecord() {
  const term = useTerm()
  const navigate = useNavigate()
  return () => navigate(`/${term.meta.id}/record`)
}

function ChoiceCard({
  icon: Icon,
  title,
  primary = false,
  busy = false,
  onClick,
  note,
  children,
}: {
  icon: LucideIcon
  title: string
  primary?: boolean
  busy?: boolean
  onClick(): void
  /** Smaller print under the description. */
  note?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className={`group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border bg-surface p-3.5 text-left md:p-4 transition-colors hover:bg-surface-2 disabled:opacity-60 ${
        primary ? 'border-ink-2 pl-5.5 md:pl-6' : 'border-line-strong'
      }`}
    >
      {primary ? <span aria-hidden className="tartan absolute inset-y-0 left-0 w-2" /> : null}
      <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${primary ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2'}`}>
        {busy ? <Spinner label="Reading the PDF" /> : <Icon aria-hidden className="size-[18px]" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-title`} className="text-[15.5px] font-semibold text-ink">
          {title}
        </span>
        <span id={`${id}-desc`} className="flex flex-col gap-1">
          <span className="text-[13.5px] text-ink-2">{children}</span>
          {note ? <span className="text-[12.5px] text-muted">{note}</span> : null}
        </span>
      </span>
    </button>
  )
}

/** First-run dialog: add past courses and credit, or skip. */
export default function RecordOnboarding({ onClose }: { onClose(): void }) {
  const user = useSession((s) => s.user)
  const markAsked = useOnboarding((s) => s.markAsked)
  const openRecord = useOpenRecord()
  const [imported, setImported] = useState<string | null>(null)
  const firstName = user?.name?.split(/\s+/)[0]

  const finish = () => {
    markAsked(user?.email ?? null)
    onClose()
  }

  return (
    <Dialog open onClose={finish} title={imported ? 'Record added' : firstName ? `Welcome, ${firstName}` : 'Welcome to Courseweave'} className="w-[min(94vw,580px)]">
      {imported ? (
        <div className="flex flex-col gap-4 p-5">
          <p role="status" className="flex items-start gap-2 text-[15.5px] font-medium text-ink">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
            {imported}
          </p>
          <p className="text-[14.5px] text-ink-2">
            Prerequisite checks and your degree plan now count it. Placements, waivers and anything else SIO doesn't list can be added on the Record
            page.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={finish}>
              Done
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                finish()
                openRecord()
              }}
            >
              Open my record
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4 md:gap-5 md:p-5">
          <div>
            <h3 className="display text-[22px] leading-tight text-ink md:text-[28px]">Start with what you've already taken</h3>
            <p className="mt-1.5 text-[14px] text-ink-2 md:mt-2 md:text-[14.5px]">
              Courseweave checks prerequisites and degree requirements against what you've earned: CMU courses, AP and IB scores (incoming students
              too), transfer credit and placements.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <SioImportButton
              onImported={(message) => {
                markAsked(user?.email ?? null)
                setImported(message)
              }}
            >
              {(choose, reading) => (
                <ChoiceCard
                  icon={FileText}
                  title="Import from SIO"
                  primary
                  busy={reading}
                  onClick={choose}
                  note="In SIO, open Academic Record and select PDF under Unofficial Academic Record. It's read on this device, never uploaded."
                >
                  Add courses and credit from your unofficial academic record PDF. You pick what to bring in.
                </ChoiceCard>
              )}
            </SioImportButton>
            <ChoiceCard
              icon={PencilLine}
              title="Enter it by hand"
              onClick={() => {
                finish()
                openRecord()
              }}
            >
              Add courses, AP or IB scores and transfer credit yourself on the Record page.
            </ChoiceCard>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 md:pt-4">
            <p className="min-w-0 text-[13px] text-muted">Nothing to add yet? You can do this any time from Record.</p>
            <Button variant="ghost" onClick={finish}>
              Skip for now
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** The record page's opening panel while the record is empty. */
export function RecordEmptyStart({ onImported }: { onImported(message: string): void }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <section aria-labelledby="record-start" className="overflow-hidden rounded-xl border border-line-strong bg-surface">
      <div aria-hidden className="tartan h-1.5" />
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-8 md:p-6">
        <div className="min-w-0 flex-1">
          <h2 id="record-start" className="display text-[24px] text-ink md:text-[26px]">
            Start with your SIO record
          </h2>
          <p className="mt-1 mb-2 max-w-[62ch] text-[14.5px] text-ink-2">
            Import your unofficial academic record to add your CMU courses, AP and IB credit and transfer credit in one go. You choose what to bring
            in.
          </p>
          <HowTo />
        </div>
        <SioImportButton variant="primary" onImported={onImported} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-[13.5px] md:px-6">
        <span className="text-muted">Or add by hand:</span>
        {RECORD_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className="min-h-8 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-0"
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/** A nudge on pages that depend on the record (e.g. the degree plan) while it's empty. Can be hidden. */
export function RecordPrompt({ children }: { children: ReactNode }) {
  const hidden = useOnboarding((s) => s.promptHidden)
  const hide = useOnboarding((s) => s.hidePrompt)
  const openRecord = useOpenRecord()
  if (hidden) return null
  return (
    <section aria-label="Add your academic record" className="relative flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-3 pr-11 md:flex-row md:items-center md:gap-5 md:p-4 md:pr-12">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-ink">Add courses you've already taken</h2>
        <p className="mt-0.5 text-[13.5px] text-ink-2">{children}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <SioImportButton onImported={() => {}} />
        <Button onClick={() => openRecord()}>
          <PencilLine aria-hidden className="size-4" />
          Add by hand
        </Button>
      </div>
      <div className="absolute top-2 right-2">
        <IconButton label="Hide this" size="sm" onClick={hide}>
          <X />
        </IconButton>
      </div>
    </section>
  )
}

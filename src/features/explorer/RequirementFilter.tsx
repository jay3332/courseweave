import { ArrowLeft, GraduationCap, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, IconButton, SearchInput, Spinner } from '../../components/ui'
import type { ProgramInfo } from '../../lib/plan-types'
import { defaultVersion, useProgramsIndex, useProgramVersions } from '../../lib/programs'
import { flattenRequirements, type FlatRequirement } from '../../lib/requirement-match'
import { normalize } from '../../lib/search'
import type { ReqRef } from './filters'
import { usePlanPrograms, useRequirementLabel } from './requirementHooks'

type Step = { kind: 'closed' } | { kind: 'program' } | { kind: 'node'; auditId: number; label: string }

/** "Counts toward a requirement" picker: a program (from the degree plan, or any), then one of its requirements. */
export function RequirementPicker({ value, onChange }: { value: ReqRef | null; onChange(next: ReqRef | null): void }) {
  const [step, setStep] = useState<Step>({ kind: 'closed' })
  const label = useRequirementLabel(value)

  if (step.kind === 'closed') {
    if (!value) {
      return (
        <Button size="sm" className="h-9 w-full justify-start lg:h-8" onClick={() => setStep({ kind: 'program' })}>
          <GraduationCap className="size-4" />
          Choose a requirement
        </Button>
      )
    }
    return (
      <div className="rounded-lg border border-ink bg-surface p-2.5">
        {label.status === 'loading' ? (
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner label="Loading requirement" /> Loading requirement
          </span>
        ) : label.status === 'ready' ? (
          <>
            <p className="text-[13.5px] leading-snug font-medium text-ink">{label.name}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{[label.program, ...(label.path ?? [])].join(' › ')}</p>
          </>
        ) : (
          <p className="text-[13px] text-muted">This requirement isn’t available. Choose another one.</p>
        )}
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" className="h-9 lg:h-7" onClick={() => setStep({ kind: 'program' })}>
            Change
          </Button>
          <Button size="sm" variant="ghost" className="h-9 lg:h-7" onClick={() => onChange(null)}>
            Clear
          </Button>
        </div>
      </div>
    )
  }

  if (step.kind === 'program') {
    return (
      <ProgramStep
        onCancel={() => setStep({ kind: 'closed' })}
        onPick={(auditId, programLabel) => setStep({ kind: 'node', auditId, label: programLabel })}
      />
    )
  }

  return (
    <NodeStep
      auditId={step.auditId}
      label={step.label}
      onBack={() => setStep({ kind: 'program' })}
      onPick={(nodeId) => {
        onChange({ auditId: step.auditId, nodeId })
        setStep({ kind: 'closed' })
      }}
    />
  )
}

const KIND_ORDER: ProgramInfo['kind'][] = ['major', 'additional-major', 'minor', 'track', 'requirements']

function ProgramStep({ onCancel, onPick }: { onCancel(): void; onPick(auditId: number, label: string): void }) {
  const plan = usePlanPrograms()
  const index = useProgramsIndex()
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean)
    if (!tokens.length || index.status !== 'ready') return []
    return index.value.programs
      .filter((p) => tokens.every((t) => normalize(p.name).includes(t)) && p.versions.length)
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [index, query])

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-strong bg-surface p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">Pick a program</span>
        <IconButton label="Cancel" size="sm" onClick={onCancel}>
          <X />
        </IconButton>
      </div>
      {plan.choices.length ? (
        <div className="flex flex-col">
          <span className="px-1 pb-1 text-[12px] text-muted">From your degree plan</span>
          {plan.choices.map((c) => (
            <button
              key={c.auditId}
              type="button"
              onClick={() => onPick(c.auditId, c.label)}
              className="flex min-h-9 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-surface-2"
            >
              <span className="text-[13px] leading-snug text-ink">{c.label}</span>
              <span className="text-[11.5px] text-muted">{c.detail}</span>
            </button>
          ))}
        </div>
      ) : plan.loading ? (
        <span className="flex items-center gap-2 px-1 text-[12.5px] text-muted">
          <Spinner label="Loading your plan" /> Loading your degree plan
        </span>
      ) : null}
      <SearchInput value={query} onChange={setQuery} placeholder="Search all programs" aria-label="Search all programs" className="[&_input]:h-9" />
      {index.status === 'error' ? <p className="px-1 text-[12.5px] text-danger">{index.error}</p> : null}
      {results.length ? (
        <ul className="flex flex-col">
          {results.map((p) => {
            const v = defaultVersion(p, plan.entryYear)
            if (!v) return null
            return (
              <li key={p.catalogId}>
                <button
                  type="button"
                  onClick={() => onPick(v.auditId, p.name)}
                  className="flex min-h-9 w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-surface-2"
                >
                  <span className="text-[13px] leading-snug text-ink">{p.name}</span>
                  <span className="text-[11.5px] text-muted">{v.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : query.trim() && index.status === 'ready' ? (
        <p className="px-1 text-[12.5px] text-muted">No program matches “{query.trim()}”.</p>
      ) : null}
    </div>
  )
}

function NodeStep({ auditId, label, onBack, onPick }: { auditId: number; label: string; onBack(): void; onPick(nodeId: number): void }) {
  const versions = useProgramVersions([auditId])
  const plan = usePlanPrograms()
  const [query, setQuery] = useState('')
  const version = versions.status === 'ready' ? versions.value.get(auditId) : undefined

  const items = useMemo<FlatRequirement[]>(() => (version ? flattenRequirements(version, plan.programIds).filter((f) => !f.broad) : []), [version, plan.programIds])
  const q = normalize(query).trim()
  const shown = q ? items.filter((f) => normalize([...f.path, f.name].join(' ')).includes(q)) : items

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-strong bg-surface p-2">
      <div className="flex items-center gap-1">
        <IconButton label="Back to programs" size="sm" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={label}>
          {label}
        </span>
      </div>
      {versions.status === 'loading' ? (
        <span className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-muted">
          <Spinner label="Loading requirements" /> Loading requirements
        </span>
      ) : versions.status === 'error' ? (
        <p className="px-1 text-[12.5px] text-danger">{versions.error}</p>
      ) : (
        <>
          {items.length > 8 ? <SearchInput value={query} onChange={setQuery} placeholder="Find a requirement" aria-label="Find a requirement" className="[&_input]:h-9" /> : null}
          <ul className="scrollbar-thin flex max-h-72 flex-col overflow-y-auto">
            {shown.map((f) => (
              <li key={f.nodeId}>
                <button
                  type="button"
                  onClick={() => onPick(f.nodeId)}
                  style={{ paddingLeft: q ? 8 : 8 + f.depth * 12 }}
                  className="flex min-h-9 w-full items-baseline gap-2 rounded-md py-1 pr-2 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    {q && f.path.length ? <span className="block text-[11.5px] leading-snug text-muted">{f.path.join(' › ')}</span> : null}
                    <span className={`text-[13px] leading-snug ${f.depth === 0 ? 'font-medium text-ink' : 'text-ink-2'}`}>{f.name}</span>
                  </span>
                  {f.target ? <span className="shrink-0 text-[11.5px] text-muted">{f.target}</span> : null}
                </button>
              </li>
            ))}
            {!shown.length ? <li className="px-2 py-2 text-[12.5px] text-muted">{q ? `Nothing matches “${query.trim()}”.` : 'This program has no course requirements to filter by.'}</li> : null}
          </ul>
        </>
      )}
    </div>
  )
}

/** Removable chip above the results showing the active requirement filter. */
export function RequirementChip({ req, onClear }: { req: ReqRef; onClear(): void }) {
  const label = useRequirementLabel(req)
  const text =
    label.status === 'ready' ? label.name : label.status === 'loading' ? 'Loading requirement…' : 'Unknown requirement'
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-ink bg-surface py-0.5 pr-0.5 pl-2.5 text-[12.5px] text-ink">
      <GraduationCap aria-hidden className="size-3.5 shrink-0 text-muted" />
      <span className="truncate" title={label.status === 'ready' ? [label.program, ...(label.path ?? []), label.name].join(' › ') : undefined}>
        Counts toward {text}
      </span>
      <button type="button" aria-label="Clear requirement filter" onClick={onClear} className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink sm:size-5">
        <X className="size-3.5" />
      </button>
    </span>
  )
}

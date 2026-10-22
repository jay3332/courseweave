import { Plus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Chip, IconButton, SearchInput, Spinner, Tag } from '../../../components/ui'
import type { ProgramVersion } from '../../../lib/degree-types'
import type { ProgramInfo, ProgramKind, ProgramSelection } from '../../../lib/plan-types'
import { defaultVersion, useProgramsIndex, useProgramVersions } from '../../../lib/programs'
import { normalize } from '../../../lib/search'

export interface ProgramPickerProps {
  value: ProgramSelection[]
  onChange(value: ProgramSelection[]): void
  /** Entry year (the fall a student started), to preselect matching requirement versions. */
  entryYearHint?: number
}

const KIND_LABEL: Record<ProgramKind, string> = {
  major: 'Major',
  minor: 'Minor',
  'additional-major': 'Additional major',
  requirements: 'Requirements',
  track: 'Track',
}

type KindFilter = 'all' | 'major' | 'minor' | 'additional-major' | 'other'
const FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'major', label: 'Majors' },
  { id: 'minor', label: 'Minors' },
  { id: 'additional-major', label: 'Additional majors' },
  { id: 'other', label: 'Concentrations and other' },
]

const RESULT_LIMIT = 30

/** Choose majors, minors and requirement bundles to audit, each at a specific version. */
/** The campus a program belongs to when it isn't Pittsburgh (e.g. "Doha"), so same-named programs can be told apart. */
function programCampus(p: ProgramInfo): string | null {
  const campuses = new Set(p.versions.map((v) => v.campus).filter((c): c is string => Boolean(c)))
  return campuses.size === 1 && !campuses.has('Pittsburgh') ? [...campuses][0] : null
}

export function ProgramPicker({ value, onChange, entryYearHint }: ProgramPickerProps) {
  const index = useProgramsIndex()
  const versions = useProgramVersions(value.map((v) => v.auditId))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<KindFilter>('all')
  const listId = useId()

  const indexValue = index.status === 'ready' ? index.value : null
  const programs = useMemo(() => indexValue?.programs ?? [], [indexValue])
  const byCatalog = useMemo(() => new Map(programs.map((p) => [p.catalogId, p])), [programs])

  const results = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean)
    if (!tokens.length) return []
    const chosen = new Set(value.map((v) => v.catalogId))
    const q = normalize(query).trim()
    return programs
      .filter((p) => {
        if (chosen.has(p.catalogId)) return false
        if (filter === 'other' ? !(p.kind === 'requirements' || p.kind === 'track') : filter !== 'all' && p.kind !== filter) return false
        const name = normalize(p.name)
        return tokens.every((t) => name.includes(t))
      })
      .sort((a, b) => {
        const kindRank = (p: ProgramInfo) => ['major', 'additional-major', 'minor', 'track', 'requirements'].indexOf(p.kind)
        return (
          Number(normalize(b.name).startsWith(q)) - Number(normalize(a.name).startsWith(q)) ||
          Number(programCampus(a) !== null) - Number(programCampus(b) !== null) ||
          kindRank(a) - kindRank(b) ||
          a.name.localeCompare(b.name)
        )
      })
  }, [programs, query, filter, value])

  const add = (p: ProgramInfo) => {
    const v = defaultVersion(p, entryYearHint)
    if (!v) return
    onChange([...value, { catalogId: p.catalogId, auditId: v.auditId }])
    setQuery('')
  }
  const update = (i: number, next: ProgramSelection) => onChange(value.map((v, j) => (j === i ? next : v)))
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))

  if (index.status === 'error') return <p className="text-[13.5px] text-danger">{index.error}</p>

  return (
    <div className="flex flex-col gap-3">
      {value.length ? (
        <ul className="flex flex-col gap-2">
          {value.map((sel, i) => (
            <SelectedProgram
              key={`${sel.catalogId}-${i}`}
              sel={sel}
              info={byCatalog.get(sel.catalogId)}
              version={versions.status === 'ready' ? versions.value.get(sel.auditId) : undefined}
              onChange={(next) => update(i, next)}
              onRemove={() => remove(i)}
            />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={value.length ? 'Add a minor, major or concentration' : 'Search majors and minors: computer science'}
          aria-label="Search degree programs"
          aria-controls={listId}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Program type">
          {FILTERS.map((f) => (
            <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)} className="h-9 md:h-7">
              {f.label}
            </Chip>
          ))}
        </div>
        {index.status === 'loading' ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner label="Loading programs" /> Loading programs
          </div>
        ) : query.trim() ? (
          results.length ? (
            <ul id={listId} className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border border-line bg-surface">
              {results.slice(0, RESULT_LIMIT).map((p) => (
                <li key={p.catalogId} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 md:min-h-9"
                  >
                    <Plus aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-[14px] text-ink">{p.name}</span>
                    {programCampus(p) ? <Tag className="shrink-0">{programCampus(p)}</Tag> : null}
                    <Tag className="shrink-0">{KIND_LABEL[p.kind]}</Tag>
                  </button>
                </li>
              ))}
              {results.length > RESULT_LIMIT ? (
                <li className="border-t border-line px-3 py-2 text-[12.5px] text-muted">{results.length - RESULT_LIMIT} more; keep typing to narrow it down</li>
              ) : null}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No programs match "{query.trim()}". Try fewer words, or another program type.</p>
          )
        ) : !value.length ? (
          <p className="text-[12.5px] text-muted">
            {programs.length ? `${countKind(programs, 'major')} majors, ${countKind(programs, 'minor')} minors and ${countKind(programs, 'additional-major')} additional majors, from CMU's degree audit.` : ''}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function countKind(programs: ProgramInfo[], kind: ProgramKind): number {
  return programs.filter((p) => p.kind === kind).length
}

function SelectedProgram({
  sel,
  info,
  version,
  onChange,
  onRemove,
}: {
  sel: ProgramSelection
  info: ProgramInfo | undefined
  version: ProgramVersion | undefined
  onChange(next: ProgramSelection): void
  onRemove(): void
}) {
  const selectId = useId()
  const name = info?.name ?? version?.programName ?? `Program ${sel.catalogId}`
  const chosen = new Set(sel.concentrations ?? [])
  const toggleConcentration = (id: number) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...sel, concentrations: [...next] })
  }
  const attached = version?.attached.filter((a) => a.auditId !== null) ?? []

  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-semibold text-ink">{name}</span>
            {info && programCampus(info) ? <Tag>{programCampus(info)}</Tag> : null}
            {info ? <Tag>{KIND_LABEL[info.kind]}</Tag> : null}
          </div>
          {info && info.versions.length > 1 ? (
            <label htmlFor={selectId} className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              Requirements version
              <select
                id={selectId}
                value={sel.auditId}
                onChange={(e) => onChange({ catalogId: sel.catalogId, auditId: Number(e.target.value) })}
                className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface pr-7 pl-2 text-[14px] text-ink md:h-8 md:text-[13px]"
              >
                {info.versions.map((v) => (
                  <option key={v.auditId} value={v.auditId}>
                    {v.name}
                    {v.campus && !v.name.includes(v.campus) ? ` (${v.campus})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : info?.versions[0] ? (
            <p className="mt-1 text-[12.5px] text-muted">{info.versions[0].name} requirements</p>
          ) : null}
        </div>
        <IconButton label={`Remove ${name}`} onClick={onRemove}>
          <X />
        </IconButton>
      </div>

      {version?.concentrations.length ? (
        <div className="mt-2">
          <p className="text-[12.5px] text-muted">Concentration (optional)</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {version.concentrations.map((c) => (
              <Chip
                key={c.id}
                selected={chosen.has(c.id)}
                onClick={() => toggleConcentration(c.id)}
                className="h-9 md:h-7"
                title={c.programs.length ? `Audited with ${c.programs[0].name}` : "Requirements for this concentration aren't available"}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {attached.length ? (
        <p className="mt-2 text-[12.5px] text-muted">Also checks {attached.map((a) => a.name).join(', ')}</p>
      ) : null}
    </li>
  )
}

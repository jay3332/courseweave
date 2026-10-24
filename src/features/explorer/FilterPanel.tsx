import { Check } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { Chip } from '../../components/ui'
import type { Department, Term } from '../../lib/data'
import { normalize } from '../../lib/search'
import { DAY_LETTERS, DAY_LONG, formatTime } from '../../lib/time'
import type { Day } from '../../lib/types'
import { FCE_HOURS_HELP } from '../../lib/fce'
import { activeFilterCount, EMPTY_FILTERS, MAX_HOURS_RANGE, MIN_RATING_RANGE, UNIT_BUCKETS, type Delivery, type Filters, type Level } from './filters'
import { RequirementPicker } from './RequirementFilter'

const TIME_OPTIONS = Array.from({ length: (23 - 7) * 2 + 1 }, (_, i) => 7 * 60 + i * 30)

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
}

export function FilterPanel({
  term,
  filters,
  onChange,
  heading = true,
  fceAvailable = false,
  showUnoffered,
  onShowUnofferedChange,
  allSemesters = false,
  departments = term.departments,
}: {
  term: Term
  filters: Filters
  onChange(next: Filters): void
  heading?: boolean
  /** Show the FCE workload/rating filters (hidden when FCE data isn't loaded). */
  fceAvailable?: boolean
  /** "Show courses not offered in <term>"; the option is left out without a handler. */
  showUnoffered?: boolean
  onShowUnofferedChange?(value: boolean): void
  /** The all-semesters view: no sections, so only filters that work without them. */
  allSemesters?: boolean
  /** The departments to pick from; defaults to the semester's. */
  departments?: Department[]
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value })
  const count = activeFilterCount(filters)

  return (
    <div className="flex flex-col gap-5 text-[14px]">
      <div className={`flex h-7 items-center justify-between ${!heading && !count ? 'hidden' : ''}`}>
        {heading ? (
          <h2 className="display text-lg">
            Filters
            {count ? <span className="ml-1.5 align-middle text-[13px] font-semibold text-accent">{count}</span> : null}
          </h2>
        ) : (
          <span className="text-[13px] text-muted">{count} active</span>
        )}
        {count ? (
          <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className="rounded text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
            Clear all
          </button>
        ) : null}
      </div>

      {onShowUnofferedChange ? (
        <div className="flex flex-col gap-1">
          <Toggle checked={Boolean(showUnoffered)} onChange={onShowUnofferedChange}>
            Show courses not offered in {term.meta.name}
          </Toggle>
          <p className="pl-[42px] text-[12px] text-muted">Offered in other semesters or listed in the catalog. Listed after this semester’s courses.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {allSemesters ? null : (
          <Toggle checked={filters.fits} onChange={(v) => set('fits', v)}>
            Fits my schedule
          </Toggle>
        )}
        <Toggle checked={filters.saved} onChange={(v) => set('saved', v)}>
          Saved courses only
        </Toggle>
        {allSemesters ? null : (
          <Toggle checked={filters.scheduledOnly} onChange={(v) => set('scheduledOnly', v)}>
            Has a scheduled time
          </Toggle>
        )}
      </div>

      <Group label="Counts toward a requirement">
        <RequirementPicker value={filters.req} onChange={(v) => set('req', v)} />
      </Group>

      {fceAvailable ? (
        <Group label="Workload and ratings">
          <div className="flex flex-col gap-3">
            <FilterSlider
              label="FCE hours a week, at most"
              title={FCE_HOURS_HELP}
              range={MAX_HOURS_RANGE}
              anyAt="max"
              value={filters.maxHours}
              format={(v) => `${v} h`}
              onChange={(v) => set('maxHours', v)}
            />
            <FilterSlider
              label="Course rating, at least"
              title="Overall course rating from FCEs, 1 to 5"
              range={MIN_RATING_RANGE}
              anyAt="min"
              value={filters.minRating}
              format={(v) => v.toFixed(1)}
              onChange={(v) => set('minRating', v)}
            />
          </div>
          <div className="mt-2.5">
            <Toggle checked={filters.withinUnits} onChange={(v) => set('withinUnits', v)}>
              No heavier than its units
            </Toggle>
          </div>
        </Group>
      ) : null}

      <Group label="Department">
        <DepartmentPicker departments={departments} selected={filters.depts} onChange={(v) => set('depts', v)} />
      </Group>

      <Group label="Level">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['U', 'Undergraduate'],
              ['G', 'Graduate'],
            ] as [Level, string][]
          ).map(([value, label]) => (
            <Chip key={value} selected={filters.levels.includes(value)} onClick={() => set('levels', toggle(filters.levels, value))}>
              {label}
            </Chip>
          ))}
        </div>
      </Group>

      <Group label="Units">
        <div className="flex flex-wrap gap-1.5">
          {UNIT_BUCKETS.map((b) => (
            <Chip
              key={b.id}
              selected={filters.units.includes(b.id)}
              onClick={() => set('units', toggle(filters.units, b.id))}
              title={b.id === 'var' ? 'Variable units' : `${b.label} units`}
            >
              {b.label}
            </Chip>
          ))}
        </div>
      </Group>

      {allSemesters ? null : <SectionFilters term={term} filters={filters} set={set} />}
    </div>
  )
}

/** Days, times, delivery and session: these need a semester's sections. */
function SectionFilters({ term, filters, set }: { term: Term; filters: Filters; set<K extends keyof Filters>(key: K, value: Filters[K]): void }) {
  return (
    <>
      <Group label="Days">
        <div className="flex gap-1">
          {DAY_LETTERS.map((letter, i) => {
            const day = i as Day
            const on = filters.days.includes(day)
            return (
              <button
                key={letter}
                type="button"
                aria-pressed={on}
                aria-label={DAY_LONG[day]}
                title={DAY_LONG[day]}
                onClick={() => set('days', toggle(filters.days, day).sort() as Day[])}
                className={`grid h-8 flex-1 place-items-center rounded-md border text-[13px] font-semibold transition-colors ${
                  on ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                }`}
              >
                {letter}
              </button>
            )
          })}
        </div>
        <div role="radiogroup" aria-label="Day matching" className="mt-2 grid grid-cols-2 rounded-md border border-line-strong p-0.5 text-[12.5px]">
          {(
            [
              ['only', 'Only these days'],
              ['any', 'Any of these'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filters.dayMode === value}
              onClick={() => set('dayMode', value)}
              className={`h-6 rounded-[4px] font-medium transition-colors ${filters.dayMode === value ? 'bg-surface-2 text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Time">
        <div className="grid grid-cols-2 gap-2">
          <TimeSelect label="Starts at or after" value={filters.after} onChange={(v) => set('after', v)} />
          <TimeSelect label="Ends by" value={filters.before} onChange={(v) => set('before', v)} />
        </div>
      </Group>

      <Group label="Delivery">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['inperson', 'In person'],
              ['remote', 'Remote'],
            ] as [Delivery, string][]
          ).map(([value, label]) => (
            <Chip key={value} selected={filters.delivery.includes(value)} onClick={() => set('delivery', toggle(filters.delivery, value))}>
              {label}
            </Chip>
          ))}
        </div>
      </Group>

      {term.meta.minis.length ? (
        <Group label="Session">
          <div className="flex flex-wrap gap-1.5">
            <Chip selected={filters.sessions.includes('full')} onClick={() => set('sessions', toggle(filters.sessions, 'full'))}>
              Full semester
            </Chip>
            {term.meta.minis.map((m) => (
              <Chip
                key={m.number}
                selected={filters.sessions.includes(String(m.number))}
                onClick={() => set('sessions', toggle(filters.sessions, String(m.number)))}
              >
                {m.name}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}
    </>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[13px] font-semibold text-ink-2">{label}</legend>
      {children}
    </fieldset>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange(v: boolean): void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-ink-2 select-none hover:text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow-sm transition-[left] ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
      <span className={checked ? 'font-medium text-ink' : ''}>{children}</span>
    </label>
  )
}

/**
 * A range slider whose far end (`anyAt`) means "no filter". The label updates while dragging; the filter (and the
 * URL) only changes when the thumb is released or moved with the keyboard, so dragging doesn't flood history.
 */
function FilterSlider({
  label,
  title,
  range,
  anyAt,
  value,
  format,
  onChange,
}: {
  label: string
  title?: string
  range: { min: number; max: number; step: number }
  anyAt: 'min' | 'max'
  value: number | null
  format(v: number): string
  onChange(v: number | null): void
}) {
  const anyValue = anyAt === 'max' ? range.max : range.min
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value ?? anyValue
  const isAny = shown === anyValue
  const commit = (v: number) => {
    setDraft(null)
    const next = v === anyValue ? null : v
    if (next !== value) onChange(next)
  }
  const read = (e: { currentTarget: HTMLInputElement }) => Number(Number(e.currentTarget.value).toFixed(1))
  const fill = ((shown - range.min) / (range.max - range.min)) * 100
  const id = useId()
  return (
    <div title={title}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] text-muted">
          {label}
        </label>
        <span className={`text-[12.5px] tabular-nums ${isAny ? 'text-muted' : 'font-semibold text-ink'}`}>{isAny ? 'Any' : format(shown)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        aria-valuetext={isAny ? 'Any' : format(shown)}
        onChange={(e) => setDraft(read(e))}
        onPointerUp={(e) => commit(read(e))}
        onKeyUp={(e) => commit(read(e))}
        onBlur={(e) => draft !== null && commit(read(e))}
        className="h-9 w-full cursor-pointer accent-[var(--ink)] lg:h-6"
        style={{
          background: `linear-gradient(to right, ${anyAt === 'max' ? 'var(--ink-2)' : 'var(--line-strong)'} 0 ${fill}%, ${anyAt === 'max' ? 'var(--line-strong)' : 'var(--ink-2)'} ${fill}% 100%) center / 100% 4px no-repeat`,
        }}
      />
      <div className="flex justify-between text-[11px] text-muted">
        <span>{anyAt === 'min' ? 'Any' : format(range.min)}</span>
        <span>{anyAt === 'max' ? 'Any' : format(range.max)}</span>
      </div>
    </div>
  )
}

function TimeSelect({ label, value, onChange }: { label: string; value: number | null; onChange(v: number | null): void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`h-8 w-full rounded-md border bg-surface px-1.5 text-[13px] ${value !== null ? 'border-ink font-medium text-ink' : 'border-line-strong text-ink-2'}`}
      >
        <option value="">Any time</option>
        {TIME_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {formatTime(m)}
          </option>
        ))}
      </select>
    </label>
  )
}

function DepartmentPicker({ departments, selected, onChange }: { departments: Department[]; selected: string[]; onChange(v: string[]): void }) {
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const q = normalize(query.trim())
    const matches = departments.filter(
      (d) => !q || normalize(d.name).includes(q) || normalize(d.code) === q || d.prefixes.some((p) => p.startsWith(q)),
    )
    // Selected departments float to the top so they stay visible.
    return [...matches.filter((d) => selected.includes(d.code)), ...matches.filter((d) => !selected.includes(d.code))]
  }, [departments, query, selected])

  return (
    <div className="rounded-lg border border-line-strong bg-surface">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a department"
        aria-label="Find a department"
        className="h-8 w-full rounded-t-lg border-b border-line bg-transparent px-2.5 text-[13px] placeholder:text-muted focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
      />
      <ul className="scrollbar-thin max-h-56 overflow-y-auto py-1">
        {items.map((d) => {
          const on = selected.includes(d.code)
          return (
            <li key={d.code}>
              <label className="relative flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[13px] hover:bg-surface-2">
                <input type="checkbox" checked={on} onChange={() => onChange(toggle(selected, d.code))} className="peer sr-only" />
                <span
                  aria-hidden
                  className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent ${
                    on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
                  }`}
                >
                  {on ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className={`min-w-0 flex-1 truncate ${on ? 'font-medium text-ink' : 'text-ink-2'}`} title={d.name}>
                  {d.name}
                </span>
                <span className="course-code shrink-0 text-[12px] text-muted">{d.prefixes.join(' ')}</span>
                <span className="w-7 shrink-0 text-right text-[11.5px] text-muted">{d.courseCount}</span>
              </label>
            </li>
          )
        })}
        {!items.length ? <li className="px-2.5 py-2 text-[13px] text-muted">No department matches “{query}”.</li> : null}
      </ul>
    </div>
  )
}

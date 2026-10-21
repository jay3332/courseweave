import { Check } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Chip } from '../../components/ui'
import type { Term } from '../../lib/data'
import { normalize } from '../../lib/search'
import { DAY_LETTERS, DAY_LONG, formatTime } from '../../lib/time'
import type { Day } from '../../lib/types'
import { FCE_HOURS_HELP } from '../../lib/fce'
import { activeFilterCount, EMPTY_FILTERS, MAX_HOURS_OPTIONS, MIN_RATING_OPTIONS, UNIT_BUCKETS, type Delivery, type Filters, type Level } from './filters'

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
}: {
  term: Term
  filters: Filters
  onChange(next: Filters): void
  heading?: boolean
  /** Show the FCE workload/rating filters (hidden when FCE data isn't loaded). */
  fceAvailable?: boolean
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

      <div className="flex flex-col gap-2">
        <Toggle checked={filters.fits} onChange={(v) => set('fits', v)}>
          Fits my schedule
        </Toggle>
        <Toggle checked={filters.saved} onChange={(v) => set('saved', v)}>
          Saved courses only
        </Toggle>
        <Toggle checked={filters.scheduledOnly} onChange={(v) => set('scheduledOnly', v)}>
          Has a scheduled time
        </Toggle>
      </div>

      {fceAvailable ? (
        <Group label="Workload and ratings">
          <div className="grid grid-cols-2 gap-2">
            <NumberSelect
              label="FCE hours at most"
              title={FCE_HOURS_HELP}
              value={filters.maxHours}
              options={MAX_HOURS_OPTIONS.map((h) => [h, `${h} a week`])}
              onChange={(v) => set('maxHours', v)}
            />
            <NumberSelect
              label="Course rating at least"
              title="Overall course rating from FCEs, 1 to 5"
              value={filters.minRating}
              options={MIN_RATING_OPTIONS.map((r) => [r, r.toFixed(1)])}
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
        <DepartmentPicker term={term} selected={filters.depts} onChange={(v) => set('depts', v)} />
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
    </div>
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

function NumberSelect({
  label,
  title,
  value,
  options,
  onChange,
}: {
  label: string
  title?: string
  value: number | null
  options: [number, string][]
  onChange(v: number | null): void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1" title={title}>
      <span className="text-[12px] text-muted">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`h-9 w-full rounded-md border bg-surface px-1.5 text-[13px] lg:h-8 ${value !== null ? 'border-ink font-medium text-ink' : 'border-line-strong text-ink-2'}`}
      >
        <option value="">Any</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
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

function DepartmentPicker({ term, selected, onChange }: { term: Term; selected: string[]; onChange(v: string[]): void }) {
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const q = normalize(query.trim())
    const matches = term.departments.filter(
      (d) => !q || normalize(d.name).includes(q) || normalize(d.code) === q || d.prefixes.some((p) => p.startsWith(q)),
    )
    // Selected departments float to the top so they stay visible.
    return [...matches.filter((d) => selected.includes(d.code)), ...matches.filter((d) => !selected.includes(d.code))]
  }, [term.departments, query, selected])

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
              <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[13px] hover:bg-surface-2">
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

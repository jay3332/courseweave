import type { CSSProperties } from 'react'
import { fmt } from './audit/format'
import type { DegreeProgress } from './progress'

// One green, deepening as work gets further along; this semester's share is striped (under way).
const FILL: Record<'done' | 'inProgress' | 'planned' | 'needed', CSSProperties> = {
  done: { background: 'var(--ok)' },
  inProgress: {
    background: 'repeating-linear-gradient(135deg, var(--ok) 0 3px, color-mix(in oklab, var(--ok) 50%, transparent) 3px 6px)',
  },
  planned: { background: 'color-mix(in oklab, var(--ok) 38%, transparent)' },
  needed: { background: 'var(--line)' },
}

/**
 * The plan's overall progress as one bar: done, in progress, planned and still needed. The bar fills only when the
 * plan reaches the unit total and meets every requirement. `outside` is units in the plan that the degree doesn't
 * count toward its total.
 */
export function DegreeProgressBar({ progress, outside = 0 }: { progress: DegreeProgress; outside?: number }) {
  const { done, credit, inProgress, planned, unitTarget, needed, requirementUnits, unmet } = progress
  const withPlan = done + inProgress + planned
  const scale = Math.max(withPlan + needed, 1e-9)
  const unitShort = unitTarget === null ? 0 : Math.max(0, unitTarget - withPlan)
  // The unmet requirements decide how much is left (an estimate), or the unit total does (exact).
  const forRequirements = requirementUnits > unitShort
  const requirements = (n: number) => `${n} unmet ${n === 1 ? 'requirement' : 'requirements'}`
  const neededNote = forRequirements
    ? `for ${requirements(unmet)}, estimated`
    : unitTarget !== null
      ? `to reach ${fmt(unitTarget)} units${unmet ? `, including ${requirements(unmet)}` : ''}`
      : null
  const status =
    needed > 0
      ? `${forRequirements ? 'About ' : ''}${fmt(needed)} more ${needed === 1 ? 'unit' : 'units'} to finish`
      : inProgress + planned > 0
        ? 'Everything is planned'
        : 'Complete'
  const segments = [
    { key: 'done', label: 'Done', value: done },
    { key: 'inProgress', label: 'In progress', value: inProgress },
    { key: 'planned', label: 'Planned', value: planned },
    { key: 'needed', label: 'Still needed', value: needed },
  ] as const
  const summary = segments
    .filter((s) => s.value > 0 || s.key === 'done')
    .map((s) => `${fmt(s.value)} units ${s.label.toLowerCase()}`)
    .join(', ')

  return (
    <div className="col-span-full grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-2 bg-surface px-3 pt-2.5 pb-3">
      <dt className="text-[12.5px] text-muted">Degree progress</dt>
      <dd className="text-right text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">{status}</span>
      </dd>
      <dd className="col-span-2">
        <div role="img" aria-label={`Degree progress: ${summary}.`} className="flex h-3 gap-[2px] overflow-hidden rounded-full">
          {segments.map((s) =>
            s.value > 0 ? (
              <div
                key={s.key}
                className="min-w-[3px]"
                // Shrinks in proportion when the plan goes past the target.
                style={{ ...FILL[s.key], flex: s.key === 'needed' ? '1 1 0' : `0 1 ${(s.value / scale) * 100}%` }}
              />
            ) : null,
          )}
        </div>
      </dd>
      <dd className="col-span-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          {segments.map((s) =>
            s.value > 0 || s.key === 'done' ? (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={FILL[s.key]} />
                {s.label}
                <span className="font-semibold text-ink tabular-nums">{fmt(s.value)}</span>
                {s.key === 'done' && credit > 0 ? <span className="text-muted">({fmt(credit)} from AP and transfer credit)</span> : null}
                {s.key === 'needed' && neededNote ? <span className="text-muted">({neededNote})</span> : null}
              </li>
            ) : null,
          )}
          {outside > 0 ? (
            <li className="text-muted">
              {fmt(outside)} {outside === 1 ? 'unit' : 'units'} in this plan {outside === 1 ? "doesn't" : "don't"} count toward the degree
            </li>
          ) : null}
        </ul>
      </dd>
    </div>
  )
}

import { FCE_HOURS_HELP, WORKLOAD_TONE_CLASS, WORKLOAD_TONE_LABEL, formatHours, useFceAccess, useFceSummary, workloadRatio, workloadTone } from '../../lib/fce'
import type { ResolvedEntry } from '../../state/schedule-view'
import { useTerm } from '../../state/term'
import { FceSignIn } from './FceSignIn'
import { WorkloadMeter } from './WorkloadMeter'
import { scheduleLoad } from './workload'

/**
 * Expected weekly workload of a schedule from FCE hours, next to what its units suggest.
 * Courses without FCE hours count at what their units suggest, and are listed so the estimate's gaps show.
 * With minis, each half of the term is shown separately (full-semester courses plus that half's minis, whose
 * units count double per week while they run) and the heavier half is highlighted.
 */
export function ScheduleWorkload({ entries, compact = false }: { entries: ResolvedEntry[]; compact?: boolean }) {
  const term = useTerm()
  const data = useFceSummary()
  const access = useFceAccess()
  if (!entries.some((e) => !e.entry.hidden)) return null
  if (access === 'locked') {
    return (
      <section aria-label="Expected workload" className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold text-ink">Expected workload</h3>
        <FceSignIn compact />
      </section>
    )
  }
  if (data === undefined || data === null) return null

  const load = scheduleLoad(entries, term.meta.minis, data.courses)
  const missing = load.rows.filter((r) => r.hours === null)
  const peak = load.halves && load.peak !== null ? load.halves[load.peak] : null
  // Compare against what the units suggest in the busiest stretch of the term.
  const tone = peak ? workloadTone(peak.load.expected ? peak.load.hours / peak.load.expected : null) : workloadTone(workloadRatio(load.total, load.units))

  return (
    <section aria-labelledby="workload-heading" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="workload-heading" className="text-[14px] font-semibold text-ink" title={FCE_HOURS_HELP}>
          Expected workload
        </h3>
        <p className="text-[13px] text-muted" title={peak ? `The busier half of the term, ${peak.mini.name}` : undefined}>
          <span className="display text-[22px] text-ink">{formatHours(peak ? peak.load.hours : load.total)}</span> h/wk{peak ? ' at peak' : ''} for {load.units} units
        </p>
      </div>
      {tone ? <p className={`mt-0.5 text-[12.5px] ${WORKLOAD_TONE_CLASS[tone]}`}>{WORKLOAD_TONE_LABEL[tone].replace('its units', 'your units')}</p> : null}

      {load.halves ? (
        <ul className="mt-2 grid grid-cols-2 gap-2" aria-label="Workload by half of the term">
          {load.halves.map((h, i) => {
            const heavier = i === load.peak
            return (
              <li
                key={h.mini.number}
                className={`rounded-md border px-2.5 py-1.5 ${heavier ? 'border-ink-2 bg-surface-2' : 'border-line'}`}
                title={`${h.mini.name}: full-semester courses plus ${h.mini.name} minis. Their units suggest about ${formatHours(h.load.expected)} hours a week, counting mini units twice since minis run half the semester.`}
              >
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className={heavier ? 'font-semibold text-ink' : 'text-ink-2'}>{h.mini.name} half</span>
                  {heavier ? <span className="text-[11px] font-semibold text-ink-2">Heavier</span> : null}
                </div>
                <div className="text-[13px] tabular-nums">
                  <span className={`font-semibold ${heavier ? 'text-ink' : 'text-ink-2'}`}>{formatHours(h.load.hours)}</span>
                  <span className="text-muted"> h/wk, units suggest {formatHours(h.load.expected)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {compact ? null : (
        <ul className="mt-2 space-y-1.5">
          {load.rows.map(({ entry: e, hours, mini }) => {
            const miniName = mini !== null ? term.meta.minis.find((m) => m.number === mini)?.name : null
            return (
              <li key={e.course.id} className="grid grid-cols-[4rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[12.5px]">
                <span className="course-code text-[13px] text-ink">{e.course.code}</span>
                {hours !== null ? <WorkloadMeter hours={hours} units={e.course.units} mini={mini !== null} /> : <span className="text-muted">No FCE hours</span>}
                <span className="text-right text-ink-2 tabular-nums" title={miniName ? `${miniName}: runs half the semester, so its units count double per week` : undefined}>
                  {hours !== null ? formatHours(hours) : '—'}
                  <span className="text-muted">
                    /{e.course.units ?? 'VAR'}
                    {mini !== null ? 'u mini' : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-muted">
        FCE hours include class time.
        {load.halves ? ' Minis count only in their half, at twice their units per week; official units don’t change.' : ''}
        {missing.length
          ? ` ${missing.length} ${missing.length === 1 ? 'course has' : 'courses have'} no FCE hours and ${missing.length === 1 ? 'counts' : 'count'} at what its units suggest.`
          : ' Every course has FCE hours.'}
        {load.rows.some((r) => r.entry.course.units === null) ? ' Variable-unit courses add no units.' : ''}
      </p>
    </section>
  )
}

import { FCE_HOURS_HELP, WORKLOAD_TONE_CLASS, WORKLOAD_TONE_LABEL, formatHours, useFceSummary, workloadRatio, workloadTone } from '../../lib/fce'
import type { ResolvedEntry } from '../../state/schedule-view'
import { WorkloadMeter } from './WorkloadMeter'

/**
 * Expected weekly workload of a schedule from FCE hours, next to its units.
 * Courses without FCE hours count as 1 hour per unit, and are listed so the estimate's gaps are visible.
 */
export function ScheduleWorkload({ entries, compact = false }: { entries: ResolvedEntry[]; compact?: boolean }) {
  const data = useFceSummary()
  const visible = entries.filter((e) => !e.entry.hidden)
  if (data === undefined || data === null || !visible.length) return null

  const rows = visible.map((e) => {
    const s = data.courses.get(e.course.id)
    return { e, hours: s?.hours ?? null }
  })
  const units = visible.reduce((n, e) => n + (e.course.units ?? 0), 0)
  const reported = rows.filter((r) => r.hours !== null)
  const missing = rows.filter((r) => r.hours === null)
  const estimate = reported.reduce((n, r) => n + r.hours!, 0) + missing.reduce((n, r) => n + (r.e.course.units ?? 0), 0)
  const tone = workloadTone(workloadRatio(estimate, units))

  return (
    <section aria-labelledby="workload-heading" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="workload-heading" className="text-[14px] font-semibold text-ink" title={FCE_HOURS_HELP}>
          Expected workload
        </h3>
        <p className="text-[13px] text-muted">
          <span className="display text-[22px] text-ink">{formatHours(estimate)}</span> h/wk for {units} units
        </p>
      </div>
      {tone ? <p className={`mt-0.5 text-[12.5px] ${WORKLOAD_TONE_CLASS[tone]}`}>{WORKLOAD_TONE_LABEL[tone].replace('its units', 'your units')}</p> : null}

      {compact ? null : (
        <ul className="mt-2 space-y-1.5">
          {rows.map(({ e, hours }) => (
            <li key={e.course.id} className="grid grid-cols-[4rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-[12.5px]">
              <span className="course-code text-[13px] text-ink">{e.course.code}</span>
              {hours !== null ? <WorkloadMeter hours={hours} units={e.course.units} /> : <span className="text-muted">No FCE hours</span>}
              <span className="text-right text-ink-2 tabular-nums">
                {hours !== null ? formatHours(hours) : '—'}
                <span className="text-muted">/{e.course.units ?? 'VAR'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-muted">
        FCE hours include class time. {missing.length ? `${missing.length} ${missing.length === 1 ? 'course has' : 'courses have'} no FCE hours and ${missing.length === 1 ? 'counts' : 'count'} as 1 hour per unit.` : 'Every course has FCE hours.'}
        {visible.some((e) => e.course.units === null) ? ' Variable-unit courses add no units.' : ''}
      </p>
    </section>
  )
}

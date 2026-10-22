// Modal that enumerates conflict-free section combinations for the active schedule's courses
// and applies the chosen one (store.setSections) or saves it as a new schedule.
import { coursePreview } from '../../components/CoursePreview'
import { ChevronLeft, ChevronRight, Lock, LockOpen } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { WeekGrid, type CalendarBlock } from '../../components/WeekGrid'
import { Button, Chip, Dialog, IconButton, Tag } from '../../components/ui'
import { courseColorStyle } from '../../lib/colors'
import { DEFAULT_LUNCH, DEFAULT_PREFERENCES, generateSchedules, type Choice, type GeneratedSchedule, type GenerateResult, type Preferences } from '../../lib/generator'
import { meetingSummary } from '../../lib/ics'
import { allSelections, resolveSelection, selectionParts } from '../../lib/sections'
import { DAY_LONG, DAY_SHORT, formatTime } from '../../lib/time'
import type { Day, Section } from '../../lib/types'
import { partBlocks, partLabel, sectionCounts } from '../planner/format'
import { PHONE_FULLSCREEN } from './dialog'
import { useActiveScheduleId, useScheduleView, type ResolvedEntry } from '../../state/schedule-view'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'

export function ScheduleGenerator({ open, onClose }: { open: boolean; onClose(): void }) {
  // Preferences outlive the dialog so reopening keeps them.
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES)
  return (
    <Dialog open={open} onClose={onClose} title="Generate schedules" className={`w-[min(96vw,1080px)]! ${PHONE_FULLSCREEN}`}>
      <GeneratorBody prefs={prefs} onPrefsChange={setPrefs} onDone={onClose} />
    </Dialog>
  )
}

const START_OPTIONS = [8 * 60, 8 * 60 + 30, 9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 30, 11 * 60, 12 * 60]
const END_OPTIONS = [14, 15, 16, 17, 18, 19, 20, 21].map((h) => h * 60)
const WEEKDAYS: Day[] = [0, 1, 2, 3, 4]
const LIST_LIMIT = 50

function GeneratorBody({ prefs, onPrefsChange, onDone }: { prefs: Preferences; onPrefsChange(p: Preferences): void; onDone(): void }) {
  const term = useTerm()
  const view = useScheduleView()
  const scheduleId = useActiveScheduleId()
  const setSections = useStore((s) => s.setSections)
  const createSchedule = useStore((s) => s.createSchedule)

  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(view.entries.filter((e) => e.entry.hidden).map((e) => e.course.id)))
  const [locked, setLocked] = useState<Set<string>>(() => new Set())

  const included = useMemo(() => view.entries.filter((e) => !excluded.has(e.course.id)), [view.entries, excluded])
  const minis = useMemo(() => term.meta.minis.map((m) => m.number), [term])

  const outcome = useMemo(
    () =>
      generateSchedules(
        included.map((e) => {
          const all = allSelections(e.course)
          // A lock keeps the current lecture, and its recitation if one is chosen.
          const options =
            locked.has(e.course.id) && e.section
              ? all.filter((o) => o.section === e.section && (!e.child || o.child === e.child))
              : all
          return {
            courseId: e.course.id,
            options,
            preferred: e.section ? { section: e.section.name, child: e.child?.name ?? null } : null,
          }
        }),
        prefs,
        { minis },
      ),
    [included, locked, prefs, minis],
  )

  const [pick, setPick] = useState<{ outcome: GenerateResult | null; index: number }>({ outcome: null, index: 0 })
  const index = pick.outcome === outcome ? Math.min(pick.index, Math.max(0, outcome.results.length - 1)) : 0
  const select = (i: number) => setPick({ outcome, index: i })
  const result = outcome.results[index] ?? null

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  if (!view.entries.length) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="mx-auto max-w-md text-ink-2">
          Your schedule has no courses yet. Add the courses you want to take, then come back to see every arrangement of their sections that fits together.
        </p>
        <Button className="mt-5" onClick={onDone}>
          Close
        </Button>
      </div>
    )
  }

  const apply = () => {
    if (!result || !scheduleId) return
    setSections(scheduleId, result.sections)
    onDone()
  }

  const saveAsNew = () => {
    if (!result || !view.schedule) return
    createSchedule(
      term.meta.id,
      `${view.schedule.name} (option ${index + 1})`,
      view.schedule.entries.map((e) => (result.sections[e.courseId] ? { ...e, ...result.sections[e.courseId] } : { ...e })),
    )
    onDone()
  }

  return (
    <div className="grid gap-0 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-6 border-b border-line p-4 sm:p-5 md:border-r md:border-b-0">
        <section aria-labelledby="gen-courses">
          <h3 id="gen-courses" className="mb-2 text-[15px] font-semibold">
            Courses
          </h3>
          <ul className="space-y-1">
            {view.entries.map((e) => (
              <CourseRow
                key={e.course.id}
                item={e}
                included={!excluded.has(e.course.id)}
                locked={locked.has(e.course.id)}
                onInclude={() => setExcluded((s) => toggle(s, e.course.id))}
                onLock={() => setLocked((s) => toggle(s, e.course.id))}
              />
            ))}
          </ul>
        </section>

        <section aria-labelledby="gen-prefs" className="space-y-4">
          <h3 id="gen-prefs" className="text-[15px] font-semibold">
            Preferences
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <TimeSelect
              label="Start no earlier than"
              value={prefs.earliestStart}
              options={START_OPTIONS}
              onChange={(earliestStart) => onPrefsChange({ ...prefs, earliestStart })}
            />
            <TimeSelect label="End no later than" value={prefs.latestEnd} options={END_OPTIONS} onChange={(latestEnd) => onPrefsChange({ ...prefs, latestEnd })} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] text-ink-2">Days I'd rather keep free</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <Chip
                  key={d}
                  title={DAY_LONG[d]}
                  selected={prefs.daysOff.includes(d)}
                  onClick={() =>
                    onPrefsChange({ ...prefs, daysOff: prefs.daysOff.includes(d) ? prefs.daysOff.filter((x) => x !== d) : [...prefs.daysOff, d] })
                  }
                >
                  {DAY_SHORT[d]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-[13px] text-ink-2">Prefer</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={prefs.minimizeGaps} onClick={() => onPrefsChange({ ...prefs, minimizeGaps: !prefs.minimizeGaps })} title="Rank back-to-back classes higher">
                Fewer gaps
              </Chip>
              <Chip
                selected={prefs.lunch !== null}
                onClick={() => onPrefsChange({ ...prefs, lunch: prefs.lunch ? null : DEFAULT_LUNCH })}
                title={`${DEFAULT_LUNCH.minutes} free minutes between ${formatTime(DEFAULT_LUNCH.start)} and ${formatTime(DEFAULT_LUNCH.end)}`}
              >
                Time for lunch
              </Chip>
              <Chip selected={prefs.fewerDays} onClick={() => onPrefsChange({ ...prefs, fewerDays: !prefs.fewerDays })}>
                Fewer days on campus
              </Chip>
            </div>
          </fieldset>
        </section>
      </aside>

      <div className="min-w-0 p-4 sm:p-5">
        {!included.length ? (
          <Notice>Include at least one course to generate schedules.</Notice>
        ) : !outcome.results.length ? (
          <NoResults outcome={outcome} entries={included} anyLocked={included.some((e) => locked.has(e.course.id))} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-[15px]">
                <span className="font-semibold">{outcome.found.toLocaleString()}</span> {outcome.found === 1 ? 'arrangement fits' : 'arrangements fit'}, best match
                first{outcome.found > outcome.results.length ? ` (showing the top ${outcome.results.length.toLocaleString()})` : ''}.
              </p>
              <div className="ml-auto flex items-center gap-1">
                <IconButton label="Previous option" size="sm" disabled={index === 0} onClick={() => select(index - 1)}>
                  <ChevronLeft />
                </IconButton>
                <span className="min-w-24 text-center text-[13px] text-ink-2" aria-live="polite">
                  Option {index + 1} of {outcome.results.length.toLocaleString()}
                </span>
                <IconButton label="Next option" size="sm" disabled={index >= outcome.results.length - 1} onClick={() => select(index + 1)}>
                  <ChevronRight />
                </IconButton>
              </div>
            </div>
            {outcome.truncated ? (
              <p className="mt-1 text-[13px] text-warn">
                Stopped after checking {outcome.found.toLocaleString()} combinations, so a better one may exist. Lock a course to narrow the search.
              </p>
            ) : null}
            {included.length === 1 ? <p className="mt-1 text-[13px] text-muted">With one course, these are its sections ranked by your preferences.</p> : null}

            {result ? (
              <ResultView result={result} entries={included} prefs={prefs} />
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={apply} disabled={!result || !scheduleId}>
                Apply to this schedule
              </Button>
              <Button onClick={saveAsNew} disabled={!result}>
                Save as new schedule
              </Button>
            </div>

            {outcome.results.length > 1 ? (
              <section aria-labelledby="gen-list" className="mt-6">
                <h3 id="gen-list" className="mb-2 text-[15px] font-semibold">
                  Top matches
                </h3>
                <ol className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line scrollbar-thin">
                  {outcome.results.slice(0, LIST_LIMIT).map((r, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        aria-current={i === index}
                        onClick={() => select(i)}
                        className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[13px] ${
                          i === index ? 'bg-accent-soft' : 'hover:bg-surface-2'
                        }`}
                      >
                        <span className="w-16 shrink-0 font-semibold">Option {i + 1}</span>
                        <span className="flex flex-wrap gap-1.5">
                          {summaryTags(r, prefs).map((t) => (
                            <Tag key={t.text} className={t.bad ? 'border-warn/40 text-warn' : ''}>
                              {t.text}
                            </Tag>
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {outcome.results.length > LIST_LIMIT ? (
                  <p className="mt-1.5 text-[12.5px] text-muted">Showing the top {LIST_LIMIT}. Use the arrows to browse the rest.</p>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/** "Lec 1, Rec F" for a choice. */
function choiceLabel(choice: { section: Section | null; child: Section | null }): string {
  if (!choice.section) return 'No section'
  return choice.child ? `${partLabel(choice.section)}, ${partLabel(choice.child)}` : partLabel(choice.section)
}

function CourseRow({ item, included, locked, onInclude, onLock }: { item: ResolvedEntry; included: boolean; locked: boolean; onInclude(): void; onLock(): void }) {
  const { course, section, entry } = item
  const id = `gen-include-${course.id}`
  const choices = allSelections(course).length
  const canLock = section !== null && choices > 1
  const current = choiceLabel(item)
  return (
    <li className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${included ? '' : 'opacity-55'}`} style={courseColorStyle(entry.color)}>
      <input id={id} type="checkbox" checked={included} onChange={onInclude} className="size-4 shrink-0 accent-[var(--accent)]" />
      <span aria-hidden className="course-swatch h-4 w-1 shrink-0 rounded-full" />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span {...coursePreview(course.code)} className="course-code text-[14px]">{course.code}</span>{' '}
        <span className="text-[12.5px] text-muted">{locked && section ? `keeping ${current}` : sectionCounts(course)}</span>
        <span className="block truncate text-[12.5px] text-ink-2">{course.title}</span>
      </label>
      <IconButton
        size="sm"
        label={
          !canLock
            ? choices <= 1
              ? 'Only one option'
              : 'Choose a section on your schedule to keep it'
            : locked
              ? `Let the generator change ${course.code}'s sections`
              : `Keep ${course.code} in ${current}`
        }
        active={locked}
        aria-pressed={locked}
        disabled={!canLock || !included}
        onClick={onLock}
      >
        {locked ? <Lock /> : <LockOpen />}
      </IconButton>
    </li>
  )
}

function TimeSelect({ label, value, options, onChange }: { label: string; value: number | null; options: number[]; onChange(v: number | null): void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] text-ink-2">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[14px] text-ink"
      >
        <option value="">Any time</option>
        {options.map((m) => (
          <option key={m} value={m}>
            {formatTime(m)}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

function summaryTags(r: GeneratedSchedule, prefs: Preferences): { text: string; bad: boolean }[] {
  const b = r.breakdown
  const tags = [
    { text: `${b.daysOnCampus} ${b.daysOnCampus === 1 ? 'day' : 'days'} on campus`, bad: false },
    { text: b.gapMinutes ? `${formatDuration(b.gapMinutes)} between classes` : 'No gaps', bad: false },
  ]
  if (prefs.earliestStart !== null) {
    tags.push(
      b.earlyClasses
        ? { text: `${b.earlyClasses} before ${formatTime(prefs.earliestStart)}`, bad: true }
        : { text: `Nothing before ${formatTime(prefs.earliestStart)}`, bad: false },
    )
  }
  if (prefs.latestEnd !== null) {
    tags.push(
      b.lateClasses
        ? { text: `${b.lateClasses} after ${formatTime(prefs.latestEnd)}`, bad: true }
        : { text: `Done by ${formatTime(prefs.latestEnd)}`, bad: false },
    )
  }
  for (const d of prefs.daysOff) {
    tags.push(b.daysOffUsed.includes(d) ? { text: `Class on ${DAY_SHORT[d]}`, bad: true } : { text: `${DAY_SHORT[d]} free`, bad: false })
  }
  if (prefs.lunch) {
    tags.push(
      b.lunchBlockedDays
        ? { text: `No lunch break ${b.lunchBlockedDays} ${b.lunchBlockedDays === 1 ? 'day' : 'days'}`, bad: true }
        : { text: 'Lunch break daily', bad: false },
    )
  }
  return tags
}

function ResultView({ result, entries, prefs }: { result: GeneratedSchedule; entries: ResolvedEntry[]; prefs: Preferences }) {
  const rows = entries.map((e) => {
    const pick: Choice | undefined = result.sections[e.course.id]
    const chosen = pick ? resolveSelection(e.course, pick.section, pick.child) : { section: null, child: null, needsChild: false }
    return { ...e, chosen }
  })
  const blocks: CalendarBlock[] = rows.flatMap((r) => selectionParts(r.chosen).flatMap((part) => partBlocks(r.course, part, r.entry.color)))

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {summaryTags(result, prefs).map((t) => (
          <Tag key={t.text} className={t.bad ? 'border-warn/40 text-warn' : ''}>
            {t.text}
          </Tag>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-surface">
        <WeekGrid blocks={blocks} compact hourHeight={30} empty={<p className="text-[13px] text-muted">None of these sections have scheduled times.</p>} />
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((row) => {
          const { course, entry, chosen } = row
          const was = choiceLabel(row)
          const now = choiceLabel(chosen)
          const changed = row.section?.name !== chosen.section?.name || (row.child?.name ?? null) !== (chosen.child?.name ?? null)
          const alternatives = result.alternatives[course.id]
          return (
            <li key={course.id} className="flex items-start gap-3 px-3 py-2" style={courseColorStyle(entry.color)}>
              <span aria-hidden className="course-swatch mt-1 h-4 w-1 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span {...coursePreview(course.code)} className="course-code text-[14px]">{course.code}</span>
                  <span className="font-medium">{now}</span>
                  {changed ? (
                    <span className="rounded bg-accent-soft px-1.5 text-[12px] font-medium text-accent">{row.section ? `was ${was}` : 'new pick'}</span>
                  ) : (
                    <span className="text-[12px] text-muted">unchanged</span>
                  )}
                </div>
                {selectionParts(chosen).map((part) => (
                  <div key={part.name} className="text-[12.5px] text-ink-2">
                    {selectionParts(chosen).length > 1 ? `${partLabel(part)}: ` : ''}
                    {meetingSummary(part)}
                  </div>
                ))}
                {!chosen.section ? <div className="text-[12.5px] text-ink-2">TBA</div> : null}
                {alternatives ? (
                  <div className="text-[12px] text-muted">
                    Same times: {alternatives.map((alt) => choiceLabel(resolveSelection(course, alt.section, alt.child))).join('; ')}
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NoResults({ outcome, entries, anyLocked }: { outcome: GenerateResult; entries: ResolvedEntry[]; anyLocked: boolean }) {
  const code = (id: string) => entries.find((e) => e.course.id === id)?.course.code ?? id
  return (
    <Notice>
      <p className="font-semibold">No arrangement of these sections avoids conflicts.</p>
      {outcome.blockingPairs.length ? (
        <ul className="mt-2 space-y-1 text-ink-2">
          {outcome.blockingPairs.map(([a, b]) => (
            <li key={`${a}-${b}`}>
              <span className="course-code">{code(a)}</span> and <span className="course-code">{code(b)}</span> overlap in every section you allowed.
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-ink-2">
        {anyLocked ? 'Unlock a course or leave one out to find more options.' : 'Leave a course out to see what fits with the rest.'}
      </p>
    </Notice>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-surface-2 px-4 py-5 text-[14px]">{children}</div>
}

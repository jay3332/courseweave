import { AlertTriangle, Info, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui'
import { HEAVY_UNITS } from '../../lib/plan'
import { childSections, topSections } from '../../lib/sections'
import type { MiniMeta } from '../../lib/types'
import { useScheduleView, type ResolvedEntry, type ScheduleView } from '../../state/schedule-view'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { ExportMenu } from '../schedule-tools/ExportMenu'
import { ScheduleGenerator } from '../schedule-tools/ScheduleGenerator'
import { SharedScheduleImport } from '../schedule-tools/SharedScheduleImport'
import { AddCourseSearch } from './AddCourseSearch'
import { CourseEntryRow } from './CourseEntryRow'
import { childForSection, FACTORABLE_HELP, partLabel, plural } from './format'
import { useMediaQuery } from './hooks'
import { PlannerCalendar } from './PlannerCalendar'
import { SavedCourses } from './SavedCourses'
import { ScheduleTabs } from './ScheduleTabs'
import type { CalendarSelection, Preview } from './types'
import { UnscheduledList } from './UnscheduledList'
import { ScheduleWorkload } from '../fce/ScheduleWorkload'
import { ScheduleRequisiteSummary } from '../record/ScheduleRequisiteSummary'

export function SchedulePage() {
  const term = useTerm()
  const termId = term.meta.id
  const view = useScheduleView()
  const scheduleId = view.schedule?.id ?? null
  const setSection = useStore((s) => s.setSection)
  const setChild = useStore((s) => s.setChild)

  const [selected, setSelected] = useState<CalendarSelection | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mini, setMini] = useState<number | null>(null)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const desktop = useMediaQuery('(min-width: 900px)')
  const narrow = useMediaQuery('(max-width: 520px)')

  // Switching schedules drops any selection or preview from the previous one.
  const [shownScheduleId, setShownScheduleId] = useState(scheduleId)
  if (shownScheduleId !== scheduleId) {
    setShownScheduleId(scheduleId)
    setSelected(null)
    setPreview(null)
  }

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      // Popovers handle their own Escape and mark it handled.
      if (e.key === 'Escape' && !e.defaultPrevented) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const previewCourse = useCallback((courseId: string | null) => setPreview(courseId ? { courseId, sections: null } : null), [])

  const conflictCount = [...view.conflicts.values()].reduce((n, list) => n + list.length, 0) / 2
  const selectedEntry = selected ? view.entries.find((e) => e.course.id === selected.courseId && !e.entry.hidden) : undefined
  const unplaced = view.entries.filter((e) => !e.entry.hidden && !e.section).length

  const switchSection = (courseId: string, name: string) => {
    const course = term.courseById.get(courseId)
    if (!scheduleId || !course) return
    setSection(scheduleId, courseId, name, childForSection(course, name, view))
  }

  const search = scheduleId ? <AddCourseSearch view={view} scheduleId={scheduleId} onPreview={previewCourse} /> : null

  const emptyMessage =
    view.entries.length === 0 ? (
      <div className="max-w-xs rounded-xl border border-line bg-surface px-5 py-4 text-center shadow-sm">
        <p className="display text-xl text-ink">Nothing scheduled yet</p>
        <p className="mt-1.5 text-[13.5px] text-ink-2">
          Search for a course {desktop ? 'on the left' : 'above'} to add it here, or{' '}
          <Link to={`/${termId}/courses`} className="font-medium text-accent underline underline-offset-2">
            browse all courses
          </Link>
          .
        </p>
      </div>
    ) : unplaced > 0 ? (
      <p className="max-w-xs rounded-xl border border-line bg-surface px-5 py-4 text-center text-[13.5px] text-ink-2 shadow-sm">
        Choose a section for each course to place it on the calendar.
      </p>
    ) : null

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">Schedule planner</h1>
      <SharedScheduleImport />
      <ScheduleGenerator open={generatorOpen} onClose={() => setGeneratorOpen(false)} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto min-[900px]:grid min-[900px]:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] min-[900px]:grid-rows-[minmax(0,1fr)] min-[900px]:overflow-hidden">
        <aside
          aria-label="Courses in this schedule"
          className="scrollbar-thin order-2 flex flex-col border-t border-line bg-surface min-[900px]:order-1 min-[900px]:h-full min-[900px]:overflow-y-auto min-[900px]:border-t-0 min-[900px]:border-r"
        >
          {desktop ? <div className="sticky top-0 z-30 border-b border-line bg-surface px-4 py-3">{search}</div> : null}

          {scheduleId ? <SavedCourses view={view} scheduleId={scheduleId} onPreview={previewCourse} /> : null}

          <section aria-labelledby="schedule-courses" className="flex-1 px-2 py-3">
            <h2 id="schedule-courses" className="mb-1 px-2 text-[13px] font-semibold text-ink-2">
              Courses
            </h2>
            {view.entries.length && scheduleId ? (
              <ul className="flex flex-col gap-0.5">
                {view.entries.map((resolved) => (
                  <CourseEntryRow
                    key={resolved.course.id}
                    resolved={resolved}
                    view={view}
                    scheduleId={scheduleId}
                    termId={termId}
                    selected={selected?.courseId === resolved.course.id}
                    onSelect={() => setSelected((s) => (s?.courseId === resolved.course.id ? null : { courseId: resolved.course.id, level: 'section' }))}
                    onPreview={setPreview}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 text-[13.5px] text-muted">Courses you add show up here, with their sections and any time conflicts.</p>
            )}
          </section>

          {view.entries.length ? (
            <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
              <ScheduleRequisiteSummary entries={view.entries} termId={termId} />
              <ScheduleWorkload entries={view.entries} />
            </div>
          ) : null}

          <UnitsFooter view={view} conflictCount={conflictCount} />
        </aside>

        <section aria-label="Weekly calendar" className="order-1 flex flex-col min-[900px]:order-2 min-[900px]:h-full min-[900px]:min-h-0">
          <ScheduleTabs />

          {/* On phones the search sits above the calendar so its preview is visible. */}
          {!desktop ? <div className="sticky top-0 z-30 border-b border-line bg-surface px-3 py-2">{search}</div> : null}

          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
            {term.meta.minis.length ? <SessionFilter minis={term.meta.minis} value={mini} onChange={setMini} /> : null}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={() => setGeneratorOpen(true)} disabled={view.entries.length === 0}>
                <WandSparkles aria-hidden className="size-4" />
                <span className="hidden min-[400px]:inline">Generate schedules</span>
                <span className="min-[400px]:hidden">Generate</span>
              </Button>
              {view.schedule ? <ExportMenu schedule={view.schedule} /> : null}
            </div>
          </div>

          <div className="scrollbar-thin px-2 pt-2 pb-8 sm:px-4 min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:overflow-y-auto">
            {term.meta.notes?.length ? (
              <div className="mb-2 flex gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                <div className="space-y-0.5">
                  {term.meta.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </div>
            ) : null}

            {selected && selectedEntry ? <SelectionBanner selection={selected} entry={selectedEntry} onDone={() => setSelected(null)} /> : null}

            <div className="rounded-xl border border-line bg-surface p-1 sm:p-2">
              <PlannerCalendar
                view={view}
                selected={selected}
                onSelect={setSelected}
                onSwitchSection={switchSection}
                onSwitchChild={(courseId, name) => scheduleId && setChild(scheduleId, courseId, name)}
                preview={preview}
                mini={mini}
                compact={narrow}
                hourHeight={desktop ? 54 : 44}
                empty={emptyMessage}
              />
            </div>

            <UnscheduledList view={view} termId={termId} />
          </div>
        </section>
      </div>
    </div>
  )
}

function SelectionBanner({ selection, entry, onDone }: { selection: CalendarSelection; entry: ResolvedEntry; onDone(): void }) {
  const { course, section, child } = entry
  const code = <span className="course-code text-[15px] text-ink">{course.code}</span>
  let message
  if (selection.level === 'child' && section) {
    const others = childSections(course, section.name).length - (child ? 1 : 0)
    message = others ? (
      <>
        Showing other recitations of {code} {partLabel(section)} as outlines. Click one to switch.
      </>
    ) : (
      <>
        {code} {partLabel(section)} has only one recitation.
      </>
    )
  } else {
    const tops = topSections(course)
    const noun = tops.every((s) => s.kind === 'lecture') ? 'lecture' : 'section'
    message =
      tops.length > 1 ? (
        <>
          Showing other {noun}s of {code} as outlines. Click one to switch{child ? '; a recitation that fits comes with it' : ''}.
        </>
      ) : (
        <>
          {code} has only one {noun}.
        </>
      )
  }
  return (
    <div role="status" className="mb-2 flex items-center gap-3 rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13.5px] text-ink-2">
      <p className="min-w-0 flex-1">{message}</p>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

function UnitsFooter({ view, conflictCount }: { view: ScheduleView; conflictCount: number }) {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = useId()
  const { total, factorable, nonFactorable, hasVariable } = view.units

  return (
    <footer className="sticky bottom-0 z-20 mt-auto border-t border-line bg-surface px-4 py-3">
      {helpOpen ? (
        <p id={helpId} className="mb-2 rounded-md bg-surface-2 px-2.5 py-2 text-[12.5px] text-ink-2">
          {FACTORABLE_HELP}
        </p>
      ) : null}
      <div className="flex items-end gap-4">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="display text-[34px] leading-none text-ink">{total}</span>
            <span className="text-[13px] text-muted">{hasVariable ? 'units plus variable' : total === 1 ? 'unit' : 'units'}</span>
          </p>
          {view.entries.length ? (
            <p className="mt-1 flex flex-wrap items-center text-[12.5px] text-ink-2">
              <span>
                <span className="font-semibold text-ink">{factorable}</span> factorable
              </span>
              {nonFactorable ? (
                <span>
                  ,&nbsp;<span className="font-semibold text-ink">{nonFactorable}</span> pass/fail
                </span>
              ) : null}
              <button
                type="button"
                aria-expanded={helpOpen}
                aria-controls={helpOpen ? helpId : undefined}
                aria-label="What are factorable units?"
                title="What are factorable units?"
                onClick={() => setHelpOpen((o) => !o)}
                className="ml-1 inline-grid size-6 place-items-center rounded text-muted hover:text-ink"
              >
                <Info aria-hidden className="size-3.5" />
              </button>
            </p>
          ) : null}
          {factorable > HEAVY_UNITS ? (
            <p className="mt-1 flex items-start gap-1 text-[12.5px] text-warn">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Over {HEAVY_UNITS} factorable units, which usually needs your college&rsquo;s approval. <span className="text-muted">Guidance, not policy.</span>
              </span>
            </p>
          ) : null}
        </div>
        <div className="ml-auto shrink-0 text-right text-[13px] leading-snug">
          <p className="text-muted">{plural(view.entries.length, 'course')}</p>
          {conflictCount > 0 ? (
            <p className="flex items-center justify-end gap-1 font-medium text-danger">
              <AlertTriangle aria-hidden className="size-3.5" />
              {plural(conflictCount, 'conflict')}
            </p>
          ) : view.entries.length ? (
            <p className="text-ok">No conflicts</p>
          ) : null}
        </div>
      </div>
    </footer>
  )
}

function SessionFilter({ minis, value, onChange }: { minis: MiniMeta[]; value: number | null; onChange(mini: number | null): void }) {
  const options = [{ value: null, label: 'Full semester' }, ...minis.map((m) => ({ value: m.number as number | null, label: m.name }))]
  return (
    <div role="radiogroup" aria-label="Session" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
            value === o.value ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

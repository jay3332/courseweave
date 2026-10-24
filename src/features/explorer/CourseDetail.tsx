import { coursePreview } from '../../components/CoursePreview'
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, ChevronDown, Info, KeyRound, Maximize2, Plus, Star, UsersRound, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { HoverCard } from '../../components/HoverCard'
import { Button } from '../../components/ui'
import { WeekGrid, type CalendarBlock } from '../../components/WeekGrid'
import { isUnscheduled } from '../../lib/blocks'
import { nextColor } from '../../lib/colors'
import { instructorSlug } from '../../lib/data'
import { departmentName, modeLabel } from '../../lib/departments'
import { childSections, resolveSelection, selectionParts, topSections, type Selection } from '../../lib/sections'
import { reservationCodes, reservationSummary } from '../../lib/reservations'
import { sameCourseTitle } from '../../lib/substitutes'
import { formatDays, formatLocation, formatTimeRange } from '../../lib/time'
import type { Course, Section } from '../../lib/types'
import { partsConflict, useActiveScheduleId, useScheduleView, type ResolvedEntry } from '../../state/schedule-view'
import { useBookmarks, useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { childForSection, initialChoice, joinList, PASS_FAIL_ONLY_HELP, partBlocks, partLabel, sectionCounts } from '../planner/format'
import { CountsToward } from './CountsToward'
import { courseMini, miniName, unitsText } from './summary'
import { CourseAbout } from '../catalog/CourseAbout'
import { CourseFcePanel } from '../fce/CourseFcePanel'
import { InstructorFceBadge } from '../fce/InstructorFceBadge'
import { statusFnFor } from '../record/check-summary'
import { useRequisiteContext } from '../record/context'
import { RequisiteStatus } from '../record/RequisiteStatus'

function codeOf(id: string) {
  return `${id.slice(0, 2)}-${id.slice(2)}`
}

/** Recitation lists longer than this start collapsed. */
const COLLAPSE_AFTER = 6

/** Schedule state for one course: its entry, add/switch/remove, and the calendar with a preview of the hovered row. */
export function useCourseSchedule(course: Course) {
  const view = useScheduleView()
  const scheduleId = useActiveScheduleId()
  const addCourse = useStore((s) => s.addCourse)
  const setSection = useStore((s) => s.setSection)
  const removeCourse = useStore((s) => s.removeCourse)
  const [hovered, setHovered] = useState<Section | null>(null)

  const entry = view.entries.find((e) => e.course.id === course.id) ?? null
  const others = view.placed.filter((e) => e.course.id !== course.id)
  const color = entry?.entry.color ?? nextColor(view.entries.map((e) => e.entry.color))
  const placedParts = entry && !entry.entry.hidden ? entry.parts : []

  /** What the schedule would hold for this course after acting on a row. */
  const resultFor = (s: Section): Selection => {
    if (s.parent !== null) return resolveSelection(course, s.parent, s.name)
    const keepChild = entry?.section?.name === s.name ? (entry.child?.name ?? null) : childForSection(course, s.name, view)
    return resolveSelection(course, s.name, keepChild)
  }
  const conflictsWith = (parts: Section[]) => others.filter((o) => partsConflict(parts, o.parts))

  // Calendar: the rest of the schedule, this course's placed parts, and a hatched preview of the hovered row's result.
  let previewSel: Selection | null = null
  if (hovered) previewSel = resultFor(hovered)
  else if (!placedParts.length) {
    const first = initialChoice(course, view)
    previewSel = first.section ? resolveSelection(course, first.section, first.child) : null
  }
  const previewParts = previewSel ? selectionParts(previewSel).filter((p) => !placedParts.includes(p)) : []
  const previewAll = previewSel ? selectionParts(previewSel) : []
  const previewConflicts = new Set(conflictsWith(previewAll).map((o) => o.course.id))
  const showingPreview = previewParts.length > 0

  const blocks: CalendarBlock[] = [
    ...others.flatMap((o) =>
      o.parts.flatMap((p) =>
        partBlocks(o.course, p, o.entry.color, { conflict: previewConflicts.has(o.course.id) || (!showingPreview && view.conflicts.get(o.course.id)?.includes(course.id)) }),
      ),
    ),
    ...placedParts.flatMap((p) => partBlocks(course, p, color, { selected: hovered === p, conflict: !showingPreview && view.conflicts.has(course.id) })),
    ...previewParts.flatMap((p) => partBlocks(course, p, color, { variant: 'preview', keyPrefix: 'preview-', conflict: previewConflicts.size > 0 })),
  ]

  const previewLabel = previewAll.map(partLabel).join(' and ')
  let caption: string
  if (showingPreview && previewParts.every(isUnscheduled)) caption = `${previewLabel} ${previewAll.length > 1 ? "don't" : "doesn't"} have a scheduled meeting time.`
  else if (showingPreview && previewConflicts.size) caption = `${previewLabel} would conflict with ${joinList(conflictsWith(previewAll).map((o) => o.course.code))}.`
  else if (showingPreview) caption = `Previewing ${previewLabel} in your schedule.`
  else if (placedParts.length) caption = `${placedParts.map(partLabel).join(' and ')} ${placedParts.length > 1 ? 'are' : 'is'} in your schedule.`
  else caption = ''

  return {
    view,
    scheduleId,
    entry,
    blocks,
    caption,
    captionIsConflict: showingPreview && previewConflicts.size > 0,
    setHovered,
    conflictsFor: (s: Section) => conflictsWith(selectionParts(resultFor(s))).map((o) => o.course.code),
    addDefault: () => {
      if (!scheduleId) return
      const choice = initialChoice(course, view)
      addCourse(scheduleId, course.id, choice.section, choice.child)
    },
    act: (s: Section) => {
      if (!scheduleId) return
      const result = resultFor(s)
      if (!result.section) return
      if (entry) setSection(scheduleId, course.id, result.section.name, result.child?.name ?? null)
      else addCourse(scheduleId, course.id, result.section.name, result.child?.name ?? null)
    },
    remove: () => scheduleId && removeCourse(scheduleId, course.id),
  }
}

export type CourseSchedule = ReturnType<typeof useCourseSchedule>

export function CourseDetail({ course, closeHref, search }: { course: Course; closeHref: string; search: string }) {
  const term = useTerm()
  const termId = term.meta.id
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const saved = useBookmarks(termId).includes(course.id)
  const requisites = useRequisiteContext(termId)
  const chipStatus = useMemo(() => (requisites.ctx ? statusFnFor(requisites.ctx, false) : undefined), [requisites.ctx])
  const sched = useCourseSchedule(course)

  return (
    <article className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur">
        <Link to={closeHref} className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[14px] font-medium text-ink-2 hover:text-ink md:hidden">
          <ArrowLeft className="size-4" />
          All courses
        </Link>
        <span className="course-code hidden text-[15px] text-muted md:inline">{course.code}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to={`/${termId}/courses/${course.code}/full${search}`}
            title="Open the full course page"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:text-ink"
          >
            <Maximize2 aria-hidden className="size-3.5" />
            Expand
          </Link>
          <Button size="sm" variant="ghost" aria-pressed={saved} onClick={() => toggleBookmark(termId, course.id)}>
            <Star className={`size-4 ${saved ? 'fill-current text-warn' : ''}`} />
            {saved ? 'Saved' : 'Save'}
          </Button>
          <Link
            to={closeHref}
            aria-label="Close course details"
            title="Close"
            className="hidden size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:inline-grid"
          >
            <X className="size-4" />
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-5 pb-10 sm:px-5">
        <header>
          <div className="course-code text-[44px] leading-none text-ink">{course.code}</div>
          <h1 className="display mt-1.5 text-[26px] text-ink">{course.title}</h1>
          <CourseFacts course={course} search={search} className="mt-4" />
          <ScheduleActions course={course} sched={sched} className="mt-5" />
          <RequisiteStatus courseId={course.id} termId={termId} context={requisites.ctx ?? undefined} className="mt-3" />
        </header>

        <CourseAbout courseId={course.id} status={chipStatus} />

        <CountsToward courseId={course.id} termId={termId} />

        <ScheduleCalendar sched={sched} />

        <CourseSections course={course} sched={sched} />

        <CourseFcePanel courseId={course.id} units={course.units} currentInstructors={course.instructors} />
      </div>
    </article>
  )
}

/** Units, grading, department, level, session, instructors and cross-listings. `row` lays them out side by side. */
export function CourseFacts({ course, search, layout = 'list', className = '' }: { course: Course; search: string; layout?: 'list' | 'row'; className?: string }) {
  const term = useTerm()
  const termId = term.meta.id
  const slugByName = useMemo(() => new Map(term.instructors.map((i) => [i.name, i.slug])), [term])
  // Same title: the course under another number. Otherwise the sections only meet together (French I and II).
  const together = course.crossListed.filter((id) => term.courseById.has(id))
  const crossListed = together.filter((id) => sameCourseTitle(course.title, term.courseById.get(id)!.title))
  const meetsWith = together.filter((id) => !crossListed.includes(id))
  const mini = courseMini(course, term.meta)

  const facts: { label: string; value: ReactNode }[] = [
    {
      label: 'Units',
      value: (
        <>
          {unitsText(course.units)}
          {course.passFail ? <span className="text-muted">, not factorable</span> : null}
        </>
      ),
    },
  ]
  if (course.passFail)
    facts.push({
      label: 'Grading',
      value: (
        <>
          <span className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 text-[12.5px] font-medium">Pass/fail only</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">{PASS_FAIL_ONLY_HELP}</span>
        </>
      ),
    })
  facts.push(
    {
      label: 'Department',
      value: (
        <>
          {departmentName(course.dept)} <span className="text-muted">({course.dept})</span>
        </>
      ),
    },
    { label: 'Level', value: course.level === 'G' ? 'Graduate' : 'Undergraduate' },
  )
  if (mini) facts.push({ label: 'Session', value: mini })
  if (course.permissionRequired)
    facts.push({
      label: 'Registration',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <KeyRound aria-hidden className="size-3.5 text-muted" />
          Special permission required
        </span>
      ),
    })
  if (course.instructors.length)
    facts.push({
      label: course.instructors.length === 1 ? 'Instructor' : 'Instructors',
      value: (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {course.instructors.map((name) => (
            <Link
              key={name}
              to={`/${termId}/instructors/${slugByName.get(name) ?? instructorSlug(name)}`}
              className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
            >
              {name}
            </Link>
          ))}
        </span>
      ),
    })
  for (const [label, ids] of [
    ['Also listed as', crossListed],
    ['Meets with', meetsWith],
  ] as const)
    if (ids.length)
      facts.push({
        label,
        value: (
          <span className="flex flex-wrap gap-x-3">
            {ids.map((id) => (
              <Link
                key={id}
                to={`/${termId}/courses/${codeOf(id)}${layout === 'row' ? '/full' : ''}${search}`}
                {...coursePreview(id)}
                className="course-code text-[14.5px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
              >
                {codeOf(id)}
              </Link>
            ))}
          </span>
        ),
      })

  if (layout === 'row') {
    return (
      <dl className={`flex flex-wrap gap-x-10 gap-y-3 text-[14px] ${className}`}>
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 max-w-[26rem]">
            <dt className="text-[12.5px] text-muted">{f.label}</dt>
            <dd className="mt-0.5 text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return (
    <dl className={`grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px] ${className}`}>
      {facts.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-muted">{f.label}</dt>
          <dd className="text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "Add to …", or "In …" with Remove, and a nudge to pick a recitation. */
export function ScheduleActions({ course, sched, className = '' }: { course: Course; sched: CourseSchedule; className?: string }) {
  const { view, entry, scheduleId } = sched
  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        {entry ? (
          <>
            <span className="inline-flex min-h-9 items-center gap-1.5 text-[14px] font-medium text-ok">
              <Check className="size-4 shrink-0" />
              In {view.schedule?.name ?? 'your schedule'}
              {entry.entry.hidden ? <span className="font-normal text-muted">(hidden)</span> : null}
              {entry.entry.passFail && !course.passFail ? <span className="font-normal text-muted">(pass/fail)</span> : null}
            </span>
            <Button variant="ghost" size="sm" onClick={sched.remove}>
              Remove
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={sched.addDefault} disabled={!scheduleId}>
            <Plus className="size-4" />
            Add to {view.schedule?.name ?? 'schedule'}
          </Button>
        )}
      </div>
      {entry?.needsChild ? <p className="mt-1 text-[13px] text-warn">Pick a recitation below to finish this course's schedule.</p> : null}
    </>
  )
}

/** The active schedule's week, with this course placed or previewed. */
export function ScheduleCalendar({ sched, hourHeight = 26, headingId = 'detail-calendar' }: { sched: CourseSchedule; hourHeight?: number; headingId?: string }) {
  const term = useTerm()
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="display text-[17px]">
          {sched.view.schedule?.name ?? 'Your schedule'}
        </h2>
        <Link
          to={`/${term.meta.id}/schedule`}
          className="text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent"
        >
          Open schedule
        </Link>
      </div>
      <div className="rounded-lg border border-line bg-surface p-1.5">
        <WeekGrid blocks={sched.blocks} compact hourHeight={hourHeight} />
      </div>
      {sched.caption ? (
        <p className={`mt-1.5 text-[12.5px] ${sched.captionIsConflict ? 'text-danger' : 'text-muted'}`} aria-live="polite">
          {sched.caption}
        </p>
      ) : null}
    </section>
  )
}

/** Section heading, term notes and the sections list. `table` adds Instructor and Seats columns in wide layouts. */
export function CourseSections({ course, sched, layout = 'stack' }: { course: Course; sched: CourseSchedule; layout?: 'stack' | 'table' }) {
  const notes = useTerm().meta.notes ?? []
  return (
    <section aria-labelledby="detail-sections">
      <h2 id="detail-sections" className="display mb-2 text-[17px]">
        {course.sections.length === 1 ? 'Section' : sectionCounts(course)}
      </h2>
      {notes.length ? (
        <div className="mb-2 flex gap-1.5 text-[12.5px] text-muted">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div>
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </div>
      ) : null}
      <SectionsList
        course={course}
        entry={sched.entry}
        canEdit={Boolean(sched.scheduleId)}
        conflictsFor={sched.conflictsFor}
        onHover={sched.setHovered}
        onAct={sched.act}
        onRemove={sched.remove}
        layout={layout}
      />
    </section>
  )
}

interface SectionsListProps {
  course: Course
  entry: ResolvedEntry | null
  canEdit: boolean
  /** Scheduled courses the result of acting on this row would conflict with. */
  conflictsFor(s: Section): string[]
  onHover(s: Section | null): void
  onAct(s: Section): void
  onRemove(): void
  layout?: 'stack' | 'table'
}

/** Wide-table columns: section, meetings (days/time/room), instructor and details, seats, action. */
const TABLE_COLS = '@3xl:grid-cols-[5rem_19.5rem_minmax(0,1fr)_4.5rem_5.75rem] @3xl:gap-x-3'

/**
 * Lectures (or standalone sections) with their recitations nested underneath. Rows lay out as columns when the
 * pane is wide enough and stack otherwise (container query), so it works both in the side pane and on phones.
 */
function SectionsList(props: SectionsListProps) {
  const { course, entry, layout = 'stack' } = props
  const table = layout === 'table'
  // The full page has room for every recitation; the side panel starts long lists collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(table ? topSections(course).map((t) => t.name) : []))

  // Rows have side padding so a highlighted (added or hovered) row doesn't sit flush with its text; the list pulls out
  // by the same amount so the text still lines up with the heading above.
  return (
    <div className="@container -mx-2">
      {/* Column headings only once there's room for the Days / Time / Room columns (the meeting lines switch at @lg too). */}
      <div
        aria-hidden
        className={`hidden border-b border-line-strong px-2 pb-1.5 text-[12px] text-muted @lg:grid @lg:grid-cols-[3.75rem_minmax(0,1fr)_5.75rem] @lg:gap-x-2 ${table ? `${TABLE_COLS}` : ''}`}
      >
        <span>Section</span>
        <span className="grid grid-cols-[3rem_8.5rem_minmax(0,1fr)] gap-x-2">
          <span>Days</span>
          <span>Time</span>
          <span>Room</span>
        </span>
        {table ? (
          <>
            <span className="hidden @3xl:block">Instructor</span>
            <span className="hidden text-right @3xl:block">Seats</span>
          </>
        ) : null}
      </div>
      <ul aria-label={`Sections of ${course.code}`}>
        {topSections(course).map((top) => {
          const children = childSections(course, top.name)
          const holdsChoice = entry?.section?.name === top.name && entry.child !== null
          const open = children.length <= COLLAPSE_AFTER || expanded.has(top.name) || holdsChoice
          return (
            <li key={top.name} className="border-b border-line">
              <SectionRow {...props} section={top} />
              {children.length ? (
                <div className={`mb-2 ${table ? '@3xl:mb-0' : ''}`}>
                  {children.length > COLLAPSE_AFTER && !holdsChoice ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((s) => {
                          const next = new Set(s)
                          if (next.has(top.name)) next.delete(top.name)
                          else next.add(top.name)
                          return next
                        })
                      }
                      // Lined up with the lecture's details (just above it), so it reads as part of that lecture.
                      className={`-mt-1 ml-[3.75rem] flex min-h-8 items-center gap-1 rounded px-2 py-1 text-[12.5px] font-medium text-ink-2 hover:text-ink @md:ml-[4.25rem] ${table ? '@3xl:mt-0 @3xl:ml-0' : ''}`}
                    >
                      <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                      {open ? 'Hide' : 'Show'} {children.length} recitations for {partLabel(top)}
                    </button>
                  ) : null}
                  {open ? (
                    <ul aria-label={`Recitations of ${partLabel(top)}`} className={`ml-3 border-l-2 border-line pl-2 @md:ml-6 ${table ? '@3xl:ml-0 @3xl:border-l-0 @3xl:pl-0' : ''}`}>
                      {children.map((child) => (
                        <li key={child.name} className={`border-t border-line first:border-t-0 ${table ? '@3xl:first:border-t' : ''}`}>
                          <SectionRow {...props} section={child} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A section's seat count; with reservations, a hover card says who the reserved seats are for. */
function Seats({ section: s, suffix = '' }: { section: Section; suffix?: string }) {
  const count = s.capacity !== undefined ? `${s.capacity}${suffix}` : 'Seats'
  if (!s.reservations?.length) return <>{count}</>
  const codes = reservationCodes(s.reservations)
  return (
    <HoverCard
      trigger={
        <button type="button" className="inline-flex items-center gap-1 underline decoration-line-strong decoration-dotted underline-offset-2 hover:text-ink">
          <UsersRound aria-hidden className="size-3 text-muted" />
          {count}
        </button>
      }
    >
      <p className="text-[12px] text-muted">Seat reservations</p>
      <p className="mt-0.5 text-[13px] text-ink">Reserved seats for {reservationSummary(s.reservations)}</p>
      {codes ? <p className="mt-1.5 text-[12px] text-muted">{codes}</p> : null}
      <p className="mt-1.5 text-[11.5px] text-muted">From the Schedule of Classes.</p>
    </HoverCard>
  )
}

function SectionRow({ course, entry, canEdit, conflictsFor, onHover, onAct, onRemove, layout = 'stack', section: s }: SectionsListProps & { section: Section }) {
  const table = layout === 'table'
  const term = useTerm()
  const isChild = s.parent !== null
  const isChosen = isChild ? entry?.child?.name === s.name && entry.section?.name === s.parent : entry?.section?.name === s.name
  const conflicts = conflictsFor(s)
  const label = partLabel(s)
  const kind = isChild ? 'Recitation' : s.kind === 'lecture' ? 'Lecture' : 'Section'
  const actionLabel = entry ? (isChild ? `Switch ${course.code} to recitation ${s.name}` : `Switch ${course.code} to ${label}`) : `Add ${course.code} ${label}`

  return (
    <div
      onMouseEnter={() => onHover(s)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(s)}
      onBlur={() => onHover(null)}
      className={`grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-x-2 px-2 py-2 transition-colors hover:bg-surface-2 @md:grid-cols-[3.75rem_minmax(0,1fr)_5.75rem] ${table ? TABLE_COLS : ''} ${
        isChosen ? 'bg-[color-mix(in_oklab,var(--ok)_7%,transparent)]' : ''
      }`}
    >
      <div className={table && isChild ? '@3xl:border-l-2 @3xl:border-line @3xl:pl-2' : ''}>
        <span className={`course-code block leading-tight text-ink ${isChild ? 'text-[15px]' : 'text-[17px]'}`}>{s.name}</span>
        <span className="block text-[11.5px] text-muted">{kind}</span>
      </div>

      {/* In the wide table this wrapper dissolves, so meetings and details become their own columns. */}
      <div className={`min-w-0 text-[13px] ${table ? '@3xl:contents' : ''}`}>
        <ul className="space-y-0.5">
          {s.meetings.map((m, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 @lg:grid @lg:grid-cols-[3rem_8.5rem_minmax(0,1fr)]">
              <span className="font-medium text-ink">{formatDays(m.days)}</span>
              <span className="whitespace-nowrap text-ink-2">{formatTimeRange(m.start, m.end)}</span>
              {/* A room never breaks across lines ("WEH 5310"): it moves to its own line, and is cut off (in full on hover) only past that. */}
              <span title={formatLocation(m)} className="truncate whitespace-nowrap text-ink-2">
                {formatLocation(m)}
              </span>
            </li>
          ))}
        </ul>
        <div className="min-w-0">
          {s.title ? <div className="mt-0.5 font-medium text-ink">{s.title}</div> : null}
          <div className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted ${table ? '@3xl:mt-0' : ''}`}>
            {s.instructors.length || !isChild ? <span className="text-ink-2">{s.instructors.length ? s.instructors.join(', ') : 'Instructor TBA'}</span> : null}
            {!isChild ? s.instructors.map((name) => <InstructorFceBadge key={name} courseId={course.id} instructor={name} />) : null}
            <span title={`Delivery mode ${s.mode}`}>{modeLabel(s.mode)}</span>
            {s.mini !== null ? <span className="font-medium text-ink-2">{miniName(s.mini, term.meta)}</span> : null}
            {s.capacity || s.reservations?.length ? (
              <span className={table ? '@3xl:hidden' : ''}>
                <Seats section={s} suffix=" seats" />
              </span>
            ) : null}
          </div>
          {conflicts.length ? (
            <div className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-danger">
              <AlertTriangle className="size-3.5 shrink-0" />
              Conflicts with {joinList(conflicts)}
            </div>
          ) : null}
        </div>
      </div>

      {table ? (
        <div className="hidden text-right text-[13px] text-ink-2 tabular-nums @3xl:block">
          <Seats section={s} />
        </div>
      ) : null}

      <div className="flex flex-col items-end gap-0.5">
        {isChosen ? (
          <>
            <span className="inline-flex h-7 items-center gap-1 text-[12.5px] font-semibold text-ok">
              <Check className="size-3.5" />
              Added
            </span>
            {!isChild ? (
              <button type="button" onClick={onRemove} disabled={!canEdit} className="rounded text-[12px] text-muted underline-offset-2 hover:text-danger hover:underline">
                Remove
              </button>
            ) : null}
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => onAct(s)} aria-label={actionLabel} title={actionLabel}>
            {entry ? <ArrowLeftRight className="size-3.5" /> : <Plus className="size-3.5" />}
            {entry ? 'Switch' : 'Add'}
          </Button>
        )}
      </div>
    </div>
  )
}

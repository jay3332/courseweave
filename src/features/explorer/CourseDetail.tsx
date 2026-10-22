import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, ChevronDown, Info, Plus, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui'
import { WeekGrid, type CalendarBlock } from '../../components/WeekGrid'
import { isUnscheduled } from '../../lib/blocks'
import { nextColor } from '../../lib/colors'
import { instructorSlug } from '../../lib/data'
import { departmentName, modeLabel } from '../../lib/departments'
import { childSections, resolveSelection, selectionParts, topSections, type Selection } from '../../lib/sections'
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

export function CourseDetail({ course, closeHref, search }: { course: Course; closeHref: string; search: string }) {
  const term = useTerm()
  const termId = term.meta.id
  const view = useScheduleView()
  const scheduleId = useActiveScheduleId()
  const addCourse = useStore((s) => s.addCourse)
  const setSection = useStore((s) => s.setSection)
  const removeCourse = useStore((s) => s.removeCourse)
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const saved = useBookmarks(termId).includes(course.id)
  const [hovered, setHovered] = useState<Section | null>(null)
  const slugByName = useMemo(() => new Map(term.instructors.map((i) => [i.name, i.slug])), [term])
  const requisites = useRequisiteContext(termId)
  const chipStatus = useMemo(() => (requisites.ctx ? statusFnFor(requisites.ctx, false) : undefined), [requisites.ctx])

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

  const addDefault = () => {
    if (!scheduleId) return
    const choice = initialChoice(course, view)
    addCourse(scheduleId, course.id, choice.section, choice.child)
  }

  const act = (s: Section) => {
    if (!scheduleId) return
    const result = resultFor(s)
    if (!result.section) return
    if (entry) setSection(scheduleId, course.id, result.section.name, result.child?.name ?? null)
    else addCourse(scheduleId, course.id, result.section.name, result.child?.name ?? null)
  }

  const crossListed = course.crossListed.filter((id) => term.courseById.has(id))
  const mini = courseMini(course, term.meta)
  const notes = term.meta.notes ?? []

  return (
    <article className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur">
        <Link to={closeHref} className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[14px] font-medium text-ink-2 hover:text-ink md:hidden">
          <ArrowLeft className="size-4" />
          All courses
        </Link>
        <span className="course-code hidden text-[15px] text-muted md:inline">{course.code}</span>
        <div className="ml-auto flex items-center gap-1.5">
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

          <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
            <dt className="text-muted">Units</dt>
            <dd className="text-ink">
              {unitsText(course.units)}
              {course.passFail ? <span className="text-muted">, not factorable</span> : null}
            </dd>
            {course.passFail ? (
              <>
                <dt className="text-muted">Grading</dt>
                <dd className="text-ink">
                  <span className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 text-[12.5px] font-medium">Pass/fail only</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{PASS_FAIL_ONLY_HELP}</span>
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Department</dt>
            <dd className="text-ink">
              {departmentName(course.dept)} <span className="text-muted">({course.dept})</span>
            </dd>
            <dt className="text-muted">Level</dt>
            <dd className="text-ink">{course.level === 'G' ? 'Graduate' : 'Undergraduate'}</dd>
            {mini ? (
              <>
                <dt className="text-muted">Session</dt>
                <dd className="text-ink">{mini}</dd>
              </>
            ) : null}
            {course.instructors.length ? (
              <>
                <dt className="text-muted">{course.instructors.length === 1 ? 'Instructor' : 'Instructors'}</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {course.instructors.map((name) => (
                    <Link
                      key={name}
                      to={`/${termId}/instructors/${slugByName.get(name) ?? instructorSlug(name)}`}
                      className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                    >
                      {name}
                    </Link>
                  ))}
                </dd>
              </>
            ) : null}
            {crossListed.length ? (
              <>
                <dt className="text-muted">Also listed as</dt>
                <dd className="flex flex-wrap gap-x-3">
                  {crossListed.map((id) => (
                    <Link
                      key={id}
                      to={`/${termId}/courses/${codeOf(id)}${search}`}
                      className="course-code text-[14.5px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                    >
                      {codeOf(id)}
                    </Link>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {entry ? (
              <>
                <span className="inline-flex min-h-9 items-center gap-1.5 text-[14px] font-medium text-ok">
                  <Check className="size-4 shrink-0" />
                  In {view.schedule?.name ?? 'your schedule'}
                  {entry.entry.hidden ? <span className="font-normal text-muted">(hidden)</span> : null}
                  {entry.entry.passFail && !course.passFail ? <span className="font-normal text-muted">(pass/fail)</span> : null}
                </span>
                <Button variant="ghost" size="sm" onClick={() => scheduleId && removeCourse(scheduleId, course.id)}>
                  Remove
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={addDefault} disabled={!scheduleId}>
                <Plus className="size-4" />
                Add to {view.schedule?.name ?? 'schedule'}
              </Button>
            )}
          </div>
          {entry?.needsChild ? <p className="mt-1 text-[13px] text-warn">Pick a recitation below to finish this course's schedule.</p> : null}
          <RequisiteStatus courseId={course.id} termId={termId} context={requisites.ctx ?? undefined} className="mt-3" />
        </header>

        <CourseAbout courseId={course.id} status={chipStatus} />

        <CountsToward courseId={course.id} termId={termId} />

        <section aria-labelledby="detail-calendar">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="detail-calendar" className="display text-[17px]">
              {view.schedule?.name ?? 'Your schedule'}
            </h2>
            <Link
              to={`/${termId}/schedule`}
              className="text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent"
            >
              Open schedule
            </Link>
          </div>
          <div className="rounded-lg border border-line bg-surface p-1.5">
            <WeekGrid blocks={blocks} compact hourHeight={26} />
          </div>
          {caption ? (
            <p className={`mt-1.5 text-[12.5px] ${showingPreview && previewConflicts.size ? 'text-danger' : 'text-muted'}`} aria-live="polite">
              {caption}
            </p>
          ) : null}
        </section>

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
            entry={entry}
            canEdit={Boolean(scheduleId)}
            conflictsFor={(s) => conflictsWith(selectionParts(resultFor(s))).map((o) => o.course.code)}
            onHover={setHovered}
            onAct={act}
            onRemove={() => scheduleId && removeCourse(scheduleId, course.id)}
          />
        </section>

        <CourseFcePanel courseId={course.id} units={course.units} currentInstructors={course.instructors} />
      </div>
    </article>
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
}

/**
 * Lectures (or standalone sections) with their recitations nested underneath. Rows lay out as columns when the
 * pane is wide enough and stack otherwise (container query), so it works both in the side pane and on phones.
 */
function SectionsList(props: SectionsListProps) {
  const { course, entry } = props
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  return (
    <div className="@container">
      <div aria-hidden className="hidden border-b border-line-strong pb-1.5 text-[12px] text-muted @md:grid @md:grid-cols-[3.75rem_minmax(0,1fr)_5.75rem] @md:gap-x-2">
        <span>Section</span>
        <span className="grid grid-cols-[3rem_9.5rem_minmax(0,1fr)] gap-x-2">
          <span>Days</span>
          <span>Time</span>
          <span>Room</span>
        </span>
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
                <div className="mb-2 ml-3 border-l-2 border-line pl-2 @md:ml-6">
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
                      className="flex min-h-8 items-center gap-1 rounded py-1 text-[12.5px] font-medium text-ink-2 hover:text-ink"
                    >
                      <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                      {open ? 'Hide' : 'Show'} {children.length} recitations for {partLabel(top)}
                    </button>
                  ) : null}
                  {open ? (
                    <ul aria-label={`Recitations of ${partLabel(top)}`}>
                      {children.map((child) => (
                        <li key={child.name} className="border-t border-line first:border-t-0">
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

function SectionRow({ course, entry, canEdit, conflictsFor, onHover, onAct, onRemove, section: s }: SectionsListProps & { section: Section }) {
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
      className={`grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-x-2 py-2 transition-colors hover:bg-surface-2 @md:grid-cols-[3.75rem_minmax(0,1fr)_5.75rem] ${
        isChosen ? 'bg-[color-mix(in_oklab,var(--ok)_7%,transparent)]' : ''
      }`}
    >
      <div>
        <span className={`course-code block leading-tight text-ink ${isChild ? 'text-[15px]' : 'text-[17px]'}`}>{s.name}</span>
        <span className="block text-[11.5px] text-muted">{kind}</span>
      </div>

      <div className="min-w-0 text-[13px]">
        <ul className="space-y-0.5">
          {s.meetings.map((m, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 @md:grid @md:grid-cols-[3rem_9.5rem_minmax(0,1fr)]">
              <span className="font-medium text-ink">{formatDays(m.days)}</span>
              <span className="whitespace-nowrap text-ink-2">{formatTimeRange(m.start, m.end)}</span>
              <span className="text-ink-2">{formatLocation(m)}</span>
            </li>
          ))}
        </ul>
        {s.title ? <div className="mt-0.5 font-medium text-ink">{s.title}</div> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
          {s.instructors.length || !isChild ? <span className="text-ink-2">{s.instructors.length ? s.instructors.join(', ') : 'Instructor TBA'}</span> : null}
          {!isChild ? s.instructors.map((name) => <InstructorFceBadge key={name} courseId={course.id} instructor={name} />) : null}
          <span title={`Delivery mode ${s.mode}`}>{modeLabel(s.mode)}</span>
          {s.mini !== null ? <span className="font-medium text-ink-2">{miniName(s.mini, term.meta)}</span> : null}
          {s.capacity ? <span>{s.capacity} seats</span> : null}
        </div>
        {conflicts.length ? (
          <div className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-danger">
            <AlertTriangle className="size-3.5 shrink-0" />
            Conflicts with {joinList(conflicts)}
          </div>
        ) : null}
      </div>

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

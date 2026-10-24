// The full-width course page: everything in the side panel, laid out across the screen, plus history tables side by
// side and the prerequisite tree. Opened from the side panel's Expand; Back returns to the list as it was.
import { ArrowLeft, Star, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useHead } from '../../lib/head'
import { Button, Spinner } from '../../components/ui'
import { buildUnlocks, useCatalogIndex } from '../../lib/catalog'
import { parseCourseCode } from '../../lib/data'
import { codeOf } from '../../lib/requisite-format'
import type { Course } from '../../lib/types'
import { useBookmarks, useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { CourseAbout } from '../catalog/CourseAbout'
import { CourseSyllabi } from '../catalog/CourseSyllabi'
import { useChipContext } from '../catalog/chip-context'
import { RequiresAndUnlocks } from '../catalog/RequiresAndUnlocks'
import { CourseFcePanel } from '../fce/CourseFcePanel'
import { statusFnFor } from '../record/check-summary'
import { useRequisiteContext } from '../record/context'
import { RequisiteStatus } from '../record/RequisiteStatus'
import { CountsToward } from './CountsToward'
import { CourseFacts, CourseSections, ScheduleActions, ScheduleCalendar, useCourseSchedule } from './CourseDetail'
import { NotOfferedHere } from './OtherTerms'

export function CourseFullPage() {
  const term = useTerm()
  const termId = term.meta.id
  const { courseCode = '' } = useParams()
  const { search } = useLocation()
  const courseId = parseCourseCode(courseCode) ?? ''
  const course = term.courseById.get(courseId) ?? null

  // One address per course across semesters: the all-semesters page.
  useHead(course ? `${course.code} ${course.title} · ${term.meta.name} · Courseweave` : 'Course not found · Courseweave', course ? `/all/courses/${course.code}` : undefined)

  return (
    <div className="h-full overflow-y-auto">
      {course ? (
        <CourseFull key={course.id} course={course} search={search} />
      ) : (
        <div className="flex min-h-full flex-col">
          <NotOfferedHere courseId={courseId} search={search} backHref={`/${termId}/courses${search}`} />
        </div>
      )}
    </div>
  )
}

function CourseFull({ course, search }: { course: Course; search: string }) {
  const term = useTerm()
  const termId = term.meta.id
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const saved = useBookmarks(termId).includes(course.id)
  const requisites = useRequisiteContext(termId)
  const chipStatus = useMemo(() => (requisites.ctx ? statusFnFor(requisites.ctx, false) : undefined), [requisites.ctx])
  const sched = useCourseSchedule(course)
  // Where the requisite details open: a header row below the title and actions.
  const [detailsSlot, setDetailsSlot] = useState<HTMLDivElement | null>(null)
  const index = useCatalogIndex()
  // Course chips stay in full view when the course is offered this term; others open the requisite explorer.
  const chipHref = useMemo(
    () => (id: string) => (term.courseById.has(id) ? `/${termId}/courses/${codeOf(id)}/full${search}` : `/${termId}/requisites/${codeOf(id)}`),
    [term, termId, search],
  )
  const ctx = useChipContext(chipStatus, chipHref)
  const unlocks = useMemo(() => (index.status === 'ready' ? (buildUnlocks(index.value).get(course.id) ?? []) : []), [index, course.id])
  const treeRef = useRef<HTMLElement>(null)

  return (
    <article className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-4 pt-3 pb-16 md:px-8 md:pt-5">
      <div className="flex items-center gap-2">
        <Link
          to={`/${termId}/courses/${course.code}${search}`}
          className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded px-1 text-[14px] font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to results
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" aria-pressed={saved} onClick={() => toggleBookmark(termId, course.id)}>
            <Star className={`size-4 ${saved ? 'fill-current text-warn' : ''}`} />
            {saved ? 'Saved' : 'Save'}
          </Button>
          <Link
            to={`/${termId}/courses${search}`}
            aria-label="Close course"
            title="Close"
            className="inline-grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:size-7"
          >
            <X className="size-4" />
          </Link>
        </div>
      </div>

      {/* Actions sit level with the bottom of the title; requisite details open in a row below, so nothing moves up. */}
      <header className="-mt-4 grid gap-6 border-b border-line pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-12">
        <div className="min-w-0 lg:self-end">
          <div className="course-code text-[56px] leading-none text-ink md:text-[76px]">{course.code}</div>
          <h1 className="display mt-2 max-w-[30ch] text-[28px] leading-tight text-ink md:text-[38px]">{course.title}</h1>
          <CourseFacts course={course} search={search} layout="row" className="mt-6" />
        </div>
        <div className="flex shrink-0 flex-col gap-1 lg:max-w-[26rem] lg:items-end lg:self-end lg:text-right">
          <ScheduleActions course={course} sched={sched} />
          <RequisiteStatus courseId={course.id} termId={termId} context={requisites.ctx ?? undefined} detailsContainer={detailsSlot} className="mt-2 lg:text-left" />
        </div>
        <div ref={setDetailsSlot} className="empty:hidden lg:col-start-2 lg:-mt-2 lg:w-[26rem]" />
      </header>

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="flex min-w-0 flex-col gap-10">
          <CourseSections course={course} sched={sched} layout="table" />
          {/* Narrow screens: the calendar follows the sections it previews. */}
          <div className="lg:hidden">
            <ScheduleCalendar sched={sched} headingId="full-calendar-inline" />
          </div>
          <CourseAbout courseId={course.id} status={chipStatus} onShowTree={() => treeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <CountsToward courseId={course.id} termId={termId} />
        </div>
        {/* Wide screens: the calendar stays in view while you hover sections. */}
        <aside aria-label="Your schedule" className="hidden min-w-0 lg:block">
          <div className="sticky top-6">
            <ScheduleCalendar sched={sched} hourHeight={30} headingId="full-calendar" />
          </div>
        </aside>
      </div>

      <div className="border-t border-line pt-8">
        <CourseFcePanel courseId={course.id} units={course.units} currentInstructors={course.instructors} wide />
      </div>

      <div className="max-w-3xl border-t border-line pt-8">
        <CourseSyllabi courseId={course.id} code={course.code} />
      </div>

      <section ref={treeRef} aria-labelledby="full-requisites" className="scroll-mt-6 border-t border-line pt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="full-requisites" className="display text-[20px] text-ink">
            Prerequisites and what it unlocks
          </h2>
          <Link
            to={`/${termId}/requisites/${course.code}`}
            className="text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent"
          >
            Explore the whole chain
          </Link>
        </div>
        {index.status === 'loading' ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner label="Loading the course catalog" /> Loading the course catalog
          </div>
        ) : index.status === 'error' ? (
          <p className="text-[13.5px] text-danger">{index.error}</p>
        ) : (
          <RequiresAndUnlocks id={course.id} index={index.value} ctx={ctx} unlocks={unlocks} />
        )}
      </section>
    </article>
  )
}

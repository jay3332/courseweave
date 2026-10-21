import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useTerm } from '../../state/term'
import { InstructorDetail } from './InstructorDetail'
import { InstructorList } from './InstructorList'

export function InstructorsPage() {
  const term = useTerm()
  const { slug } = useParams()
  const { search } = useLocation()
  const inst = slug ? term.instructorBySlug.get(slug) : undefined
  const listHref = `/${term.meta.id}/instructors${search}`

  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [slug])

  useEffect(() => {
    const previous = document.title
    document.title = inst ? `${inst.name} · Courseweave` : `Instructors · ${term.meta.name} · Courseweave`
    return () => {
      document.title = previous
    }
  }, [inst, term.meta.name])

  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label="Instructor list"
        className={`min-h-0 w-full shrink-0 border-r border-line bg-surface md:block md:w-[380px] ${slug ? 'hidden' : 'block'}`}
      >
        <InstructorList selectedSlug={slug} />
      </aside>

      <div ref={detailRef} className={`scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto ${slug ? 'block' : 'hidden md:block'}`}>
        {slug ? (
          <div className="sticky top-0 z-30 border-b border-line bg-surface/95 px-3 py-1.5 backdrop-blur md:hidden">
            <Link to={listHref} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-ink-2 hover:text-ink">
              <ArrowLeft aria-hidden className="size-4" />
              All instructors
            </Link>
          </div>
        ) : null}
        {inst ? (
          <InstructorDetail key={inst.slug} inst={inst} />
        ) : slug ? (
          <NotFound slug={slug} listHref={listHref} />
        ) : (
          <Overview />
        )}
      </div>
    </div>
  )
}

function NotFound({ slug, listHref }: { slug: string; listHref: string }) {
  const term = useTerm()
  return (
    <div className="grid min-h-[60%] place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="display text-3xl text-ink">No instructor at this link</h1>
        <p className="mt-2 text-ink-2">
          Nobody named “{slug.replace(/-/g, ' ')}” teaches in {term.meta.name}. They may teach in a different semester, or the link may be
          misspelled.
        </p>
        <Link to={listHref} className="mt-4 inline-block font-medium text-accent underline underline-offset-2">
          Browse all instructors
        </Link>
      </div>
    </div>
  )
}

function Overview() {
  const term = useTerm()
  const termId = term.meta.id
  const { mostSections, mostCourses, sectionTotal } = useMemo(() => {
    const bySections = [...term.instructors].sort((a, b) => b.sectionCount - a.sectionCount).slice(0, 6)
    const byCourses = [...term.instructors].sort((a, b) => b.courseIds.length - a.courseIds.length || b.sectionCount - a.sectionCount).slice(0, 6)
    const staffed = term.courses.reduce((n, c) => n + c.sections.filter((s) => s.instructors.length).length, 0)
    return { mostSections: bySections, mostCourses: byCourses, sectionTotal: staffed }
  }, [term])

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
      <h1 className="display text-[40px] text-ink">Instructors</h1>
      <p className="mt-2 max-w-xl text-[15.5px] text-ink-2">
        {term.instructors.length.toLocaleString()} people teach {sectionTotal.toLocaleString()} staffed sections in {term.meta.name}. Pick
        someone from the list, or search by name or by a course number like 15-122, to see what they teach and when.
      </p>

      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        <Leaderboard
          title="Most sections"
          rows={mostSections.map((i) => ({ slug: i.slug, name: i.name, value: `${i.sectionCount} sections` }))}
          termId={termId}
        />
        <Leaderboard
          title="Most courses"
          rows={mostCourses.map((i) => ({ slug: i.slug, name: i.name, value: `${i.courseIds.length} courses` }))}
          termId={termId}
        />
      </div>
    </div>
  )
}

function Leaderboard({ title, rows, termId }: { title: string; rows: { slug: string; name: string; value: string }[]; termId: string }) {
  return (
    <section>
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <ol className="mt-2">
        {rows.map((r) => (
          <li key={r.slug} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <Link to={`/${termId}/instructors/${r.slug}`} className="truncate font-medium text-ink hover:text-accent">
              {r.name}
            </Link>
            <span className="shrink-0 text-[13px] text-muted tabular-nums">{r.value}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

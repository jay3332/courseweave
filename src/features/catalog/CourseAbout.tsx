import { ExternalLink, GitFork } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useCatalogDetails, useCatalogEntry } from '../../lib/catalog'
import type { CatalogDetails } from '../../lib/catalog-types'
import { codeOf } from '../../lib/requisite-format'
import { useTerm } from '../../state/term'
import { offeredText } from './format'
import { CourseChipList, RequisiteExpression, type StatusFn } from './RequisiteExpression'

const PROFILE_FIELDS: { key: keyof NonNullable<CatalogDetails['profile']>; label: string }[] = [
  { key: 'keyTopics', label: 'Key topics' },
  { key: 'goals', label: 'Learning goals' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'resources', label: 'Resources' },
  { key: 'background', label: 'Expected background' },
  { key: 'relevance', label: 'Who it’s for' },
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-1 text-muted md:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  )
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const long = text.length > 480
  return (
    <div>
      <p id={id} className={`max-w-[68ch] text-[14px] leading-relaxed text-ink-2 ${long && !open ? 'line-clamp-6' : ''}`}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="mt-1 min-h-9 text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-0"
        >
          {open ? 'Show less' : 'Show full description'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Catalog information for the course detail pane: description, requisites, grading and offering pattern.
 * `status` (optional) colors requisite courses as met/planned/missing for the student.
 */
export function CourseAbout({ courseId, status }: { courseId: string; status?: StatusFn }) {
  const term = useTerm()
  const entry = useCatalogEntry(courseId)
  const details = useCatalogDetails(courseId)
  const termId = term.meta.id

  if (entry.status === 'loading' || details.status === 'loading') {
    return (
      <section aria-label="About this course" aria-busy className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
      </section>
    )
  }
  if (entry.status === 'error') {
    return <p className="text-[13px] text-muted">{entry.error}</p>
  }

  const e = entry.value
  const d = details.status === 'ready' ? details.value : null
  const profile = d?.profile ? PROFILE_FIELDS.filter((f) => d.profile?.[f.key]) : []
  const offered = e ? offeredText(e) : null
  const headingId = `about-${courseId}`

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h2 id={headingId} className="display text-[17px]">
        About
      </h2>

      {d?.description ? <Description text={d.description} /> : <p className="text-[13.5px] text-muted">No catalog description for this course.</p>}

      {e ? (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-[13.5px] sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Row label="Prerequisites">
            {e.prereqs ? <RequisiteExpression req={e.prereqs} status={status} /> : <span className="text-ink-2">None listed</span>}
            {e.prereqText ? <p className="mt-1 text-[12.5px] text-muted">Schedule of Classes: {e.prereqText}</p> : null}
          </Row>
          {e.coreqs.length ? (
            <Row label="Corequisites">
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] text-muted">{e.coreqs.length > 1 ? 'One of these, before or in the same semester' : 'Before or in the same semester'}</span>
                <CourseChipList ids={e.coreqs} status={status} joinWord={e.coreqs.length > 1 ? 'or' : undefined} />
              </div>
            </Row>
          ) : null}
          {e.antireqs.length ? (
            <Row label="Not with">
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] text-muted">You can’t also get credit for</span>
                <CourseChipList ids={e.antireqs} />
              </div>
            </Row>
          ) : null}
          {e.equivalents.length ? (
            <Row label="Equivalent to">
              <CourseChipList ids={e.equivalents} />
            </Row>
          ) : null}
          <Row label="Grading">
            {e.passFail ? (
              <span>
                Pass/fail only. <span className="text-ink-2">Its units are non-factorable: they count toward your unit total but not your QPA.</span>
              </span>
            ) : (
              <span>Letter grade (factorable units)</span>
            )}
          </Row>
          {e.unitsMax !== undefined ? (
            <Row label="Units">
              Variable, {e.units ?? 0}–{e.unitsMax}
            </Row>
          ) : null}
          {offered ? <Row label="Offered">{offered}</Row> : null}
          {d?.permissionRequired ? <Row label="Enrollment">Special permission required</Row> : null}
          {e.repeatable ? <Row label="Repeatable">Can be taken more than once for credit</Row> : null}
        </dl>
      ) : (
        <p className="text-[13.5px] text-muted">The catalog has no requisite or grading information for this course.</p>
      )}

      {d?.notes ? <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{d.notes}</p> : null}

      {profile.length ? (
        <details className="group rounded-md border border-line">
          <summary className="flex min-h-10 cursor-pointer items-center px-3 text-[13.5px] font-medium text-ink select-none">Course profile</summary>
          <dl className="flex flex-col gap-2.5 border-t border-line px-3 py-3 text-[13.5px]">
            {profile.map((f) => (
              <div key={f.key}>
                <dt className="text-[12.5px] text-muted">{f.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-ink-2">{d!.profile![f.key]}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium">
        <Link
          to={`/${termId}/requisites/${codeOf(courseId)}`}
          className="inline-flex min-h-9 items-center gap-1.5 text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-0"
        >
          <GitFork aria-hidden className="size-3.5" />
          Explore requisites and what it unlocks
        </Link>
        {d?.website ? (
          <a
            href={d.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-0"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Course website
          </a>
        ) : null}
      </div>
    </section>
  )
}

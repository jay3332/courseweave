// Courses the routed semester doesn't offer: grayed search matches from other semesters, and the panel shown when a
// link names one. Both offer the semester(s) that do offer it. Courses only in the catalog (offered in none of the
// built semesters) appear only for an exact course number; anything with no data at all is left out.
import { ArrowRight, GitFork } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useCatalogIndex } from '../../lib/catalog'
import { exactCourseId, nearestTerm, searchOtherTerms, useOfferings, type Offering } from '../../lib/offerings'
import { codeOf } from '../../lib/requisite-format'
import { termLabel, termOrdinal } from '../../lib/requisites'
import { useTerm, useTerms } from '../../state/term'
import { EMPTY_FILTERS, type Filters } from './filters'

/** Most other-semester matches listed; the rest are counted. */
const LIMIT = 8

interface Match {
  id: string
  title: string
  /** Offering semesters, newest first; empty for catalog-only courses. */
  terms: string[]
}

/** Only department and level can be checked without a semester's sections; any other filter hides the group. */
function onlyDeptAndLevel(f: Filters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).every((k) => k === 'depts' || k === 'levels' || JSON.stringify(f[k]) === JSON.stringify(EMPTY_FILTERS[k]))
}

function useOtherTermMatches(query: string, filters: Filters): { matches: Match[]; more: number } | undefined {
  const term = useTerm()
  const enabled = Boolean(query.trim()) && onlyDeptAndLevel(filters)
  const offerings = useOfferings(enabled)
  const catalog = useCatalogIndex()
  if (!enabled) return { matches: [], more: 0 }
  if (offerings === undefined) return undefined
  const accept = (o: Offering) => (!filters.depts.length || filters.depts.includes(o.dept)) && (!filters.levels.length || filters.levels.includes(o.level as 'U' | 'G'))
  const found: Match[] = offerings ? searchOtherTerms(offerings, term.meta.id, query, accept) : []
  // A valid course number with catalog data but no recent offering: list it on its own.
  const exact = exactCourseId(query)
  if (exact && !term.courseById.has(exact) && !offerings?.byId.has(exact) && catalog.status === 'ready') {
    const title = catalogTitle(catalog.value.courses[exact]?.title)
    if (title) found.unshift({ id: exact, title, terms: [] })
  }
  return { matches: found.slice(0, LIMIT), more: Math.max(0, found.length - LIMIT) }
}

/** A catalog title worth showing; some entries only repeat the course number ("15-101"), which says nothing. */
function catalogTitle(title: string | undefined): string | undefined {
  return title && !/^\d{2}-?\d{3}$/.test(title.trim()) ? title : undefined
}

/** Link to a course in another semester, keeping the current search and filters. */
const termHref = (termId: string, id: string, search: string) => `/${termId}/courses/${codeOf(id)}${search}`

function OfferedIn({ match, search }: { match: Match; search: string }) {
  const term = useTerm()
  const all = useTermNames()
  if (!match.terms.length) {
    return <>Not offered in {all ? `any semester here (${all})` : 'a recent semester'}</>
  }
  return (
    <>
      Offered in{' '}
      {match.terms.map((t, i) => (
        <span key={t}>
          {i > 0 ? ', ' : ''}
          <Link to={termHref(t, match.id, search)} className="whitespace-nowrap underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent">
            {termLabel(t)}
          </Link>
        </span>
      ))}
      <span className="sr-only">, not {term.meta.name}</span>
    </>
  )
}

/** "Fall 2025–Spring 2027": the span of built semesters, for catalog-only courses. */
function useTermNames(): string | null {
  const terms = useTerms()
  if (terms.status !== 'ready' || !terms.value.length) return null
  const sorted = [...terms.value].sort((a, b) => (termOrdinal(a.id) ?? 0) - (termOrdinal(b.id) ?? 0))
  return `${sorted[0].name}–${sorted.at(-1)!.name}`
}

function MatchRow({ match, search }: { match: Match; search: string }) {
  const term = useTerm()
  const next = nearestTerm(match.terms, term.meta.id)
  return (
    <li className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <span className="course-code w-[4.25rem] shrink-0 text-[17px] text-muted">{codeOf(match.id)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] text-ink-2">{match.title}</div>
        <div className="text-[12.5px] text-muted">
          <OfferedIn match={match} search={search} />
        </div>
      </div>
      {next ? (
        <Link
          to={termHref(next, match.id, search)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:h-7 md:rounded-md md:px-2.5"
        >
          <span className="hidden sm:inline">View in</span>
          <span>{termLabel(next)}</span>
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      ) : (
        <Link
          to={`/${term.meta.id}/requisites/${codeOf(match.id)}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:h-7 md:rounded-md md:px-2.5"
        >
          <GitFork aria-hidden className="size-3.5" />
          Prerequisites
        </Link>
      )}
    </li>
  )
}

/**
 * Below the results: matches from other semesters, grayed. With no results this semester it replaces `fallback`
 * (the usual empty state) when there's something to show.
 */
export function OtherTermResults({ query, filters, search, empty, fallback }: { query: string; filters: Filters; search: string; empty: boolean; fallback: ReactNode }) {
  const term = useTerm()
  const result = useOtherTermMatches(query, filters)
  if (!result || !result.matches.length) return empty ? <>{fallback}</> : null
  return (
    <section aria-labelledby="other-terms-heading" className={empty ? '' : 'mt-2 border-t-4 border-line'}>
      <div className="px-4 pt-4 pb-2">
        {empty ? <p className="mb-2 text-[14px] text-ink-2">No {term.meta.name} courses match “{query.trim()}”.</p> : null}
        <h2 id="other-terms-heading" className="text-[13px] font-semibold text-ink-2">
          Not offered in {term.meta.name}
        </h2>
      </div>
      <ul className="opacity-90">
        {result.matches.map((m) => (
          <MatchRow key={m.id} match={m} search={search} />
        ))}
      </ul>
      {result.more ? <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">{result.more} more in other semesters; keep typing to narrow it down.</p> : null}
    </section>
  )
}

/** The course panel / page for a course this semester doesn't offer. */
export function NotOfferedHere({ courseId, search, backHref }: { courseId: string; search: string; backHref: string }) {
  const term = useTerm()
  const offerings = useOfferings()
  const catalog = useCatalogIndex()
  const offering = offerings?.byId.get(courseId)
  const knownTitle = catalog.status === 'ready' ? catalogTitle(catalog.value.courses[courseId]?.title) : undefined
  const loading = offerings === undefined || catalog.status === 'loading'
  const title = offering?.title ?? knownTitle
  const next = offering ? nearestTerm(offering.terms, term.meta.id) : undefined

  if (loading) return <div className="min-h-60" aria-busy />
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div className="max-w-sm">
        <div className="course-code text-[36px] leading-none text-muted">{codeOf(courseId)}</div>
        {title ? <h2 className="display mt-1.5 mb-3 text-[22px] text-ink">{title}</h2> : <h2 className="display mt-1.5 mb-3 text-2xl">No course {codeOf(courseId)}</h2>}
        <p className="mb-4 text-[14px] text-ink-2">
          {offering ? (
            <>
              Not offered in {term.meta.name}. <OfferedIn match={{ id: courseId, title: offering.title, terms: offering.terms }} search={search} />.
            </>
          ) : title ? (
            <>Not offered in {term.meta.name} or any other semester here.</>
          ) : (
            <>It isn’t offered in {term.meta.name}, or the number is mistyped.</>
          )}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {next ? (
            <Link
              to={termHref(next, courseId, search)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink hover:brightness-110"
            >
              View in {termLabel(next)}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
          {title ? (
            <Link
              to={`/${term.meta.id}/requisites/${codeOf(courseId)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              <GitFork aria-hidden className="size-4" />
              Prerequisites
            </Link>
          ) : null}
        </div>
        <Link to={backHref} className="mt-4 inline-block text-[13.5px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
          Back to all courses
        </Link>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Chip, SearchInput } from '../../components/ui'
import { lastName } from '../../lib/data'
import { departmentName } from '../../lib/departments'
import { termLabel } from '../../lib/requisites'
import { useTerm } from '../../state/term'
import { ALL_SEMESTERS } from '../../state/term-scope'
import { useAllInstructors, type AllInstructor } from './allInstructors'
import { buildInstructorDocs, scoreInstructor, type InstructorDoc } from './instructorData'

export type SortKey = 'name' | 'sections'

const NO_DOCS: InstructorDoc[] = []

const PAGE = 120

export function InstructorList({ selectedSlug }: { selectedSlug: string | undefined }) {
  const term = useTerm()
  const { termId: routeTermId } = useParams()
  // "All semesters": everyone teaching in any semester here, and everyone in the FCE history.
  const allMode = routeTermId === ALL_SEMESTERS
  const all = useAllInstructors(allMode)
  const termId = allMode ? ALL_SEMESTERS : term.meta.id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const dept = params.get('dept') ?? ''
  const sort: SortKey = params.get('sort') === 'sections' ? 'sections' : 'name'
  const search = params.toString() ? `?${params.toString()}` : ''

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const termDocs = useMemo(() => (allMode ? [] : buildInstructorDocs(term)), [allMode, term])
  const docs = allMode ? (all?.docs ?? NO_DOCS) : termDocs
  const total = allMode ? (all?.list.length ?? 0) : term.instructors.length

  const deptOptions = useMemo(() => {
    if (allMode) {
      const used = [...new Set((all?.list ?? []).flatMap((i) => i.depts))]
      return used.map((code) => ({ code, name: departmentName(code) })).sort((a, b) => a.name.localeCompare(b.name))
    }
    const used = new Set(term.instructors.flatMap((i) => i.depts))
    return term.departments.filter((d) => used.has(d.code))
  }, [allMode, all, term])

  const results = useMemo(() => {
    const scored: { doc: InstructorDoc; score: number }[] = []
    for (const doc of docs) {
      if (dept && !doc.inst.depts.includes(dept)) continue
      const score = scoreInstructor(doc, query)
      if (score > 0) scored.push({ doc, score })
    }
    const byName = (a: InstructorDoc, b: InstructorDoc) =>
      lastName(a.inst.name).localeCompare(lastName(b.inst.name)) || a.inst.name.localeCompare(b.inst.name)
    // With a query, name matches (score ≥ 100) rank above course matches; then the chosen sort applies.
    const tier = (s: number) => (query.trim() ? (s >= 100 ? 0 : 1) : 0)
    scored.sort(
      (a, b) =>
        tier(a.score) - tier(b.score) ||
        (sort === 'sections' ? b.doc.inst.sectionCount - a.doc.inst.sectionCount : 0) ||
        byName(a.doc, b.doc),
    )
    return scored.map((s) => s.doc)
  }, [docs, query, dept, sort])

  const grouped = sort === 'name' && !query.trim()

  // Incremental rendering.
  const [limit, setLimit] = useState(PAGE)
  const [active, setActive] = useState(-1)
  const resetKey = `${query}|${dept}|${sort}`
  const [lastReset, setLastReset] = useState(resetKey)
  if (lastReset !== resetKey) {
    setLastReset(resetKey)
    setLimit(PAGE)
    setActive(-1)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE)
      },
      { root: scrollRef.current, rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, results.length])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  // Search focus: on load (desktop only, to avoid popping the mobile keyboard) and with "/".
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!selectedSlug && window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const moveActive = (delta: number) => {
    if (!results.length) return
    const next = Math.max(0, Math.min(results.length - 1, (active === -1 ? (delta > 0 ? -1 : 0) : active) + delta))
    if (next >= limit) setLimit(next + PAGE)
    setActive(next)
  }

  useEffect(() => {
    if (active < 0) return
    document.getElementById(`instructor-row-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
    } else if (e.key === 'Enter') {
      const doc = results[active === -1 ? 0 : active]
      if (doc) {
        e.preventDefault()
        navigate(`/${termId}/instructors/${doc.inst.slug}${search}`)
      }
    } else if (e.key === 'Escape' && query) {
      setParam('q', '')
    }
  }

  const visible = results.slice(0, limit)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b border-line bg-surface px-4 pt-4 pb-3">
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={(v) => setParam('q', v)}
          onKeyDown={onKeyDown}
          placeholder="Search names, courses, or titles"
          aria-label="Search instructors"
          role="combobox"
          aria-expanded
          aria-controls="instructor-results"
          aria-activedescendant={active >= 0 ? `instructor-row-${active}` : undefined}
          aria-autocomplete="list"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Department</span>
            <select
              value={dept}
              onChange={(e) => setParam('dept', e.target.value)}
              className="h-9 w-full truncate rounded-md border border-line-strong bg-surface pr-6 pl-2 text-[13px] text-ink sm:h-7"
            >
              <option value="">All departments</option>
              {deptOptions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="Sort by" className="flex items-center gap-1">
            <Chip selected={sort === 'name'} onClick={() => setParam('sort', '')} className="max-sm:h-9">
              Name
            </Chip>
            <Chip selected={sort === 'sections'} onClick={() => setParam('sort', 'sections')} title="Most sections first" className="max-sm:h-9">
              Sections
            </Chip>
          </div>
        </div>
        <p className="text-[12.5px] text-muted" aria-live="polite">
          {allMode && all === undefined
            ? 'Loading instructors from every semester…'
            : results.length === total
              ? `${total.toLocaleString()} instructors${allMode ? ' across all semesters' : ''}`
              : `${results.length.toLocaleString()} of ${total.toLocaleString()} instructors`}
        </p>
      </div>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {allMode && all === null ? (
          <div className="px-5 py-10 text-center text-[14px] text-ink-2">All semesters isn’t available: this build has no list of who teaches what.</div>
        ) : allMode && all === undefined ? null : results.length === 0 ? (
          <div className="px-5 py-10 text-center text-[14px] text-ink-2">
            <p className="font-medium text-ink">No instructors match.</p>
            <p className="mt-1">Try a last name, a course number like 15-122, or clear the department filter.</p>
          </div>
        ) : (
          <ul id="instructor-results" role="listbox" aria-label="Instructors" className="pb-2">
            {visible.map((doc, i) => {
              const header = grouped && (i === 0 || visible[i - 1].letter !== doc.letter)
              return (
                <li key={doc.inst.slug + doc.inst.name} role="presentation">
                  {header ? (
                    <div className="sticky top-0 z-10 border-b border-line bg-paper/95 px-4 py-1 text-[12px] font-semibold text-muted backdrop-blur">
                      {doc.letter}
                    </div>
                  ) : null}
                  <Row
                    doc={doc}
                    index={i}
                    href={`/${termId}/instructors/${doc.inst.slug}${search}`}
                    selected={doc.inst.slug === selectedSlug}
                    active={i === active}
                    showSections={sort === 'sections'}
                    allSemesters={allMode}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {visible.length < results.length ? <div ref={sentinelRef} className="h-10" aria-hidden /> : null}
      </div>
    </div>
  )
}

function Row({
  doc,
  index,
  href,
  selected,
  active,
  showSections,
  allSemesters,
}: {
  doc: InstructorDoc
  index: number
  href: string
  selected: boolean
  active: boolean
  showSections: boolean
  allSemesters: boolean
}) {
  const { inst } = doc
  const terms = allSemesters ? (inst as AllInstructor).terms : null
  const count = showSections ? inst.sectionCount : inst.courseIds.length
  const unit = showSections ? (count === 1 ? 'section' : 'sections') : count === 1 ? 'course' : 'courses'
  return (
    <Link
      id={`instructor-row-${index}`}
      role="option"
      aria-selected={selected}
      to={href}
      className={`relative flex items-center gap-3 border-b border-line/70 px-4 py-2 text-left transition-colors focus-visible:-outline-offset-2 ${
        selected ? 'bg-accent-soft' : active ? 'bg-surface-2' : 'hover:bg-surface-2'
      } ${active ? 'outline-2 -outline-offset-2 outline-line-strong' : ''}`}
    >
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" /> : null}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[14.5px] ${selected ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{inst.name}</div>
        <div className="flex min-w-0 gap-2 text-[12px] text-muted">
          {inst.depts.length ? <span className="shrink-0">{inst.depts.join(', ')}</span> : null}
          {terms ? <span className="truncate">{terms.length ? `${termLabel(terms[0].term)}${terms.length > 1 ? ` and ${terms.length - 1} more` : ''}` : 'FCE history only'}</span> : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-[12px] text-ink-2 tabular-nums">
        {count} {unit}
      </div>
    </Link>
  )
}

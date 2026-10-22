// Hover/focus preview for course pills anywhere in the app. Mark an element with `{...coursePreview(id)}` (a
// `data-course-preview` attribute) and <CoursePreviewLayer> (mounted once under the term route) shows a card with
// the course's title, units, description, prerequisites, this term's sections, FCEs and your requisite status.
// Mouse hover and keyboard focus only; touch users tap through to the course instead.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useCatalogDetails, useCatalogIndex } from '../lib/catalog'
import { departmentName } from '../lib/departments'
import { courseIsMini, expectedHours, formatHours, formatRating, useFceAccess, useFceSummary, workloadRatio, workloadTone } from '../lib/fce'
import { formatRequisite } from '../lib/requisite-format'
import { checkCourse } from '../lib/requisites'
import { topSections } from '../lib/sections'
import { formatUnits } from '../lib/time'
import { meetingSummary } from '../features/explorer/summary'
import { LEVEL_STYLE, summarizeCheck } from '../features/record/check-summary'
import { useRequisiteContext } from '../features/record/context'
import { useTerm } from '../state/term'

const ATTR = 'data-course-preview'
const OPEN_DELAY = 450
/** After a card was open, neighbouring pills open almost at once (like native tooltips). */
const WARM_DELAY = 90
const CLOSE_DELAY = 160
const WIDTH = 320

/** Props that give an element a course preview. Accepts "15122" or "15-122". */
export function coursePreview(courseId: string | null | undefined): Record<string, string> {
  const id = (courseId ?? '').replace(/\D/g, '')
  return /^\d{5}$/.test(id) ? { [ATTR]: id } : {}
}

interface Active {
  id: string
  anchor: Element
}

export function CoursePreviewLayer() {
  const [active, setActive] = useState<Active | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const warmUntil = useRef(0)
  const activeRef = useRef<Active | null>(null)
  activeRef.current = active

  useEffect(() => {
    const clear = () => {
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
    }
    const scheduleOpen = (anchor: Element) => {
      const id = anchor.getAttribute(ATTR)
      if (!id) return
      clear()
      if (activeRef.current?.anchor === anchor) return
      const delay = activeRef.current || Date.now() < warmUntil.current ? WARM_DELAY : OPEN_DELAY
      openTimer.current = window.setTimeout(() => setActive({ id, anchor }), delay)
    }
    const scheduleClose = () => {
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => {
        if (activeRef.current) warmUntil.current = Date.now() + 600
        setActive(null)
      }, CLOSE_DELAY)
    }
    const anchorOf = (target: EventTarget | null) => (target instanceof Element ? target.closest(`[${ATTR}]`) : null)
    const inCard = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-course-preview-card]'))

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      if (inCard(e.target)) return window.clearTimeout(closeTimer.current)
      const anchor = anchorOf(e.target)
      if (anchor) scheduleOpen(anchor)
    }
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const from = anchorOf(e.target) ?? (inCard(e.target) ? activeRef.current?.anchor : null)
      if (!from) return
      const to = e.relatedTarget
      if (to instanceof Node && (from.contains(to) || inCard(to))) return
      scheduleClose()
    }
    const onFocusIn = (e: FocusEvent) => {
      const anchor = anchorOf(e.target)
      if (anchor && (e.target as Element).matches(':focus-visible')) scheduleOpen(anchor)
    }
    const onFocusOut = (e: FocusEvent) => {
      if (anchorOf(e.target)) scheduleClose()
    }
    const hideNow = () => {
      clear()
      setActive(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeRef.current) hideNow()
    }
    // Clicking a pill navigates or acts; the card would only be in the way.
    const onDown = (e: PointerEvent) => {
      if (!inCard(e.target)) hideNow()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', hideNow, true)
    window.addEventListener('resize', hideNow)
    return () => {
      clear()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', hideNow, true)
      window.removeEventListener('resize', hideNow)
    }
  }, [])

  // The anchor can disappear (list re-render, navigation); drop the card with it.
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => {
      if (!active.anchor.isConnected) setActive(null)
    }, 300)
    return () => window.clearInterval(t)
  }, [active])

  if (!active) return null
  return createPortal(<PositionedCard key={active.id} active={active} />, document.body)
}

function PositionedCard({ active }: { active: Active }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999, width: WIDTH })

  useLayoutEffect(() => {
    const place = () => {
      const card = ref.current
      if (!card) return
      const a = active.anchor.getBoundingClientRect()
      const width = Math.min(WIDTH, window.innerWidth - 16)
      const h = card.offsetHeight
      const below = a.bottom + 8
      const top = below + h <= window.innerHeight - 8 || a.top - 8 - h < 8 ? Math.min(below, window.innerHeight - h - 8) : a.top - 8 - h
      const left = Math.min(Math.max(8, a.left), window.innerWidth - width - 8)
      setStyle({ position: 'fixed', top: Math.max(8, top), left, width })
    }
    place()
    // Content (description, FCEs) loads in after the first paint; keep the card on screen as it grows.
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [active])

  const describedBy = `course-preview-${active.id}`
  useEffect(() => {
    const el = active.anchor
    const prev = el.getAttribute('aria-describedby')
    el.setAttribute('aria-describedby', prev ? `${prev} ${describedBy}` : describedBy)
    return () => {
      if (prev) el.setAttribute('aria-describedby', prev)
      else el.removeAttribute('aria-describedby')
    }
  }, [active, describedBy])

  return (
    <div
      ref={ref}
      id={describedBy}
      role="tooltip"
      data-course-preview-card=""
      style={style}
      className="z-[60] rounded-xl border border-line bg-surface p-3.5 text-left text-ink shadow-2xl"
    >
      <PreviewBody id={active.id} />
    </div>
  )
}

function PreviewBody({ id }: { id: string }) {
  const term = useTerm()
  const catalog = useCatalogIndex()
  const details = useCatalogDetails(id)
  const fce = useFceSummary()
  const access = useFceAccess()
  const requisites = useRequisiteContext(term.meta.id)

  const course = term.courseById.get(id) ?? null
  const entry = catalog.status === 'ready' ? catalog.value.courses[id] : undefined
  const code = course?.code ?? `${id.slice(0, 2)}-${id.slice(2)}`
  const title = course?.title ?? entry?.title ?? null
  const units = course ? course.units : (entry?.units ?? null)
  const passFail = course?.passFail ?? entry?.passFail ?? false
  const description = details.status === 'ready' ? details.value?.description : undefined
  const summary = fce?.courses.get(id) ?? null
  const mini = courseIsMini(course, summary)
  const expected = expectedHours(units, mini)
  const tone = summary?.hours != null ? workloadTone(workloadRatio(summary.hours, units, mini)) : null

  const check = requisites.ctx && entry ? checkCourse(id, entry, requisites.ctx) : null
  const status = check ? summarizeCheck(check, entry) : null
  const StatusIcon = status ? LEVEL_STYLE[status.level].icon : null

  const offered = course ? meetingSummary(course) : null
  const tops = course ? topSections(course).length : 0

  if (!title && catalog.status === 'loading') return <p className="text-[13px] text-muted">Loading {code}…</p>

  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-snug">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="course-code text-[17px] text-ink">{code}</span>
            <span className="text-[12.5px] text-muted">
              {units === null ? 'Variable units' : `${formatUnits(units)} units`}
              {passFail ? ', pass/fail' : ''}
            </span>
          </div>
          {title ? <p className="font-semibold text-ink">{title}</p> : <p className="text-muted">Not in the course catalog</p>}
          {course ? <p className="text-[12px] text-muted">{departmentName(course.dept)}</p> : null}
        </div>
      </div>

      {description ? <p className="line-clamp-3 text-ink-2">{description}</p> : null}

      {entry?.prereqs ? (
        <p>
          <span className="text-muted">Prerequisites </span>
          <span className="text-ink-2">{formatRequisite(entry.prereqs)}</span>
        </p>
      ) : null}

      {status && StatusIcon && status.level !== 'none' ? (
        <p className={`flex items-start gap-1.5 ${LEVEL_STYLE[status.level].color}`}>
          <StatusIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{status.text}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[12.5px]">
        <span className={course ? 'text-ink-2' : 'text-muted'}>
          {course
            ? `${term.meta.name}: ${tops > 1 ? offered?.primary : (offered?.primary ?? 'offered')}`
            : `Not offered in ${term.meta.name}`}
        </span>
        {summary?.hours != null ? (
          <span className="text-ink-2" title={expected !== null ? `Units suggest about ${formatHours(expected)} hours a week` : undefined}>
            <span className={tone === 'heavy' ? 'text-warn' : tone === 'light' ? 'text-ok' : ''}>{formatHours(summary.hours)} h/wk</span>
            {summary.courseRate != null ? `, rated ${formatRating(summary.courseRate)}` : ''}
          </span>
        ) : access === 'locked' ? (
          <span className="text-muted">Sign in to see FCEs</span>
        ) : null}
      </div>
    </div>
  )
}

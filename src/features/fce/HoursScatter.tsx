import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router'
import { courseColorStyle } from '../../lib/colors'
import { FCE_HOURS_HELP, WORKLOAD_TONE_LABEL, courseIsMini, expectedHours, expectedHoursText, formatHours, formatRating, workloadRatio, workloadTone, type FceSummary } from '../../lib/fce'
import type { Course } from '../../lib/types'
import { useElementSize } from './useElementSize'

interface Point {
  course: Course
  summary: FceSummary
  units: number
  /** Minis run half a semester; they're plotted at 2 × units so y = x still means "as its units suggest". */
  mini: boolean
  /** Weekly hours the units suggest: units, or 2 × units for a mini. The x position. */
  unitEq: number
  hours: number
  /** Screen position. */
  x: number
  y: number
  /** Units beyond the x-axis maximum, drawn at the edge. */
  clamped: boolean
  color: number | undefined
}

interface HoursScatterProps {
  courses: Course[]
  fce: Map<string, FceSummary>
  selectedId: string | null
  /** courseId → palette index for courses in the active schedule. */
  entryColors: Map<string, number>
  hrefFor(course: Course): string
  onOpen(course: Course): void
}

const M = { top: 14, right: 14, bottom: 42, left: 42 }
const HIT_RADIUS = 24

/** Deterministic horizontal jitter in [-0.5, 0.5) so courses with equal units don't stack into a line. */
function jitter(id: string): number {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000 - 0.5
}

function niceCeil(v: number, step: number) {
  return Math.max(step, Math.ceil(v / step) * step)
}

/** Diamond marker path centred on (x, y). */
function diamond(x: number, y: number, r: number): string {
  return `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`
}

/**
 * FCE hours per week (y) against the hours the units suggest (x): units, or 2 × units for minis, since a mini
 * runs half the semester. Points above the diagonal run heavier than their units.
 * Hover (or tap) finds the nearest course; click or Enter opens it. The list view is the table equivalent.
 */
export function HoursScatter({ courses, fce, selectedId, entryColors, hrefFor, onOpen }: HoursScatterProps) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<Point | null>(null)
  const [pinned, setPinned] = useState<Point | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const { data, excluded } = useMemo(() => {
    const data: { course: Course; summary: FceSummary; units: number; mini: boolean; unitEq: number; hours: number }[] = []
    let variable = 0
    let missing = 0
    for (const course of courses) {
      const s = fce.get(course.id)
      if (!s || s.hours === null) {
        missing++
        continue
      }
      if (course.units === null) {
        variable++
        continue
      }
      const mini = courseIsMini(course, s)
      data.push({ course, summary: s, units: course.units, mini, unitEq: expectedHours(course.units, mini)!, hours: s.hours })
    }
    return { data, excluded: { variable, missing } }
  }, [courses, fce])

  const width = size.width
  const height = Math.max(300, Math.min(size.height, 640))
  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = Math.max(0, height - M.top - M.bottom)

  const maxUnits = data.reduce((m, d) => Math.max(m, d.unitEq), 0)
  const miniCount = data.filter((d) => d.mini).length
  const xMax = niceCeil(Math.min(Math.max(maxUnits, 12), 24), 3)
  const yMax = niceCeil(Math.max(xMax, data.reduce((m, d) => Math.max(m, d.hours), 0)), 5)
  const sx = (u: number) => M.left + (u / xMax) * innerW
  const sy = (h: number) => M.top + innerH - (h / yMax) * innerH
  const jitterWidth = Math.min(0.7, (24 / innerW) * xMax)

  const points = useMemo<Point[]>(() => {
    if (!innerW) return []
    return data
      .map((d) => {
        const clamped = d.unitEq > xMax
        const u = clamped ? xMax : Math.max(0, d.unitEq + jitter(d.course.id) * jitterWidth)
        return { ...d, x: sx(u), y: sy(d.hours), clamped, color: entryColors.get(d.course.id) }
      })
      .sort((a, b) => a.x - b.x || a.y - b.y)
    // sx/sy derive from the values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, xMax, yMax, innerW, innerH, entryColors, jitterWidth])

  const highlighted = points.filter((p) => p.color !== undefined || p.course.id === selectedId)
  const active = pinned ?? hover ?? (focusIndex !== null ? (points[focusIndex] ?? null) : null)

  const nearest = (e: PointerEvent<SVGSVGElement>): Point | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let best: Point | null = null
    let bestD = HIT_RADIUS * HIT_RADIUS
    for (const p of points) {
      const d = (p.x - px) ** 2 + (p.y - py) ** 2
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return
    setHover(nearest(e))
  }
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const p = nearest(e)
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      // First tap shows the details; the tooltip's button opens the course.
      setPinned(p)
      return
    }
    if (p) onOpen(p.course)
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!points.length) return
    const i = focusIndex ?? -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setFocusIndex(Math.min(points.length - 1, i + 1))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setFocusIndex(Math.max(0, i - 1))
    else if (e.key === 'Home') setFocusIndex(0)
    else if (e.key === 'End') setFocusIndex(points.length - 1)
    else if (e.key === 'Enter' && focusIndex !== null) onOpen(points[focusIndex].course)
    else if (e.key === 'Escape') {
      setFocusIndex(null)
      setPinned(null)
    } else return
    e.preventDefault()
  }

  const xTicks = Array.from({ length: xMax / 3 + 1 }, (_, i) => i * 3)
  const yStep = yMax > 30 ? 10 : 5
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep)
  const diagEnd = Math.min(xMax, yMax)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 pt-3 pb-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="10" height="10">
            <circle cx="5" cy="5" r="4" fill="var(--c9)" opacity="0.7" />
          </svg>
          Course
        </span>
        {entryColors.size ? (
          <span className="flex items-center gap-1.5">
            <svg aria-hidden width="10" height="10">
              <circle cx="5" cy="5" r="4" fill="var(--c4)" />
            </svg>
            In your schedule
          </span>
        ) : null}
        {miniCount ? (
          <span className="flex items-center gap-1.5" title="Minis run half a semester, so they're plotted at twice their units: a 6-unit mini sits at 12.">
            <svg aria-hidden width="10" height="10">
              <path d={diamond(5, 5, 4.5)} fill="var(--c6)" opacity="0.8" />
            </svg>
            Mini, at 2 × units
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="16" height="10">
            <line x1="1" y1="9" x2="15" y2="1" stroke="var(--ink-2)" strokeWidth="1.5" />
          </svg>
          Hours equal units
        </span>
        <span className="text-muted" title={FCE_HOURS_HELP}>
          {points.length.toLocaleString()} plotted
          {excluded.missing ? `, ${excluded.missing.toLocaleString()} without FCE hours` : ''}
          {excluded.variable ? `, ${excluded.variable} with variable units` : ''}
        </span>
      </div>

      <div ref={ref} className="relative min-h-[300px] flex-1">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="group"
            aria-label={`Scatter chart of FCE hours per week against units for ${points.length} courses; minis are plotted at twice their units because they run half the semester. Use arrow keys to step through courses and Enter to open one. The list view shows the same data as a table.`}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onPointerUp={onPointerUp}
            onKeyDown={onKeyDown}
            onBlur={() => setFocusIndex(null)}
            className="block cursor-crosshair touch-manipulation rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* Grid */}
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={M.left + innerW} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <g key={`x${t}`}>
                <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={M.top + innerH} stroke="var(--line)" strokeWidth={1} opacity={0.6} />
                <text x={sx(t)} y={M.top + innerH + 16} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
                  {t === xMax && maxUnits > xMax ? `${t}+` : t}
                </text>
              </g>
            ))}
            <text x={M.left + innerW / 2} y={height - 6} textAnchor="middle" className="fill-ink-2 text-[12px]">
              {miniCount ? 'Units (minis × 2)' : 'Units'}
            </text>
            <text transform={`translate(12 ${M.top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-2 text-[12px]">
              FCE hours per week
            </text>

            {/* Reference: 1 unit ≈ 1 hour a week */}
            <line x1={sx(0)} y1={sy(0)} x2={sx(diagEnd)} y2={sy(diagEnd)} stroke="var(--ink-2)" strokeWidth={1.5} />
            <text x={sx(diagEnd) - 4} y={sy(diagEnd) - 6} textAnchor="end" className="fill-ink-2 text-[11px]">
              Hours = units
            </text>
            <text x={M.left + 6} y={M.top + 12} className="fill-muted text-[11px]">
              Heavier than units
            </text>
            <text x={M.left + innerW - 6} y={M.top + innerH - 8} textAnchor="end" className="fill-muted text-[11px]">
              Lighter than units
            </text>

            {/* Points */}
            <g>
              {points.map((p) =>
                p.color !== undefined || p.course.id === selectedId ? null : p.mini ? (
                  <path
                    key={p.course.id}
                    d={diamond(p.x, p.y, 4.75)}
                    fill={p.clamped ? 'var(--surface)' : 'var(--c6)'}
                    fillOpacity={p.clamped ? 1 : 0.6}
                    stroke={p.clamped ? 'var(--c6)' : 'var(--surface)'}
                    strokeWidth={p.clamped ? 1.5 : 1}
                  />
                ) : (
                  <circle
                    key={p.course.id}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill={p.clamped ? 'var(--surface)' : 'var(--c9)'}
                    fillOpacity={p.clamped ? 1 : 0.55}
                    stroke={p.clamped ? 'var(--c9)' : 'var(--surface)'}
                    strokeWidth={p.clamped ? 1.5 : 1}
                  />
                ),
              )}
            </g>
            <g>
              {highlighted.map((p) => {
                const selected = p.course.id === selectedId
                return (
                  <g key={p.course.id} style={courseColorStyle(p.color ?? 0)}>
                    {p.mini ? (
                      <path
                        d={diamond(p.x, p.y, selected ? 7 : 6)}
                        fill={p.color !== undefined ? 'var(--course)' : 'var(--ink)'}
                        stroke={selected ? 'var(--accent)' : 'var(--surface)'}
                        strokeWidth={2}
                      />
                    ) : (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={selected ? 6 : 5}
                        fill={p.color !== undefined ? 'var(--course)' : 'var(--ink)'}
                        stroke={selected ? 'var(--accent)' : 'var(--surface)'}
                        strokeWidth={2}
                      />
                    )}
                    <text x={p.x + 8} y={p.y} dy="0.32em" className="course-code fill-ink text-[11.5px]" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3}>
                      {p.course.code}
                    </text>
                  </g>
                )
              })}
            </g>
            {active ? <circle cx={active.x} cy={active.y} r={8} fill="none" stroke="var(--ink)" strokeWidth={2} pointerEvents="none" /> : null}
          </svg>
        ) : null}

        {active ? (
          <Tooltip
            point={active}
            containerWidth={width}
            pinned={pinned !== null}
            href={hrefFor(active.course)}
            onClose={() => setPinned(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

function Tooltip({ point, containerWidth, pinned, href, onClose }: { point: Point; containerWidth: number; pinned: boolean; href: string; onClose(): void }) {
  const { course, summary } = point
  const tone = workloadTone(workloadRatio(summary.hours, course.units, point.mini))
  const w = Math.min(260, containerWidth - 16)
  const left = Math.max(8, Math.min(point.x + 14, containerWidth - w - 8))
  const flip = point.x + 14 + w > containerWidth && point.x - 14 - w >= 8
  const top = Math.max(4, point.y - 20)
  return (
    <div
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={`${course.code} details`}
      className={`absolute z-20 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] shadow-lg ${pinned ? '' : 'pointer-events-none'}`}
      style={{ width: w, left: flip ? point.x - 14 - w : left, top }}
    >
      <div className="flex items-baseline gap-2">
        <span className="course-code text-[15px] text-ink">{course.code}</span>
        <span className="truncate text-ink-2">{course.title}</span>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted">Hours a week</dt>
        <dd className="font-semibold text-ink tabular-nums">{formatHours(summary.hours)}</dd>
        <dt className="text-muted">Units</dt>
        <dd className="text-ink tabular-nums">
          {course.units}
          {point.mini ? <span className="text-muted"> (mini)</span> : null}
        </dd>
        <dt className="text-muted">Units suggest</dt>
        <dd className="text-ink tabular-nums">{point.unitEq} h/wk</dd>
        <dt className="text-muted">Course rating</dt>
        <dd className="text-ink tabular-nums">{formatRating(summary.courseRate)}</dd>
      </dl>
      {tone ? <p className="mt-1 text-[12px] text-ink-2">{WORKLOAD_TONE_LABEL[tone]}</p> : null}
      {point.mini ? (
        <p className="mt-0.5 text-[11.5px] text-muted">A mini runs half the semester, so {expectedHoursText(course.units, true)}. Plotted at {point.unitEq}.</p>
      ) : null}
      <p className="mt-0.5 text-[11.5px] text-muted">
        {summary.terms} recent {summary.terms === 1 ? 'term' : 'terms'}, {summary.responses.toLocaleString()} responses
      </p>
      {pinned ? (
        <div className="mt-2 flex gap-2">
          <Link to={href} className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink">
            Open course
          </Link>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-md border border-line-strong px-3 text-[13px] text-ink-2">
            Close
          </button>
        </div>
      ) : null}
    </div>
  )
}

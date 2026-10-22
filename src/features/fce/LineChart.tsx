import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useElementSize } from './useElementSize'

export interface LinePoint {
  /** X label, e.g. "S26". */
  label: string
  /** Longer label for the tooltip, e.g. "Spring 2026". */
  title?: string
  value: number | null
  /** Secondary tooltip line, e.g. "42 responses". */
  sub?: string
}

interface LineChartProps {
  /** Oldest first. */
  points: LinePoint[]
  domain: [number, number]
  format(v: number): string
  /** Accessible name; the chart's visible title lives outside. */
  label: string
  height?: number
  /**
   * A reference, e.g. the hours a course's units suggest. A number draws a horizontal line; an array (one value
   * per point) draws a stepped line, for references that change over time (a course that became a mini).
   */
  reference?: { value: number | (number | null)[]; label: string }
}

const M = { top: 10, right: 34, bottom: 22, left: 30 }

/** Single-series trend with a snapping crosshair. Nulls break the line. */
export function LineChart({ points, domain, format, label, height = 132, reference }: LineChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = height - M.top - M.bottom
  const [lo, hi] = domain
  const n = points.length
  const sx = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const sy = (v: number) => M.top + innerH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * innerH

  // Line segments between consecutive non-null points.
  const segments: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
    } else current.push(`${sx(i)},${sy(p.value)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  const ticks = [lo, (lo + hi) / 2, hi]
  const lastIndex = points.map((p) => p.value !== null).lastIndexOf(true)
  const activePoint = active !== null ? points[active] : null

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    if (n <= 1) return 0
    return Math.max(0, Math.min(n - 1, Math.round(((x - M.left) / innerW) * (n - 1))))
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActive((i) => Math.min(n - 1, (i ?? lastIndex) + 1))
    else if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? lastIndex + 1) - 1))
    else if (e.key === 'Escape') setActive(null)
    else return
    e.preventDefault()
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={`${label}. Use the arrow keys to read each term.`}
          tabIndex={0}
          onPointerMove={(e) => setActive(indexAt(e))}
          onPointerDown={(e) => setActive(indexAt(e))}
          onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="block touch-pan-y rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + innerW} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10.5px] tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {reference && typeof reference.value === 'number' && reference.value >= lo && reference.value <= hi ? (
            <g>
              <line x1={M.left} x2={M.left + innerW} y1={sy(reference.value)} y2={sy(reference.value)} stroke="var(--ink-2)" strokeWidth={1} />
              <text x={M.left + innerW + 4} y={sy(reference.value)} dy="0.32em" className="fill-ink-2 text-[10.5px]">
                {reference.label}
              </text>
            </g>
          ) : null}
          {reference && Array.isArray(reference.value) ? <StepReference values={reference.value} label={reference.label} sx={sx} sy={sy} n={n} innerW={innerW} /> : null}
          {n ? (
            <>
              <text x={sx(0)} y={height - 6} textAnchor={n > 1 ? 'start' : 'middle'} className="fill-muted text-[10.5px]">
                {points[0].label}
              </text>
              {n > 1 ? (
                <text x={sx(n - 1)} y={height - 6} textAnchor="end" className="fill-muted text-[10.5px]">
                  {points[n - 1].label}
                </text>
              ) : null}
            </>
          ) : null}
          {segments.map((d, i) => (
            <polyline key={i} points={d} fill="none" stroke="var(--c4)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* Isolated points (no neighbors) still need a mark. */}
          {points.map((p, i) =>
            p.value !== null && (points[i - 1]?.value ?? null) === null && (points[i + 1]?.value ?? null) === null ? (
              <circle key={i} cx={sx(i)} cy={sy(p.value)} r={3} fill="var(--c4)" />
            ) : null,
          )}
          {lastIndex >= 0 && active === null ? (
            <g>
              <circle cx={sx(lastIndex)} cy={sy(points[lastIndex].value!)} r={4} fill="var(--c4)" stroke="var(--surface)" strokeWidth={2} />
              <text x={sx(lastIndex) + 7} y={sy(points[lastIndex].value!)} dy="0.32em" className="fill-ink text-[11px] font-semibold tabular-nums">
                {format(points[lastIndex].value!)}
              </text>
            </g>
          ) : null}
          {activePoint ? (
            <g pointerEvents="none">
              <line x1={sx(active!)} x2={sx(active!)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-2)" strokeWidth={1} />
              {activePoint.value !== null ? (
                <circle cx={sx(active!)} cy={sy(activePoint.value)} r={4} fill="var(--c4)" stroke="var(--surface)" strokeWidth={2} />
              ) : null}
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {activePoint ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] shadow-md"
          style={sx(active!) > width / 2 ? { right: width - sx(active!) + 8 } : { left: sx(active!) + 8 }}
        >
          <div className="font-semibold text-ink tabular-nums">{activePoint.value === null ? 'No data' : format(activePoint.value)}</div>
          <div className="text-ink-2">{activePoint.title ?? activePoint.label}</div>
          {activePoint.sub ? <div className="text-muted">{activePoint.sub}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** A reference that can change between points: horizontal runs joined by vertical steps halfway between points. */
function StepReference({ values, label, sx, sy, n, innerW }: { values: (number | null)[]; label: string; sx(i: number): number; sy(v: number): number; n: number; innerW: number }) {
  const step = n > 1 ? innerW / (n - 1) : innerW
  const parts: string[] = []
  let path = ''
  values.forEach((v, i) => {
    if (v === null) {
      if (path) parts.push(path)
      path = ''
      return
    }
    const x0 = i === 0 ? sx(0) : sx(i) - step / 2
    const x1 = i === n - 1 ? sx(i) : sx(i) + step / 2
    path += `${path ? 'L' : 'M'}${x0},${sy(v)}L${x1},${sy(v)}`
  })
  if (path) parts.push(path)
  const last = [...values].reverse().find((v) => v !== null)
  return (
    <g>
      {parts.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--ink-2)" strokeWidth={1} />
      ))}
      {last != null ? (
        <text x={sx(n - 1) + 4} y={sy(last)} dy="0.32em" className="fill-ink-2 text-[10.5px]">
          {label}
        </text>
      ) : null}
    </g>
  )
}

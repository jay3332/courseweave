import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { courseColorStyle } from '../lib/colors'
import { DAY_LONG, DAY_SHORT, formatTime, formatTimeRange } from '../lib/time'
import type { Day } from '../lib/types'

export interface CalendarBlock {
  /** Unique across all blocks (include the day if one section meets several days). */
  key: string
  day: Day
  start: number
  end: number
  /** Index into the course palette. */
  color: number
  /** Primary text, usually the course code. */
  label: string
  /** Secondary text, e.g. "Lec 1 · GHC 4401". */
  detail?: string
  /**
   * solid: in the schedule.
   * preview: hovered/candidate section (hatched).
   * ghost: an alternative section you could switch to (outlined).
   */
  variant?: 'solid' | 'preview' | 'ghost'
  conflict?: boolean
  selected?: boolean
  mini?: number | null
  /** Accessible name / native tooltip. */
  tooltip?: string
  onClick?: () => void
  onHover?: (hovering: boolean) => void
}

interface WeekGridProps {
  blocks: CalendarBlock[]
  /** Days to show. Defaults to Mon–Fri plus any weekend day that has a block. */
  days?: Day[]
  minHour?: number
  maxHour?: number
  /** Pixels per hour. */
  hourHeight?: number
  compact?: boolean
  className?: string
  /** Shown over the empty grid when there are no blocks. */
  empty?: ReactNode
}

interface Laid {
  block: CalendarBlock
  lane: number
  lanes: number
}

/** Side-by-side lanes for overlapping blocks, per cluster of mutually overlapping blocks. */
function layoutDay(blocks: CalendarBlock[]): Laid[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Laid[] = []
  let cluster: Laid[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    for (const l of cluster) l.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const block of sorted) {
    if (block.start >= clusterEnd && cluster.length) flush()
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(block.end)
    } else {
      laneEnds[lane] = block.end
    }
    cluster.push({ block, lane, lanes: 0 })
    clusterEnd = Math.max(clusterEnd, block.end)
  }
  flush()
  return out
}

export function WeekGrid({ blocks, days, minHour = 8, maxHour = 18, hourHeight = 52, compact = false, className = '', empty }: WeekGridProps) {
  const shownDays: Day[] =
    days ?? ([0, 1, 2, 3, 4, 5, 6] as Day[]).filter((d) => d < 5 || blocks.some((b) => b.day === d))

  let lo = minHour
  let hi = maxHour
  for (const b of blocks) {
    lo = Math.min(lo, Math.floor(b.start / 60))
    hi = Math.max(hi, Math.ceil(b.end / 60))
  }
  const hours = Array.from({ length: hi - lo }, (_, i) => lo + i)
  const height = (hi - lo) * hourHeight
  const top = (min: number) => ((min - lo * 60) / 60) * hourHeight

  return (
    <div className={`relative flex min-w-0 flex-col ${className}`}>
      <div className="flex border-b border-line">
        <div className={compact ? 'w-8 shrink-0' : 'w-12 shrink-0'} />
        {shownDays.map((d) => (
          <div key={d} className={`min-w-0 flex-1 text-center font-semibold text-ink-2 ${compact ? 'py-1 text-[11px]' : 'py-2 text-[13px]'}`}>
            <abbr title={DAY_LONG[d]} className="no-underline">
              {DAY_SHORT[d]}
            </abbr>
          </div>
        ))}
      </div>

      <div className="relative flex" style={{ height }}>
        <div className={`relative shrink-0 ${compact ? 'w-8' : 'w-12'}`}>
          {hours.map((h) => (
            <div
              key={h}
              className={`absolute right-1.5 text-muted ${h === lo ? 'translate-y-0.5' : '-translate-y-1/2'} ${compact ? 'text-[10px]' : 'text-[11px]'}`}
              style={{ top: top(h * 60) }}
            >
              {formatTime(h * 60, true)}
            </div>
          ))}
        </div>

        <div
          className="relative flex flex-1 border-l border-line"
          style={{
            backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${hourHeight / 2}px, color-mix(in oklab, var(--line) 45%, transparent) ${hourHeight / 2}px ${hourHeight / 2 + 1}px, transparent ${hourHeight / 2 + 1}px ${hourHeight}px)`,
          }}
        >
          {shownDays.map((d) => (
            <div key={d} className="relative min-w-0 flex-1 border-r border-line last:border-r-0">
              {layoutDay(blocks.filter((b) => b.day === d)).map(({ block, lane, lanes }) => (
                <Block
                  key={block.key}
                  block={block}
                  compact={compact}
                  style={{
                    top: top(block.start) + 1,
                    height: Math.max(top(block.end) - top(block.start) - 2, 14),
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                />
              ))}
            </div>
          ))}
          {blocks.length === 0 && empty ? <div className="absolute inset-0 grid place-items-center p-6">{empty}</div> : null}
        </div>
      </div>
    </div>
  )
}

function Block({ block, compact, style }: { block: CalendarBlock; compact: boolean; style: React.CSSProperties }) {
  const variant = block.variant ?? 'solid'
  const h = typeof style.height === 'number' ? style.height : 40
  const showDetail = !compact && h >= 44 && block.detail
  const showTime = !compact && h >= 30

  const base = '@container absolute overflow-hidden rounded-[5px] text-left leading-tight transition-[box-shadow,opacity] duration-100'
  const variants = {
    solid: 'course-tint border-l-[3px] border-[var(--course)]',
    preview: 'hatch border border-dashed border-[var(--course)] bg-surface/80 text-ink z-10',
    ghost: 'border border-dashed border-line-strong bg-surface/70 text-muted hover:course-tint hover:border-[var(--course)] hover:text-ink',
  }
  const ring = block.conflict
    ? 'ring-2 ring-danger ring-offset-0'
    : block.selected
      ? 'ring-2 ring-[var(--course)] shadow-md z-20'
      : ''

  const content = (
    <>
      <div className={`flex items-start gap-1 ${compact ? 'px-1 pt-0.5' : 'px-1.5 pt-1'}`}>
        <span className={`course-code truncate ${compact ? 'text-[10.5px]' : 'text-[13px]'}`}>{block.label}</span>
        {block.mini ? (
          <span className="ml-auto shrink-0 rounded-sm bg-[color-mix(in_oklab,var(--course)_22%,transparent)] px-1 text-[9.5px] font-semibold @max-[5.5rem]:hidden">
            M{block.mini}
          </span>
        ) : null}
        {block.conflict ? <AlertTriangle aria-hidden className="ml-auto size-3 shrink-0 text-danger @max-[4.5rem]:hidden" /> : null}
      </div>
      {showTime ? (
        <div className="truncate px-1.5 text-[11px] opacity-80">{formatTimeRange(block.start, block.end)}</div>
      ) : null}
      {showDetail ? <div className="truncate px-1.5 text-[11px] opacity-80">{block.detail}</div> : null}
    </>
  )

  const common = {
    style: { ...style, ...courseColorStyle(block.color) },
    title: block.tooltip,
    onMouseEnter: block.onHover ? () => block.onHover!(true) : undefined,
    onMouseLeave: block.onHover ? () => block.onHover!(false) : undefined,
  }

  if (block.onClick) {
    return (
      <button
        type="button"
        aria-label={block.tooltip ?? block.label}
        onClick={block.onClick}
        onFocus={common.onMouseEnter}
        onBlur={common.onMouseLeave}
        className={`${base} ${variants[variant]} ${ring} cursor-pointer`}
        {...common}
      >
        {content}
      </button>
    )
  }
  return (
    <div className={`${base} ${variants[variant]} ${ring}`} {...common}>
      {content}
    </div>
  )
}

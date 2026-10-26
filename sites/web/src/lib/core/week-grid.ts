// The week calendar's layout math, from Courseweave's components/WeekGrid.tsx: blocks, overlap lanes, visible days
// and hours. The Svelte calendar component renders what these return.
import type { Day } from "./types.ts";

export interface CalendarBlock {
  /** Unique across all blocks (include the day if one section meets several days). */
  key: string;
  day: Day;
  start: number;
  end: number;
  /** Index into the course palette. */
  color: number;
  /** Primary text, usually the course code. */
  label: string;
  /** Secondary text, e.g. "Lec 1 - GHC 4401". Used when `section`/`location` aren't given. */
  detail?: string;
  /** Short section label shown next to the code, e.g. "Lec 1", "Rec A". */
  section?: string;
  /** Room, e.g. "GHC 4401". */
  location?: string;
  /** The course's name, or a topics section's title; shown when the student turns course names on. */
  title?: string;
  /**
   * solid: in the schedule.
   * preview: hovered/candidate section (hatched).
   * ghost: an alternative section you could switch to (outlined).
   */
  variant?: "solid" | "preview" | "ghost";
  conflict?: boolean;
  selected?: boolean;
  mini?: number | null;
  /** Accessible name / native tooltip. */
  tooltip?: string;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
}

export interface LaidBlock {
  block: CalendarBlock;
  /** Zero-based column within its cluster of overlapping blocks. */
  lane: number;
  /** Columns in that cluster. */
  lanes: number;
}

/** Side-by-side lanes for overlapping blocks, per cluster of mutually overlapping blocks. */
export function layoutDay(blocks: CalendarBlock[]): LaidBlock[] {
  const sorted = blocks.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const out: LaidBlock[] = [];
  let cluster: LaidBlock[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const l of cluster) l.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd && cluster.length > 0) flush();
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    cluster.push({ block, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return out;
}

/** Days to show: `days` when given, else Monday to Friday plus any weekend day that has a block. */
export function shownDays(blocks: CalendarBlock[], days?: Day[]): Day[] {
  return (
    days ?? ([0, 1, 2, 3, 4, 5, 6] as Day[]).filter((d) => d < 5 || blocks.some((b) => b.day === d))
  );
}

/** First and last hour the grid shows: `minHour` to `maxHour`, widened to fit every block. */
export function hourRange(
  blocks: CalendarBlock[],
  minHour = 8,
  maxHour = 18,
): { from: number; to: number } {
  let from = minHour;
  let to = maxHour;
  for (const b of blocks) {
    from = Math.min(from, Math.floor(b.start / 60));
    to = Math.max(to, Math.ceil(b.end / 60));
  }
  return { from, to };
}

/* oxlint-disable eslint/no-negated-condition, unicorn/escape-case, unicorn/no-negated-condition -- Courseweave's code, ported unchanged (decision 14) so fixes carry over between the two codebases */
import type { CalendarBlock } from "./week-grid.ts";
import { formatLocation, isScheduled } from "./time.ts";
import type { Course, Section } from "./types.ts";

/** "Lec 1" for lectures, "Rec A" for sections under a lecture, "Sec A" for standalone sections. */
export function sectionLabel(section: Section): string {
  if (section.kind === "lecture") return `Lec ${section.name}`;
  return section.parent !== null ? `Rec ${section.name}` : `Sec ${section.name}`;
}

/** One calendar block per (meeting, day) of a section. Spread `extra` onto every block. */
export function sectionBlocks(
  course: Course,
  section: Section,
  color: number,
  extra: Partial<CalendarBlock> & { keyPrefix?: string } = {},
): CalendarBlock[] {
  const { keyPrefix = "", ...rest } = extra;
  const blocks: CalendarBlock[] = [];
  section.meetings.forEach((m, i) => {
    if (!isScheduled(m)) return;
    for (const day of m.days) {
      blocks.push({
        key: `${keyPrefix}${course.id}-${section.name}-${i}-${day}`,
        day,
        start: m.start,
        end: m.end,
        color,
        label: course.code,
        section: sectionLabel(section),
        location: formatLocation(m),
        title: section.title ?? course.title,
        detail: `${sectionLabel(section)} \u00b7 ${formatLocation(m)}`,
        mini: section.mini,
        tooltip: `${course.code} ${course.title}, ${sectionLabel(section)}`,
        ...rest,
      });
    }
  });
  return blocks;
}

/** True when no meeting of the section has a scheduled day and time. */
export function isUnscheduled(section: Section): boolean {
  return !section.meetings.some(isScheduled);
}

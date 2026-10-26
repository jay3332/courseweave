/* oxlint-disable typescript/strict-boolean-expressions, unicorn/no-array-sort -- Courseweave's code, ported unchanged (decision 14) so fixes carry over between the two codebases */
// Schedules: the records and the edits Courseweave's schedule store makes, as pure functions. lib/state/schedules.ts
// holds them and saves them to the account (or a draft); this file has no state of its own.
import { nextColor } from "../colors.ts";

export interface ScheduleEntry {
  courseId: string;
  /** Chosen top-level section (lecture or standalone), or null if the student hasn't picked one yet. */
  section: string | null;
  /** Chosen child section (recitation/lab) of `section`, or null. */
  child: string | null;
  /** The student elects pass/fail grading, so the units aren't factorable. */
  passFail: boolean;
  /** Index into the course color palette (core/colors.ts). */
  color: number;
  /** Hidden courses stay in the schedule but are left off the calendar and unit total. */
  hidden: boolean;
}

/** Who else may see a schedule: only its owner, or also accepted friends who are shown schedules. */
export type ScheduleVisibility = "private" | "friends";

export interface Schedule {
  id: string;
  termId: string;
  name: string;
  entries: ScheduleEntry[];
  createdAt: number;
  updatedAt: number;
  /** Missing means private. */
  visibility?: ScheduleVisibility;
}

export type Theme = "system" | "light" | "dark";

/** What calendar blocks show besides the course code. */
export interface CalendarDisplay {
  /** Section label next to the code ("Lec 1", "Rec A"). */
  section: boolean;
  time: boolean;
  location: boolean;
  /** The course's name (a topics section's title), when the block is tall enough. */
  title: boolean;
}

export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplay = {
  section: true,
  time: true,
  location: true,
  title: false,
};

export interface SectionChoice {
  section: string | null;
  child: string | null;
}

/** Short random id for records and rows created on this device. */
export const uid = (): string => Math.random().toString(36).slice(2, 10);

export function nextScheduleName(schedules: Schedule[]): string {
  let n = schedules.length + 1;
  while (schedules.some((s) => s.name === `Schedule ${n}`)) n++;
  return `Schedule ${n}`;
}

/** Schedules for a term, oldest first (tab order). */
export function termSchedules(schedules: Iterable<Schedule>, termId: string): Schedule[] {
  return [...schedules]
    .filter((s) => s.termId === termId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The term's most recently edited schedule: what becomes active when the active one is missing or deleted. */
export function latestSchedule(
  schedules: Iterable<Schedule>,
  termId: string,
  except?: string,
): Schedule | undefined {
  return [...schedules]
    .filter((s) => s.termId === termId && s.id !== except)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** A new schedule for a term, named "Schedule N" after the term's others unless `name` is given. */
export function newSchedule(opts: {
  id: string;
  termId: string;
  name?: string;
  entries?: ScheduleEntry[];
  now: number;
  existing: Iterable<Schedule>;
}): Schedule {
  const forTerm = [...opts.existing].filter((s) => s.termId === opts.termId);
  return {
    id: opts.id,
    termId: opts.termId,
    name: opts.name ?? nextScheduleName(forTerm),
    entries: opts.entries ?? [],
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** A schedule edit: what to change, given the schedule as it is. */
export type ScheduleEdit = (s: Schedule) => Partial<Schedule>;

const mapEntry =
  (courseId: string, fn: (e: ScheduleEntry) => ScheduleEntry): ScheduleEdit =>
  (s) => ({
    entries: s.entries.map((e) => (e.courseId === courseId ? fn(e) : e)),
  });

/** The edits Courseweave's schedule store makes. Each returns the fields to change. */
export const scheduleEdits = {
  rename:
    (name: string): ScheduleEdit =>
    () => ({ name: name.trim() || "Untitled schedule" }),

  setVisibility:
    (visibility: ScheduleVisibility): ScheduleEdit =>
    () => ({ visibility }),

  /** Adds a course, or updates its sections and unhides it when it's already there. */
  addCourse:
    (courseId: string, section: string | null = null, child: string | null = null): ScheduleEdit =>
    (s) => {
      const existing = s.entries.find((e) => e.courseId === courseId);
      if (existing) {
        return {
          entries: s.entries.map((e) =>
            e.courseId === courseId
              ? {
                  ...e,
                  section: section ?? e.section,
                  child: section ? child : e.child,
                  hidden: false,
                }
              : e,
          ),
        };
      }
      const color = nextColor(s.entries.map((e) => e.color));
      return {
        entries: [
          ...s.entries,
          { courseId, section, child, color, hidden: false, passFail: false },
        ],
      };
    },

  removeCourse:
    (courseId: string): ScheduleEdit =>
    (s) => ({ entries: s.entries.filter((e) => e.courseId !== courseId) }),

  /** Picks a top-level section. The child resets unless given. */
  setSection: (
    courseId: string,
    section: string | null,
    child: string | null = null,
  ): ScheduleEdit => mapEntry(courseId, (e) => ({ ...e, section, child })),

  setChild: (courseId: string, child: string | null): ScheduleEdit =>
    mapEntry(courseId, (e) => ({ ...e, child })),

  /** Bulk assignment, e.g. applying a generated schedule. */
  setSections:
    (sections: Record<string, SectionChoice>): ScheduleEdit =>
    (s) => ({
      entries: s.entries.map((e) =>
        e.courseId in sections ? { ...e, ...sections[e.courseId] } : e,
      ),
    }),

  /** Moves a course in the schedule's list to just before another (null: the end). Order is only for organizing. */
  moveEntry:
    (courseId: string, beforeCourseId: string | null): ScheduleEdit =>
    (s) => {
      const entry = s.entries.find((e) => e.courseId === courseId);
      if (!entry || beforeCourseId === courseId) return {};
      const rest = s.entries.filter((e) => e !== entry);
      const at = beforeCourseId ? rest.findIndex((e) => e.courseId === beforeCourseId) : -1;
      rest.splice(at < 0 ? rest.length : at, 0, entry);
      return { entries: rest };
    },

  setPassFail: (courseId: string, passFail: boolean): ScheduleEdit =>
    mapEntry(courseId, (e) => ({ ...e, passFail })),

  setColor: (courseId: string, color: number): ScheduleEdit =>
    mapEntry(courseId, (e) => ({ ...e, color })),

  toggleHidden: (courseId: string): ScheduleEdit =>
    mapEntry(courseId, (e) => ({ ...e, hidden: !e.hidden })),
};

/** Applies an edit, stamping `updatedAt`. Returns the same schedule when nothing changed. */
export function applyScheduleEdit(s: Schedule, edit: ScheduleEdit, now: number): Schedule {
  const patch = edit(s);
  if (Object.keys(patch).length === 0) return s;
  return { ...s, ...patch, updatedAt: now };
}

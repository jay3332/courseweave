// The Courses page's search: rank by the query (core/search.ts), keep what passes the filters (Courseweave's and
// the extra ones in query.ts), then sort, either way round. Also the courses this semester doesn't offer: search
// matches from other semesters, and the full list behind "Show courses not offered". Pure functions over loaded
// documents.
import type { SortDir } from "../../components/course/columns.ts";
import type { CatalogIndex } from "../../core/catalog-types.ts";
import {
  activeFilterCount,
  courseMatches,
  otherCourseMatches,
  sortCourses,
  sortOtherCourses,
  type FilterContext,
  type Filters,
} from "../../core/explorer/filters.ts";
import {
  catalogTitle,
  type UnofferedDoc,
  type UnofferedCourse,
} from "../../core/explorer/unoffered.ts";
import type { FceSummary } from "../../core/fce.ts";
import { exactCourseId, searchOtherTerms, type Offerings } from "../../core/offerings.ts";
import { scoreCourse, type ScoredDoc } from "../../core/search.ts";
import { topSections } from "../../core/sections.ts";
import { isScheduled } from "../../core/time.ts";
import type { Course } from "../../core/types.ts";
import { extraFilterCount, extraMatches, type ExplorerSort, type ExtraFilters } from "./query.ts";

export interface SearchInput {
  docs: readonly (ScoredDoc & { course: Course })[];
  /** Trimmed search text; empty lists every course. */
  q: string;
  filters: Filters;
  extra: ExtraFilters;
  sort: ExplorerSort;
  /** The other way round from the sort's usual way, or null (query.ts's sortDir()). */
  dir: SortDir | null;
  ctx: FilterContext;
  catalog: CatalogIndex | null;
  /** Semesters offering a course, for the "offered in" seasons. */
  termsOf: (courseId: string) => readonly string[] | undefined;
}

/** Every course scored against the query (all of them, at 1, without one). */
export function scoreDocs(
  docs: readonly (ScoredDoc & { course: Course })[],
  q: string,
): { course: Course; score: number }[] {
  if (q === "") return docs.map((doc) => ({ course: doc.course, score: 1 }));
  const out: { course: Course; score: number }[] = [];
  for (const doc of docs) {
    const score = scoreCourse(doc, q);
    if (score > 0) out.push({ course: doc.course, score });
  }
  return out;
}

/** The courses that pass every filter, sorted. */
export function filterCourses(
  scored: readonly { course: Course; score: number }[],
  input: Omit<SearchInput, "docs" | "q">,
): Course[] {
  const courses = input.catalog?.courses;
  const kept = scored.filter(
    (s) =>
      courseMatches(s.course, input.filters, input.ctx) &&
      extraMatches(
        {
          id: s.course.id,
          units: s.course.units,
          entry: courses?.[s.course.id],
          terms: input.termsOf(s.course.id),
        },
        input.extra,
      ),
  );
  const sorted =
    input.sort === "meets" ? byMeetingTime(kept) : sortCourses(kept, input.sort, input.ctx.fce);
  return input.dir === null
    ? sorted
    : turnAround(sorted, (course) => hasSortValue(course, input.sort, input.ctx.fce, course));
}

/** When a course first meets: the earliest start among its lectures and other top sections; null when TBA. */
export function firstMeeting(course: Course): { start: number; day: number } | null {
  let first: { start: number; day: number } | null = null;
  for (const section of topSections(course))
    for (const meeting of section.meetings) {
      if (!isScheduled(meeting)) continue;
      const day = Math.min(...meeting.days);
      if (first === null || meeting.start < first.start || (meeting.start === first.start && day < first.day))
        first = { start: meeting.start, day };
    }
  return first;
}

/** Earliest meeting time first, then the earliest day; courses without a time last, by number. */
function byMeetingTime(items: readonly { course: Course }[]): Course[] {
  const keyed = items.map(({ course }) => ({ course, first: firstMeeting(course) }));
  keyed.sort((a, b) => {
    if (a.first === null || b.first === null)
      return a.first === b.first ? a.course.id.localeCompare(b.course.id) : a.first === null ? 1 : -1;
    return a.first.start - b.first.start || a.first.day - b.first.day || a.course.id.localeCompare(b.course.id);
  });
  return keyed.map((k) => k.course);
}

/**
 * Whether a course has what the sort orders by. Courses without it (no FCEs, variable units, no meeting time) stay
 * last whichever way the sort runs.
 */
function hasSortValue(
  subject: { id: string; units: number | null },
  sort: ExplorerSort,
  fce: Map<string, FceSummary> | null | undefined,
  course?: Course,
): boolean {
  const s = fce?.get(subject.id);
  switch (sort) {
    case "units":
      return subject.units !== null;
    case "meets":
      return course !== undefined && firstMeeting(course) !== null;
    case "ratio":
      return s?.hours != null && Boolean(subject.units);
    case "rating":
      return s?.courseRate != null;
    case "teaching":
      return s?.teachingRate != null;
    default:
      return true;
  }
}

/** The list the other way round, keeping the items without a value for the sort at the end. */
function turnAround<T>(sorted: readonly T[], has: (item: T) => boolean): T[] {
  return [...sorted.filter((item) => has(item)).toReversed(), ...sorted.filter((item) => !has(item))];
}

export interface OtherMatch {
  id: string;
  title: string;
  /** Semesters offering it, newest first; empty for courses only the catalog lists. */
  terms: readonly string[];
}

/**
 * Search matches from semesters other than `termId`, shown under the results. Only department and level can be
 * checked without the semester's sections, so any other filter hides them. A valid course number the catalog knows
 * but no semester offers comes first.
 */
export function otherTermMatches(input: {
  offerings: Offerings | null;
  catalog: CatalogIndex | null;
  termId: string;
  offeredHere: (courseId: string) => boolean;
  q: string;
  filters: Filters;
  extra: ExtraFilters;
}): OtherMatch[] {
  const { filters, q } = input;
  if (q === "") return [];
  const simple =
    activeFilterCount({ ...filters, depts: [], levels: [] }) === 0 &&
    extraFilterCount(input.extra) === 0;
  if (!simple) return [];
  const list: OtherMatch[] = input.offerings
    ? searchOtherTerms(
        input.offerings,
        input.termId,
        q,
        (o) =>
          (filters.depts.length === 0 || filters.depts.includes(o.dept)) &&
          (filters.levels.length === 0 || filters.levels.some((level) => level === o.level)),
      )
    : [];
  const exact = exactCourseId(q);
  if (exact !== null && !input.offeredHere(exact) && input.offerings?.byId.has(exact) !== true) {
    const title = catalogTitle(input.catalog?.courses[exact]?.title);
    if (title !== undefined) list.unshift({ id: exact, title, terms: [] });
  }
  return list;
}

/** Courses the semester doesn't offer that pass the filters that don't need its sections, sorted. */
export function unofferedMatches(input: {
  docs: readonly UnofferedDoc[];
  q: string;
  filters: Filters;
  extra: ExtraFilters;
  sort: ExplorerSort;
  dir: SortDir | null;
  ctx: Pick<FilterContext, "bookmarks" | "fce" | "reqAccepts">;
  catalog: CatalogIndex | null;
  fce: Map<string, FceSummary> | null;
}): UnofferedCourse[] {
  const out: { course: UnofferedCourse; score: number }[] = [];
  for (const doc of input.docs) {
    if (!otherCourseMatches(doc.course, input.filters, input.ctx)) continue;
    const entry = input.catalog?.courses[doc.course.id];
    const subject = { id: doc.course.id, units: doc.course.units, entry, terms: doc.course.terms };
    if (!extraMatches(subject, input.extra)) continue;
    const score = input.q === "" ? 1 : scoreCourse(doc, input.q);
    if (score > 0) out.push({ course: doc.course, score });
  }
  // Without sections nothing has a meeting time, so a meeting-time sort keeps them by number.
  const sorted = sortOtherCourses(out, input.sort === "meets" ? "number" : input.sort, input.fce);
  return input.dir === null
    ? sorted
    : turnAround(sorted, (course) => hasSortValue(course, input.sort, input.fce));
}

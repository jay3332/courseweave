// The Courses page's state in its URL: Courseweave's filters (core/explorer/filters.ts, same keys) plus the
// Figma's filters Courseweave doesn't have (a units range, a course-number level, the seasons a course is
// offered in and fixed units only), the search, the sort and its direction, the semester and the view options.
import type { ListColumn, SortDir, SortedColumn } from "../../components/course/columns.ts";
import {
  EMPTY_FILTERS,
  parseFilters,
  type Filters,
  type SortKey,
  writeFilters,
} from "../../core/explorer/filters.ts";
import type { CatalogEntry } from "../../core/catalog-types.ts";

/** Courseweave's sorts, plus the meeting time the list's Meets column sorts by. */
export type ExplorerSort = SortKey | "meets";

export type Season = "fall" | "spring" | "summer";

export const SEASONS: readonly Season[] = ["fall", "spring", "summer"];

const isSeason = (value: string): value is Season =>
  value === "fall" || value === "spring" || value === "summer";

/** The slider's ends; a range covering both means "any units". */
export const UNITS_MIN = 0;
export const UNITS_MAX = 24;

export interface ExtraFilters {
  unitsLow: number;
  unitsHigh: number;
  /** Hundreds digit of the course number ("1" for 15-122), or null for any. */
  number: string | null;
  /** Seasons the course is offered in (any of them). */
  seasons: Season[];
  /** Fixed units only: no variable-unit courses (the opposite of Courseweave's VAR units bucket). */
  fixed: boolean;
}

export const EMPTY_EXTRA: ExtraFilters = {
  unitsLow: UNITS_MIN,
  unitsHigh: UNITS_MAX,
  number: null,
  seasons: [],
  fixed: false,
};

export interface ExplorerQuery {
  /** The `term` parameter as given: a semester id, "all", or null for the remembered one. */
  term: string | null;
  q: string;
  /** The `sort` parameter as given; parseSort() picks the default. */
  sort: string | null;
  /** The `dir` parameter: which way the sort runs when it isn't its usual way (sortDir() checks it). */
  dir: SortDir | null;
  /** The FCE hours chart instead of cards or rows. */
  chart: boolean;
  /** "Show courses not offered" in this semester (a view option: Reset keeps it). */
  unoffered: boolean;
  /** The course open in the detail panel ("15-122"), or null. */
  course: string | null;
  filters: Filters;
  extra: ExtraFilters;
}

function units(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= UNITS_MIN && value <= UNITS_MAX ? value : fallback;
}

export function parseExplorer(params: URLSearchParams): ExplorerQuery {
  const low = units(params, "ulo", UNITS_MIN);
  const high = units(params, "uhi", UNITS_MAX);
  const number = params.get("num");
  const dir = params.get("dir");
  return {
    term: params.get("term"),
    q: params.get("q") ?? "",
    sort: params.get("sort"),
    dir: dir === "asc" || dir === "desc" ? dir : null,
    chart: params.get("view") === "chart",
    unoffered: params.get("unoffered") === "1",
    course: /^\d{2}-?\d{3}$/u.test(params.get("course") ?? "") ? params.get("course") : null,
    filters: parseFilters(params),
    extra: {
      unitsLow: Math.min(low, high),
      unitsHigh: Math.max(low, high),
      number: number !== null && /^[0-9]$/u.test(number) ? number : null,
      seasons: (params.get("offered") ?? "").split(",").filter((s) => isSeason(s)),
      fixed: params.get("fixed") === "1",
    },
  };
}

/** The query as URL parameters, leaving out defaults so links stay short. */
export function writeExplorer(query: ExplorerQuery): URLSearchParams {
  const params = writeFilters(new URLSearchParams(), query.filters);
  const put = (key: string, value: string | null): void => {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  };
  put("term", query.term);
  put("q", query.q.trim() === "" ? null : query.q);
  put("sort", query.sort);
  put("dir", query.dir);
  put("view", query.chart ? "chart" : null);
  put("unoffered", query.unoffered ? "1" : null);
  put("course", query.course);
  put("ulo", query.extra.unitsLow === UNITS_MIN ? null : String(query.extra.unitsLow));
  put("uhi", query.extra.unitsHigh === UNITS_MAX ? null : String(query.extra.unitsHigh));
  put("num", query.extra.number);
  put("offered", query.extra.seasons.join(","));
  put("fixed", query.extra.fixed ? "1" : null);
  // A stable order, so equal queries compare equal as strings.
  params.sort();
  return params;
}

export function unitsActive(extra: ExtraFilters): boolean {
  return extra.unitsLow !== UNITS_MIN || extra.unitsHigh !== UNITS_MAX;
}

export function extraFilterCount(extra: ExtraFilters): number {
  return (
    (unitsActive(extra) ? 1 : 0) +
    (extra.number === null ? 0 : 1) +
    (extra.seasons.length > 0 ? 1 : 0) +
    (extra.fixed ? 1 : 0)
  );
}

export function hasExtraFilters(extra: ExtraFilters): boolean {
  return extraFilterCount(extra) > 0;
}

/** What the extra filters read about a course. */
export interface ExtraSubject {
  id: string;
  /** null for variable units. */
  units: number | null;
  /** Its catalog entry, for variable units' range and the seasons it's usually offered in. */
  entry?: CatalogEntry;
  /** Built semesters offering it ("F26"), for the seasons. */
  terms?: readonly string[];
}

const SEASON_LETTER: Record<Season, string> = { fall: "F", spring: "S", summer: "M" };

export function extraMatches(subject: ExtraSubject, extra: ExtraFilters): boolean {
  if (extra.fixed && subject.units === null) return false;
  if (extra.number !== null && subject.id[2] !== extra.number) return false;
  if (unitsActive(extra)) {
    let low = subject.units;
    let high = subject.units;
    if (low === null) {
      // Variable units: the catalog's range overlaps the chosen one.
      low = subject.entry?.units ?? null;
      high = subject.entry?.unitsMax ?? low;
    }
    if (low === null || high === null) return false;
    if (high < extra.unitsLow || low > extra.unitsHigh) return false;
  }
  if (extra.seasons.length > 0) {
    const usually = subject.entry?.offered ?? [];
    const terms = subject.terms ?? [];
    const offered = extra.seasons.some(
      (season) =>
        usually.includes(season) || terms.some((term) => term.startsWith(SEASON_LETTER[season])),
    );
    if (!offered) return false;
  }
  return true;
}

/** The query with every filter cleared; the search, semester, sort and view options stay. */
export function clearFilters(query: ExplorerQuery): ExplorerQuery {
  return { ...query, filters: { ...EMPTY_FILTERS }, extra: { ...EMPTY_EXTRA } };
}

export const SORT_LABELS: Record<ExplorerSort, string> = {
  relevance: "Relevance",
  number: "Number",
  title: "Title",
  units: "Units",
  meets: "Meeting time",
  hours: "Fewest FCE hours",
  "hours-desc": "Most FCE hours",
  ratio: "FCE hours vs units",
  rating: "Course rating",
  teaching: "Teaching rating",
};

/**
 * The sorts `dir` can turn around: their usual way (numbers, titles, units, times and hours against units go up;
 * ratings go down, best first) and their name the other way. Fewest and most FCE hours are two sorts already.
 */
const TURNS: Partial<Record<ExplorerSort, { usual: SortDir; reversed: string }>> = {
  // Short enough for the Sort by menu's button.
  number: { usual: "asc", reversed: "Number, descending" },
  title: { usual: "asc", reversed: "Title, Z to A" },
  units: { usual: "asc", reversed: "Most units" },
  meets: { usual: "asc", reversed: "Latest start time" },
  ratio: { usual: "asc", reversed: "Heaviest vs units" },
  rating: { usual: "desc", reversed: "Lowest rated" },
  teaching: { usual: "desc", reversed: "Lowest teaching" },
};

/** `dir` when it turns `sort` around from its usual way; otherwise (and for sorts that don't turn) null. */
export function sortDir(sort: ExplorerSort, dir: SortDir | null): SortDir | null {
  const turn = TURNS[sort];
  return turn !== undefined && dir !== null && dir !== turn.usual ? dir : null;
}

/** The sort's name in the Sort by menu, turned around when `dir` turns it. */
export function sortLabel(sort: ExplorerSort, dir: SortDir | null): string {
  return sortDir(sort, dir) === null ? SORT_LABELS[sort] : (TURNS[sort]?.reversed ?? SORT_LABELS[sort]);
}

const COLUMNS: readonly ListColumn[] = ["number", "title", "meets", "hours", "rating", "units"];
const isColumn = (sort: ExplorerSort): sort is ListColumn => (COLUMNS as readonly string[]).includes(sort);

/** The column the list is sorted by and which way, for its headers; null when no column shows the sort. */
export function sortedColumn(sort: ExplorerSort, dir: SortDir | null): SortedColumn | null {
  if (sort === "hours-desc") return { column: "hours", dir: "desc" };
  if (!isColumn(sort)) return null;
  return { column: sort, dir: sortDir(sort, dir) ?? TURNS[sort]?.usual ?? "asc" };
}

/**
 * The query after a click on a column's header: the column's sort its usual way (fewest FCE hours, best rating,
 * otherwise going up), or the other way round when the list is sorted by that column already.
 */
export function sortByColumn(query: ExplorerQuery, current: SortedColumn | null, column: ListColumn): ExplorerQuery {
  const again = current?.column === column;
  if (column === "hours")
    return { ...query, sort: again && current.dir === "asc" ? "hours-desc" : "hours", dir: null };
  if (!again) return { ...query, sort: column, dir: null };
  return { ...query, sort: column, dir: sortDir(column, current.dir === "asc" ? "desc" : "asc") };
}

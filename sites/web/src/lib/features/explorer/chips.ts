// The removable chips above the results: one per active filter, each with the query it leaves when removed.
import { EMPTY_FILTERS, UNIT_BUCKETS, type Filters } from "../../core/explorer/filters.ts";
import { DAY_SHORT, formatTime } from "../../core/time.ts";
import { EMPTY_EXTRA, unitsActive, type ExplorerQuery, type ExtraFilters } from "./query.ts";

export interface FilterChip {
  key: string;
  label: string;
  /** The query without this filter. */
  next: ExplorerQuery;
}

export interface ChipNames {
  department: (code: string) => string;
  /** Mini number to its name ("Mini 3"). */
  mini: (number: string) => string;
  /** The requirement filter's name, once known. */
  requirement: string | null;
}

const LEVELS: Record<string, string> = { U: "Undergraduate", G: "Graduate" };

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

type Add = (key: string, label: string, patch: Partial<Filters>) => void;
type AddExtra = (key: string, label: string, patch: Partial<ExtraFilters>) => void;

/** Department, units, offered in, level and requirement. */
function catalogChips(query: ExplorerQuery, names: ChipNames, add: Add, addExtra: AddExtra): void {
  const f = query.filters;
  if (f.saved) add("saved", "Saved", { saved: false });
  for (const dept of f.depts)
    add(`dept:${dept}`, names.department(dept), { depts: f.depts.filter((d) => d !== dept) });
  if (unitsActive(query.extra)) {
    const { unitsLow, unitsHigh } = query.extra;
    const label =
      unitsLow === unitsHigh ? `${unitsLow} Units` : `${unitsLow}\u2013${unitsHigh} Units`;
    addExtra("units", label, { unitsLow: EMPTY_EXTRA.unitsLow, unitsHigh: EMPTY_EXTRA.unitsHigh });
  }
  for (const bucket of f.units) {
    const label =
      bucket === "var" ? "Variable" : (UNIT_BUCKETS.find((b) => b.id === bucket)?.label ?? bucket);
    add(`bucket:${bucket}`, `${label} units`, { units: f.units.filter((u) => u !== bucket) });
  }
  if (query.extra.fixed) addExtra("fixed", "Fixed units", { fixed: false });
  if (query.extra.seasons.length > 0) {
    const seasons = query.extra.seasons.map((s) => capitalize(s)).join(" or ");
    addExtra("seasons", `Offered in ${seasons}`, { seasons: [] });
  }
  for (const level of f.levels)
    add(`level:${level}`, LEVELS[level] ?? level, { levels: f.levels.filter((l) => l !== level) });
  if (query.extra.number !== null)
    addExtra("number", `${query.extra.number}00 level`, { number: null });
  if (f.req) add("req", names.requirement ?? "Requirement", { req: null });
}

/** Fits my schedule, days, times, sessions, delivery and scheduled only. */
function scheduleChips(f: Filters, names: ChipNames, add: Add): void {
  if (f.fits) add("fits", "Fits my schedule", { fits: false });
  if (f.days.length > 0) {
    const days = f.days.map((d) => DAY_SHORT[d]).join(", ");
    const label = f.dayMode === "only" ? `Only ${days}` : `Meets ${days}`;
    add("days", label, { days: [], dayMode: EMPTY_FILTERS.dayMode });
  }
  if (f.after !== null) add("after", `Starts ${formatTime(f.after)} or later`, { after: null });
  if (f.before !== null) add("before", `Ends by ${formatTime(f.before)}`, { before: null });
  for (const session of f.sessions) {
    const label = session === "full" ? "Full semester" : names.mini(session);
    add(`session:${session}`, label, { sessions: f.sessions.filter((s) => s !== session) });
  }
  for (const delivery of f.delivery) {
    const label = delivery === "remote" ? "Remote" : "In person";
    add(`delivery:${delivery}`, label, { delivery: f.delivery.filter((d) => d !== delivery) });
  }
  if (f.scheduledOnly) add("scheduled", "Has a scheduled time", { scheduledOnly: false });
}

/** Workload and rating. */
function fceChips(f: Filters, add: Add): void {
  if (f.maxHours !== null) add("maxh", `At most ${f.maxHours} hrs/week`, { maxHours: null });
  if (f.minRating !== null) add("minrate", `Rated ${f.minRating.toFixed(1)}+`, { minRating: null });
  if (f.withinUnits) add("light", "No heavier than its units", { withinUnits: false });
}

export function filterChips(query: ExplorerQuery, names: ChipNames): FilterChip[] {
  const out: FilterChip[] = [];
  const add: Add = (key, label, patch) => {
    out.push({ key, label, next: { ...query, filters: { ...query.filters, ...patch } } });
  };
  const addExtra: AddExtra = (key, label, patch) => {
    out.push({ key, label, next: { ...query, extra: { ...query.extra, ...patch } } });
  };
  catalogChips(query, names, add, addExtra);
  scheduleChips(query.filters, names, add);
  fceChips(query.filters, add);
  return out;
}

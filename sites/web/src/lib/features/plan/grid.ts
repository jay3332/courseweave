// The semester grid's rows: each academic year's semesters (fall, spring, then summer when planned), with a slot
// for each fall or spring missing between the plan's start and its last semester so it can be added back where it
// belongs. Courseweave's features/degree/SemesterGrid.tsx.
import {
  academicYearStart,
  compareTerms,
  isSummer,
  missingSemesters,
  nextTerm,
} from "../../core/plan.ts";

export interface YearSlot<C> {
  term: string;
  /** The semester's column, or null for a semester the plan doesn't have (an "Add" slot). */
  column: C | null;
}

export interface YearRow<C> {
  /** The fall that starts the year ("F25"). */
  key: string;
  slots: YearSlot<C>[];
  /** The year's summer ("M26"), offered as "Add Summer 2026" until it's planned. */
  summer: string;
  hasSummer: boolean;
}

export interface GridRows<C> {
  years: YearRow<C>[];
  /** The semester after the plan's last one. */
  next: string;
  /** That semester falls in the last year (a plan ending in a fall gets its spring there, not at the bottom). */
  nextInLastYear: boolean;
}

export function gridRows<C extends { term: string }>(startTerm: string, columns: C[]): GridRows<C> {
  const years = new Map<string, YearSlot<C>[]>();
  const put = (slot: YearSlot<C>): void => {
    const key = academicYearStart(slot.term);
    years.set(
      key,
      [...(years.get(key) ?? []), slot].toSorted((a, b) => compareTerms(a.term, b.term)),
    );
  };
  for (const column of columns) put({ term: column.term, column });
  const terms = columns.map((c) => c.term);
  for (const term of missingSemesters(startTerm, terms)) put({ term, column: null });
  const last = terms.at(-1) ?? startTerm;
  const next = nextTerm(last);
  const nextInLastYear = columns.length > 0 && academicYearStart(next) === academicYearStart(last);
  if (nextInLastYear) put({ term: next, column: null });
  const rows = [...years.keys()].toSorted(compareTerms).map((key) => {
    const slots = years.get(key) ?? [];
    return {
      key,
      slots,
      summer: `M${String(Number(key.slice(1)) + 1).padStart(2, "0")}`,
      hasSummer: slots.some((s) => s.column !== null && isSummer(s.term)),
    };
  });
  return { years: rows, next, nextInLastYear };
}

/** A run of academic years without a single semester, shown as one line until it's opened. */
export interface EmptyYears<C> {
  kind: "gap";
  years: YearRow<C>[];
}

export type GridItem<C> = { kind: "year"; year: YearRow<C> } | EmptyYears<C>;

/**
 * The grid's rows with each run of years that have no semester, only "Add" slots, folded into one item, except
 * the years in `opened`. A pre-college summer before the first fall leaves such a run, and so does a year away.
 */
export function emptyYearRuns<C extends { term: string }>(
  startTerm: string,
  columns: C[],
  opened: Readonly<Record<string, boolean>>,
): Omit<GridRows<C>, "years"> & { items: GridItem<C>[] } {
  const { years, next, nextInLastYear } = gridRows(startTerm, columns);
  const items: GridItem<C>[] = [];
  for (const year of years) {
    const empty = year.slots.every((slot) => slot.column === null);
    const last = items.at(-1);
    if (!empty || opened[year.key] === true) items.push({ kind: "year", year });
    else if (last?.kind === "gap") last.years.push(year);
    else items.push({ kind: "gap", years: [year] });
  }
  return { items, next, nextInLastYear };
}

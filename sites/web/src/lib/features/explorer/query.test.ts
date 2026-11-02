/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { EMPTY_FILTERS } from "../../core/explorer/filters.ts";
import type { CatalogEntry } from "../../core/catalog-types.ts";
import {
  clearFilters,
  EMPTY_EXTRA,
  extraFilterCount,
  extraMatches,
  parseExplorer,
  sortByColumn,
  sortDir,
  sortedColumn,
  sortLabel,
  writeExplorer,
  type ExplorerQuery,
  type ExplorerSort,
} from "./query.ts";

const entry = (patch: Partial<CatalogEntry>): CatalogEntry => ({
  id: "15122",
  code: "15-122",
  title: "Principles of Imperative Computation",
  units: 12,
  prereqs: null,
  coreqs: [],
  antireqs: [],
  equivalents: [],
  passFail: false,
  ...patch,
});

describe("explorer query", () => {
  it("round-trips through URL parameters", () => {
    const query: ExplorerQuery = {
      term: "S27",
      q: "algorithms",
      sort: "units",
      dir: "desc",
      chart: true,
      unoffered: true,
      course: "15-122",
      filters: { ...EMPTY_FILTERS, depts: ["CS"], fits: true, req: { auditId: 1, nodeId: 2 } },
      extra: { unitsLow: 9, unitsHigh: 12, number: "3", seasons: ["fall", "summer"], fixed: true },
    };
    expect(parseExplorer(writeExplorer(query))).toEqual(query);
  });

  it("leaves defaults out of the URL", () => {
    const query = parseExplorer(new URLSearchParams(""));
    expect(writeExplorer(query).toString()).toBe("");
    expect(query.extra).toEqual(EMPTY_EXTRA);
  });

  it("ignores malformed values", () => {
    const query = parseExplorer(
      new URLSearchParams("ulo=-3&uhi=x&num=12&offered=winter,fall&fixed=yes&dir=up"),
    );
    expect(query.extra).toEqual({ ...EMPTY_EXTRA, seasons: ["fall"] });
    expect(query.dir).toBe(null);
  });

  it("orders a reversed units range", () => {
    const query = parseExplorer(new URLSearchParams("ulo=12&uhi=6"));
    expect([query.extra.unitsLow, query.extra.unitsHigh]).toEqual([6, 12]);
  });

  it("clears filters but keeps the search and view", () => {
    const query = parseExplorer(new URLSearchParams("q=x&term=F26&dept=CS&ulo=9&unoffered=1"));
    const cleared = clearFilters(query);
    expect(cleared.filters).toEqual(EMPTY_FILTERS);
    expect(cleared.extra).toEqual(EMPTY_EXTRA);
    expect([cleared.q, cleared.term, cleared.unoffered]).toEqual(["x", "F26", true]);
  });

  it("counts the extra filters", () => {
    expect(
      extraFilterCount({ unitsLow: 0, unitsHigh: 12, number: "1", seasons: ["fall"], fixed: true }),
    ).toBe(4);
    expect(extraFilterCount(EMPTY_EXTRA)).toBe(0);
  });
});

describe("sorting by a column", () => {
  const query = parseExplorer(new URLSearchParams("q=x&sort=title"));
  /** The query after clicking `column`'s header `times` times. */
  const click = (column: Parameters<typeof sortByColumn>[2], times: number): ExplorerQuery => {
    let next = query;
    for (let i = 0; i < times; i++)
      next = sortByColumn(next, sortedColumn(next.sort as ExplorerSort, next.dir), column);
    return next;
  };

  it("sorts FCE hours fewest first, then most first, then fewest again", () => {
    expect([click("hours", 1).sort, click("hours", 1).dir]).toEqual(["hours", null]);
    expect([click("hours", 2).sort, click("hours", 2).dir]).toEqual(["hours-desc", null]);
    expect(click("hours", 3).sort).toBe("hours");
  });

  it("sorts ratings best first, then lowest first", () => {
    expect([click("rating", 1).sort, click("rating", 1).dir]).toEqual(["rating", null]);
    expect([click("rating", 2).sort, click("rating", 2).dir]).toEqual(["rating", "asc"]);
    expect(click("rating", 3).dir).toBe(null);
  });

  it("sorts other columns going up, then down, and starts over on another column", () => {
    expect([click("meets", 1).sort, click("meets", 1).dir]).toEqual(["meets", null]);
    expect(click("meets", 2).dir).toBe("desc");
    const units = sortByColumn(click("meets", 2), sortedColumn("meets", "desc"), "units");
    expect([units.sort, units.dir]).toEqual(["units", null]);
  });

  it("marks the header for the sort and its direction", () => {
    expect(sortedColumn("hours-desc", null)).toEqual({ column: "hours", dir: "desc" });
    expect(sortedColumn("rating", null)).toEqual({ column: "rating", dir: "desc" });
    expect(sortedColumn("number", "desc")).toEqual({ column: "number", dir: "desc" });
    expect(sortedColumn("ratio", null)).toBe(null);
  });

  it("turns around only the sorts that have another way, and says so in the menu", () => {
    expect(sortDir("hours", "desc")).toBe(null);
    expect(sortDir("rating", "desc")).toBe(null);
    expect(sortDir("rating", "asc")).toBe("asc");
    expect(sortLabel("rating", "asc")).toBe("Lowest rated");
    expect(sortLabel("number", "asc")).toBe("Number");
  });
});

describe("extra filters", () => {
  const range = { ...EMPTY_EXTRA, unitsLow: 9, unitsHigh: 12 };

  it("matches fixed units inside the range", () => {
    expect(extraMatches({ id: "15122", units: 12 }, range)).toBe(true);
    expect(extraMatches({ id: "15122", units: 6 }, range)).toBe(false);
  });

  it("matches variable units whose catalog range overlaps", () => {
    expect(
      extraMatches({ id: "15400", units: null, entry: entry({ units: 3, unitsMax: 9 }) }, range),
    ).toBe(true);
    expect(
      extraMatches({ id: "15400", units: null, entry: entry({ units: 1, unitsMax: 6 }) }, range),
    ).toBe(false);
    expect(extraMatches({ id: "15400", units: null }, range)).toBe(false);
  });

  it("leaves variable units out with fixed units only", () => {
    const fixed = { ...EMPTY_EXTRA, fixed: true };
    expect(extraMatches({ id: "15122", units: 12 }, fixed)).toBe(true);
    expect(
      extraMatches({ id: "15400", units: null, entry: entry({ units: 3, unitsMax: 9 }) }, fixed),
    ).toBe(false);
  });

  it("matches the course-number level", () => {
    const level = { ...EMPTY_EXTRA, number: "2" };
    expect(extraMatches({ id: "15213", units: 12 }, level)).toBe(true);
    expect(extraMatches({ id: "15122", units: 12 }, level)).toBe(false);
  });

  it("matches seasons from the catalog or from offered semesters", () => {
    const fall = { ...EMPTY_EXTRA, seasons: ["fall" as const] };
    expect(
      extraMatches({ id: "15122", units: 12, entry: entry({ offered: ["fall"] }) }, fall),
    ).toBe(true);
    expect(extraMatches({ id: "15122", units: 12, terms: ["F26"] }, fall)).toBe(true);
    expect(extraMatches({ id: "15122", units: 12, terms: ["S27"] }, fall)).toBe(false);
  });
});

/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { emptyYearRuns, gridRows, type GridItem } from "./grid.ts";

const cols = (...terms: string[]) => terms.map((term) => ({ term }));
/** Each item as its year, or its run of years after "gap:". */
const keys = (items: GridItem<{ term: string }>[]) =>
  items.map((item) =>
    item.kind === "gap" ? `gap:${item.years.map((y) => y.key).join(",")}` : item.year.key,
  );

describe("gridRows", () => {
  it("groups semesters into academic years, fall first", () => {
    const { years, next, nextInLastYear } = gridRows("F25", cols("F25", "S26", "F26", "S27"));
    expect(years.map((y) => y.key)).toEqual(["F25", "F26"]);
    expect(years[0]?.slots.map((s) => s.term)).toEqual(["F25", "S26"]);
    expect(years[0]?.summer).toBe("M26");
    expect(years[0]?.hasSummer).toBe(false);
    expect(next).toBe("F27");
    expect(nextInLastYear).toBe(false);
  });

  it("puts a planned summer last in its year", () => {
    const { years } = gridRows("F25", cols("F25", "S26", "M26", "F26"));
    expect(years[0]?.slots.map((s) => s.term)).toEqual(["F25", "S26", "M26"]);
    expect(years[0]?.hasSummer).toBe(true);
  });

  it("offers removed semesters back where they belong", () => {
    const { years } = gridRows("F25", cols("F25", "F26", "S27"));
    expect(years[0]?.slots).toEqual([
      { term: "F25", column: { term: "F25" } },
      { term: "S26", column: null },
    ]);
  });

  it("adds a plan ending in a fall's spring within that year", () => {
    const { years, next, nextInLastYear } = gridRows("F25", cols("F25", "S26", "F26"));
    expect(next).toBe("S27");
    expect(nextInLastYear).toBe(true);
    expect(years[1]?.slots).toEqual([
      { term: "F26", column: { term: "F26" } },
      { term: "S27", column: null },
    ]);
  });

  it("starts an empty plan from its first semester", () => {
    const { years, next } = gridRows("F25", []);
    expect(years).toEqual([]);
    expect(next).toBe("S26");
  });
});

describe("emptyYearRuns", () => {
  it("folds the years between a pre-college summer and the first fall into one item", () => {
    const { items, next } = emptyYearRuns("M24", cols("M24", "F26", "S27"), {});
    expect(keys(items)).toEqual(["F23", "gap:F24,F25", "F26"]);
    expect(next).toBe("F27");
  });

  it("shows the years again once they're opened", () => {
    const { items } = emptyYearRuns("M24", cols("M24", "F26", "S27"), { F24: true, F25: true });
    expect(keys(items)).toEqual(["F23", "F24", "F25", "F26"]);
  });

  it("folds a single year away", () => {
    expect(keys(emptyYearRuns("F25", cols("F25", "S26", "F27", "S28"), {}).items)).toEqual([
      "F25",
      "gap:F26",
      "F27",
    ]);
  });

  it("leaves years with a semester alone, even when one of their semesters is missing", () => {
    expect(keys(emptyYearRuns("F25", cols("F25", "F26", "S27"), {}).items)).toEqual(["F25", "F26"]);
  });
});

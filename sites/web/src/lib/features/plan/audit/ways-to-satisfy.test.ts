/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import type { CatalogEntry, CatalogIndex } from "../../../core/catalog-types.ts";
import type { ReqNode } from "../../../core/degree-types.ts";
import { expect } from "../../../testing.ts";
import { orderByOffering, satisfyingCourses } from "./ways-to-satisfy.ts";

const entry = (id: string): CatalogEntry => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units: 9,
  prereqs: null,
  coreqs: [],
  antireqs: [],
  equivalents: [],
  passFail: false,
});
const catalogOf = (...ids: string[]): CatalogIndex => ({
  courses: Object.fromEntries(ids.map((id) => [id, entry(id)])),
});
const pool = (dept: string): ReqNode => ({
  id: 1,
  name: "Electives",
  rule: { kind: "all" },
  children: [],
  notes: [],
  pool: [{ sets: [{ depts: [dept] }], units: true, min: 9 }],
});

describe("orderByOffering", () => {
  const order = (shown: string[], last: Record<string, string>, ids: string[]) =>
    orderByOffering(
      ids,
      (id) => shown.includes(id),
      (id) => last[id] ?? null,
    );

  it("puts what the semester shown offers first, then the most recently offered", () => {
    const last = { "15100": "S27", "15200": "F24", "15300": "S26", "15400": "S27" };
    expect(order(["15400", "15100"], last, ["15100", "15200", "15300", "15400", "15500"])).toEqual([
      "15100",
      "15400",
      "15300",
      "15200",
      "15500",
    ]);
  });

  it("compares semesters by date, not by their codes", () => {
    const last = { "15100": "S26", "15200": "M26", "15300": "F26" };
    expect(order([], last, ["15100", "15200", "15300"])).toEqual(["15300", "15200", "15100"]);
  });

  it("orders ties and courses never offered by number", () => {
    const last = { "15300": "F26", "15200": "F26" };
    expect(order([], last, ["15400", "15300", "15100", "15200"])).toEqual([
      "15200",
      "15300",
      "15100",
      "15400",
    ]);
  });
});

describe("satisfyingCourses", () => {
  it("matches the catalog once per requirement and catalog", () => {
    const node = pool("15");
    const catalog = catalogOf("15122", "15151", "21127");
    const first = satisfyingCourses(node, catalog);
    expect(first).toEqual(["15122", "15151"]);
    expect(satisfyingCourses(node, catalog)).toBe(first);
    const next = satisfyingCourses(node, catalogOf("15122", "15213"));
    expect(next).toEqual(["15122", "15213"]);
    expect(next).not.toBe(first);
  });
});

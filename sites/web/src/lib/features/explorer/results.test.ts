/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { EMPTY_FILTERS } from "../../core/explorer/filters.ts";
import type { FceSummary } from "../../core/fce.ts";
import type { Course, Day } from "../../core/types.ts";
import { EMPTY_EXTRA, type ExplorerSort } from "./query.ts";
import { filterCourses } from "./results.ts";

/** A course with one lecture meeting on `days` from `start` (minutes after midnight), or TBA. */
const course = (id: string, units: number | null, start: number | null, days: Day[] = [0, 2, 4]): Course => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units,
  dept: "CS",
  level: "U",
  instructors: [],
  sections: [
    {
      name: "1",
      kind: "lecture",
      parent: null,
      mini: null,
      mode: "IPE",
      instructors: [],
      meetings: [{ days, start, end: start === null ? null : start + 50, building: null, room: null }],
    },
  ],
  crossListed: [],
});

const summary = (hours: number | null, courseRate: number | null): FceSummary => ({
  hours,
  courseRate,
  teachingRate: null,
  responses: 10,
  terms: 2,
  totalTerms: 2,
  last: "S26",
  hoursDelta: null,
  enrolled: 10,
  mini: { share: 0, half: null },
});

const courses = [
  course("15122", 12, 10 * 60),
  course("15150", 12, 9 * 60, [1, 3]),
  course("15213", null, null),
  course("15251", 9, 9 * 60),
];
const fce = new Map([
  ["15122", summary(12, 4.1)],
  ["15150", summary(9, 4.5)],
  ["15251", summary(11, 3.9)],
]);

/** The course ids in order for a sort, its usual way or turned around. */
const order = (sort: ExplorerSort, dir: "asc" | "desc" | null = null): string[] =>
  filterCourses(
    courses.map((c) => ({ course: c, score: 1 })),
    {
      filters: EMPTY_FILTERS,
      extra: EMPTY_EXTRA,
      sort,
      dir,
      ctx: { bookmarks: new Set(), fittingSelections: () => [], fce },
      catalog: null,
      termsOf: () => undefined,
    },
  ).map((c) => c.id);

describe("course order", () => {
  it("sorts by meeting time, earliest first and then the earliest day, with TBA last", () => {
    expect(order("meets")).toEqual(["15251", "15150", "15122", "15213"]);
  });

  it("turns a sort around and keeps what it can't order last", () => {
    expect(order("meets", "desc")).toEqual(["15122", "15150", "15251", "15213"]);
    expect(order("rating", "asc")).toEqual(["15251", "15122", "15150", "15213"]);
    expect(order("units", "desc")).toEqual(["15150", "15122", "15251", "15213"]);
    expect(order("number", "desc")).toEqual(["15251", "15213", "15150", "15122"]);
  });

  it("leaves the usual way alone", () => {
    expect(order("rating")).toEqual(["15150", "15122", "15251", "15213"]);
    expect(order("hours")).toEqual(["15150", "15251", "15122", "15213"]);
  });
});

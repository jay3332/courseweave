/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { normalize } from "../../core/search.ts";
import type { ListedDoc } from "../instructor/directory.ts";
import { findInstructors, parseFinderQuery } from "./finder.ts";

/** A made-up instructor teaching `courses` (titled `titles`), in a built semester or only in the FCE history. */
const person = (name: string, courses: string[], titles: string, teaching = true): ListedDoc => ({
  inst: {
    name,
    slug: normalize(name).replaceAll(" ", "-"),
    courseIds: courses,
    sectionCount: 1,
    depts: [],
    terms: teaching ? ["S27"] : [],
    rating: null,
    fceCourses: null,
  },
  name: normalize(name),
  titles: normalize(titles),
  letter: name.charAt(0),
});

const docs = [
  person("Ada Lovelace", ["15122"], "Principles of Imperative Computation"),
  person("Alan Turing", ["15251"], "Great Ideas in Theoretical Computer Science"),
  person("Grace Hopper", ["15122", "15213"], "Introduction to Computer Systems", false),
  person("Grace Brewster", ["21241"], "Matrices and Linear Transformations"),
];

const names = (text: string, namesOnly: boolean): string[] =>
  findInstructors(docs, text, 8, namesOnly).map((i) => i.name);

describe("the header's search", () => {
  it("searches only instructors after an @", () => {
    expect(parseFinderQuery("  @ turing ")).toEqual({ text: "turing", instructorsOnly: true });
    expect(parseFinderQuery("15-122")).toEqual({ text: "15-122", instructorsOnly: false });
  });

  it("finds instructors by name beside courses, but not by what they teach", () => {
    expect(names("turing", true)).toEqual(["Alan Turing"]);
    expect(names("15-122", true)).toEqual([]);
    expect(names("computer", true)).toEqual([]);
  });

  it("finds them by the courses they teach after an @", () => {
    expect(names("15-122", false)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("puts people teaching in a built semester first among equal matches", () => {
    expect(names("grace", true)).toEqual(["Grace Brewster", "Grace Hopper"]);
  });

  it("finds nobody without a query", () => {
    expect(names(" ", false)).toEqual([]);
  });
});

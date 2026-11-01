/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import type { AttachedProgram, DoubleCountRule, ProgramVersion } from "../degree-types.ts";
import type { ProgramInfo, ProgramsIndex } from "../plan-types.ts";
import { bundlesForEntryYear } from "./year-bundles.ts";

// Shaped like the real programs: SCS's gen ed is one Stellic program per entry year.
const bundle = (catalogId: number, name: string, auditId: number, entryYear: number): ProgramInfo => ({
  catalogId,
  name,
  kind: "requirements",
  versions: [{ auditId, name: `EY${entryYear}`, entryYear, campus: null }],
});
const index: ProgramsIndex = {
  programs: [
    { catalogId: 1177, name: "BS in Artificial Intelligence", kind: "major", versions: [] },
    bundle(1400, "EY2019 - SCS General Education Requirements (AI)", 5026, 2019),
    bundle(1554, "EY2020 SCS - General Education", 16422, 2020),
    bundle(1677, "EY2021 SCS - General Education", 19730, 2021),
    bundle(1813, "EY2022 SCS - General Education", 19732, 2022),
    bundle(1964, "EY2023+ SCS - General Education", 20440, 2023),
  ],
};

const EY2020: AttachedProgram = { catalogId: 1554, name: "EY2020 SCS - General Education", auditId: 16422 };
const general: DoubleCountRule = {
  programs: [],
  programNames: [],
  limit: 0,
  units: false,
  exceptions: [{ nodes: [1], limit: 5, units: false }],
};

/** BS in Artificial Intelligence as Stellic has it: every version's sharing rule names EY2020's gen ed. */
const major = (attached: AttachedProgram[], entryYear: number | null = 2025): ProgramVersion => ({
  auditId: 19747,
  catalogId: 1177,
  programName: "BS in Artificial Intelligence",
  name: "EY2025 Pittsburgh",
  kind: "major",
  entryYear,
  campus: "Pittsburgh",
  totalUnits: 360,
  attached,
  doubleCount: [
    general,
    {
      programs: attached.map((a) => a.catalogId),
      programNames: attached.map((a) => a.name),
      limit: 0,
      units: false,
      exceptions: [],
    },
  ],
  concentrations: [],
  root: { id: 1, name: "BS in Artificial Intelligence", rule: { kind: "all" }, children: [], notes: [] },
});

describe("gen eds split by entry year", () => {
  it("checks the gen ed for the student's entry year, not the one the major names", () => {
    const v = bundlesForEntryYear(major([EY2020]), index, 2025);
    expect(v.attached).toEqual([
      { catalogId: 1964, name: "EY2023+ SCS - General Education", auditId: 20440 },
    ]);
  });

  it("points the major's sharing limit for its gen ed at the gen ed it checks", () => {
    const v = bundlesForEntryYear(major([EY2020]), index, 2024);
    expect(v.doubleCount[1]?.programs).toEqual([1964]);
    expect(v.doubleCount[1]?.programNames).toEqual(["EY2023+ SCS - General Education"]);
    expect(v.doubleCount[0]).toBe(general);
  });

  it("takes the newest gen ed that started by the entry year", () => {
    expect(bundlesForEntryYear(major([EY2020]), index, 2022).attached[0]?.auditId).toBe(19732);
    expect(bundlesForEntryYear(major([EY2020]), index, 2021).attached[0]?.auditId).toBe(19730);
    const same = major([EY2020]);
    expect(bundlesForEntryYear(same, index, 2020)).toBe(same);
    expect(bundlesForEntryYear(same, index, 2019)).toBe(same);
  });

  it("uses the version's own entry year when the student's isn't known", () => {
    expect(bundlesForEntryYear(major([EY2020]), index, null).attached[0]?.catalogId).toBe(1964);
    const unknown = major([EY2020], null);
    expect(bundlesForEntryYear(unknown, index, null)).toBe(unknown);
  });

  it("leaves bundles alone that aren't named for an entry year or have no newer namesake", () => {
    const core = major([{ catalogId: 99, name: "CMU Core Requirements", auditId: null }]);
    expect(bundlesForEntryYear(core, index, 2025)).toBe(core);
    const old = major([{ catalogId: 1400, name: "EY2019 - SCS General Education Requirements (AI)", auditId: 5026 }]);
    expect(bundlesForEntryYear(old, index, 2025)).toBe(old);
  });

  it("doesn't check a gen ed twice when the major names both", () => {
    const both = major([EY2020, { catalogId: 1964, name: "EY2023+ SCS - General Education", auditId: 20440 }]);
    expect(bundlesForEntryYear(both, index, 2025).attached.map((a) => a.catalogId)).toEqual([1964]);
  });
});

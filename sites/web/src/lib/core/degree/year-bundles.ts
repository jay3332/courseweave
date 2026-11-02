// Gen eds that Stellic splits by entry year. Some requirement bundles are one Stellic program per entry year ("EY2020
// SCS - General Education", "EY2021 SCS - General Education", ..., "EY2023+ SCS - General Education"), and a major's
// sharing rules, which are what attach a bundle to it (docs/src/api/catalog-fce-programs.md), can name an old one in
// every version: BS in Artificial Intelligence's still name EY2020's in its EY2025 version. Audits use the bundle for
// the student's entry year instead.
import type { AttachedProgram, ProgramVersion } from "../degree-types.ts";
import type { ProgramInfo, ProgramsIndex } from "../plan-types.ts";
import { defaultVersion } from "../programs.ts";

/** "EY2020 ", "EY 2023+ ", "EY2018 - ": an entry year leading a bundle's name. */
const LEADING_YEAR = /^\s*EY\s?(\d{4})\+?\s*(?:-\s*)?/iu;

/** A bundle named for an entry year: the year, and the rest of the name without case or extra spaces. */
function yearSplit(name: string): { year: number; rest: string } | null {
  const match = LEADING_YEAR.exec(name);
  if (match === null) return null;
  const rest = name.slice(match[0].length).replaceAll(/\s+/gu, " ").trim().toLowerCase();
  return rest === "" ? null : { year: Number(match[1]), rest };
}

/** The bundle with `a`'s name for students who entered in `year`: the newest that started by then, or `a`. */
function forYear(
  a: AttachedProgram,
  programs: readonly ProgramInfo[],
  year: number,
  campus: string,
): AttachedProgram {
  const split = yearSplit(a.name);
  if (split === null) return a;
  let best: { info: ProgramInfo; year: number } | null = null;
  for (const info of programs) {
    if (info.kind !== "requirements") continue;
    const other = yearSplit(info.name);
    if (other === null || other.rest !== split.rest || other.year > year) continue;
    if (best === null || other.year > best.year) best = { info, year: other.year };
  }
  if (best === null || best.info.catalogId === a.catalogId) return a;
  const version = defaultVersion(best.info, year, campus);
  return version === null
    ? a
    : { catalogId: best.info.catalogId, name: best.info.name, auditId: version.auditId };
}

/**
 * `version` with its year-split bundles swapped for the ones for students who entered in `entryYear` (without it, the
 * version's own entry year). Sharing rules that named a swapped bundle name its replacement, so the limits the major
 * set for its gen ed still apply. `version` itself when nothing changes.
 */
export function bundlesForEntryYear(
  version: ProgramVersion,
  index: ProgramsIndex,
  entryYear: number | null,
): ProgramVersion {
  const year = entryYear ?? version.entryYear;
  if (year === null || version.attached.length === 0) return version;
  const swaps = new Map<number, AttachedProgram>();
  const attached: AttachedProgram[] = [];
  for (const a of version.attached) {
    const next = forYear(a, index.programs, year, version.campus ?? "Pittsburgh");
    if (next !== a) swaps.set(a.catalogId, next);
    // The version may list the bundle it's swapped for already.
    if (!attached.some((b) => b.catalogId === next.catalogId)) attached.push(next);
  }
  if (swaps.size === 0) return version;
  const doubleCount = version.doubleCount.map((rule) =>
    rule.programs.some((id) => swaps.has(id))
      ? {
          ...rule,
          programs: rule.programs.map((id) => swaps.get(id)?.catalogId ?? id),
          programNames: rule.programNames.map((name, i) => {
            const id = rule.programs[i];
            return (id === undefined ? undefined : swaps.get(id))?.name ?? name;
          }),
        }
      : rule,
  );
  return { ...version, attached, doubleCount };
}

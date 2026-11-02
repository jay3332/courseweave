// The courses "Ways to satisfy" lists under a pool requirement, and their order: what a student could take soonest
// first, not what's easiest. The Courses page ("Browse in Courses") sorts and filters them every other way.
import { courseOptions } from "../../../core/audit.ts";
import type { CatalogIndex } from "../../../core/catalog-types.ts";
import type { ReqNode } from "../../../core/degree-types.ts";
import { termOrdinal } from "../../../core/requisites.ts";

// Matching a pool scans the whole catalog, so each requirement's matches are kept for as long as its node and the
// catalog are: editing the plan only filters and orders them again.
const matches = new WeakMap<ReqNode, { catalog: CatalogIndex; ids: string[] }>();

/** Every catalog course that could count toward a requirement, by number. Don't change the array returned. */
export function satisfyingCourses(node: ReqNode, catalog: CatalogIndex): readonly string[] {
  const hit = matches.get(node);
  if (hit?.catalog === catalog) return hit.ids;
  const ids = courseOptions(node, catalog, Infinity);
  matches.set(node, { catalog, ids });
  return ids;
}

/**
 * Orders ways to satisfy a requirement by when they're offered: courses the semester shown offers first, then the
 * rest by the newest semester offering them, so courses not offered in years sink, then by course number. Courses
 * no built semester offers come last.
 */
export function orderByOffering(
  ids: readonly string[],
  offered: (courseId: string) => boolean,
  lastOffered: (courseId: string) => string | null,
): string[] {
  const keyed = ids.map((id) => {
    const last = lastOffered(id);
    return { id, offered: offered(id), recency: (last === null ? null : termOrdinal(last)) ?? -1 };
  });
  return keyed
    .toSorted(
      (a, b) =>
        Number(b.offered) - Number(a.offered) ||
        b.recency - a.recency ||
        (a.id < b.id ? -1 : Number(a.id > b.id)),
    )
    .map((k) => k.id);
}

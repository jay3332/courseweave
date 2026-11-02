// What the header's search ("Find a course", Ctrl+K) looks for: courses and, signed in, instructors by name. A query
// starting with @ searches only instructors, and then also finds them by the courses they teach ("@15-122").
import { scoreInstructor } from "../../core/instructors/instructorData.ts";
import { normalize, wordStarts } from "../../core/search.ts";
import type { ListedDoc, ListedInstructor } from "../instructor/directory.ts";

export interface FinderQuery {
  /** The text to search for, without the @. */
  text: string;
  /** Started with @: instructors only. */
  instructorsOnly: boolean;
}

export function parseFinderQuery(raw: string): FinderQuery {
  const trimmed = raw.trim();
  return trimmed.startsWith("@")
    ? { text: trimmed.slice(1).trim(), instructorsOnly: true }
    : { text: trimmed, instructorsOnly: false };
}

/** Every word of the query starts a word of the name (or, from three letters, appears in it). */
function namesMatch(doc: ListedDoc, text: string): boolean {
  return normalize(text)
    .split(/\s+/u)
    .filter((t) => t !== "")
    .every((t) => wordStarts(doc.name, t) || (t.length >= 3 && doc.name.includes(t)));
}

/**
 * Up to `limit` instructors for a query, best match first and then those teaching in a built semester. With
 * `namesOnly` (the search beside courses) only names count, so a course number doesn't list everyone teaching it.
 */
export function findInstructors(
  docs: readonly ListedDoc[],
  text: string,
  limit: number,
  namesOnly: boolean,
): ListedInstructor[] {
  if (text.trim() === "") return [];
  const scored: { doc: ListedDoc; score: number }[] = [];
  for (const doc of docs) {
    if (namesOnly && !namesMatch(doc, text)) continue;
    const score = scoreInstructor(doc, text);
    if (score > 0) scored.push({ doc, score });
  }
  const teaching = (doc: ListedDoc): number => ((doc.inst.terms?.length ?? 0) > 0 ? 1 : 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      teaching(b.doc) - teaching(a.doc) ||
      a.doc.name.localeCompare(b.doc.name),
  );
  return scored.slice(0, limit).map(({ doc }) => doc.inst);
}

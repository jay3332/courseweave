// Shared, cached reads for course components. A course card, row or page only needs a course id (and a semester):
// everything else it shows (catalog entry, description, FCEs, friends taking it, the student's requisite status) is
// loaded here once and shared by every component that asks, so a list of a hundred cards makes one request per
// document. Reading any of these in markup or $derived tracks it; the cache follows the session through
// `catalog.generation`.
import { api } from "$lib/api";
import type { CatalogDetails, CatalogIndex } from "$lib/core/catalog-types";
import type { Term } from "$lib/core/data";
import type { FceRow, FceSummaryData } from "$lib/core/fce";
import type { Offerings } from "$lib/core/offerings";
import type { SyllabusEntry } from "$lib/core/syllabus-files";
import { catalog, session, settle, SignInRequiredError } from "$lib/data";

export type SharedStatus = "loading" | "ready" | "signin" | "forbidden" | "error";

/** A shared load: its status and, once ready, its value. */
export interface Shared<T> {
  readonly status: SharedStatus;
  readonly value: T | undefined;
  readonly error: string | null;
}

// Bumped whenever a shared load settles. Svelte doesn't track state a reaction reads if that same reaction created
// it, and loads are often created by the first $derived that asks; so the loads keep plain fields and every read
// goes through this one signal, created here outside any reaction.
let settled = $state(0);

class SharedLoad<T> implements Shared<T> {
  #status: SharedStatus = "loading";
  #value: T | undefined;
  #error: string | null = null;

  constructor(promise: Promise<T>) {
    void settle(promise).then((result) => {
      if (result.status === "ready") this.#value = result.value;
      else if (result.status === "error") this.#error = result.error;
      this.#status = result.status;
      settled += 1;
    });
  }

  get status(): SharedStatus {
    void settled;
    return this.#status;
  }

  get value(): T | undefined {
    void settled;
    return this.#value;
  }

  get error(): string | null {
    void settled;
    return this.#error;
  }
}

const cache = new Map<string, SharedLoad<unknown>>();
let cachedGeneration = -1;

/** A load shared by every caller asking under `key`, for this session (instructor previews use it too). */
export function shared<T>(key: string, load: () => Promise<T>): Shared<T> {
  // Reading the generation makes every caller load again after the session changes.
  const generation = catalog.generation;
  if (generation !== cachedGeneration) {
    cache.clear();
    cachedGeneration = generation;
  }
  let entry = cache.get(key);
  if (entry === undefined) {
    entry = new SharedLoad<unknown>(load());
    cache.set(key, entry);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each key is only ever stored with one type
  return entry as Shared<T>;
}

/** Every course's requisites, grading and units. */
export function catalogIndex(): Shared<CatalogIndex> {
  return shared("catalog-index", () => catalog.catalogIndex());
}

/** A semester's courses and sections. */
export function termData(termId: string): Shared<Term> {
  return shared(`term:${termId}`, () => catalog.term(termId));
}

/** Which built semesters offer each course; null when this catalog has no offerings document. */
export function offerings(): Shared<Offerings | null> {
  return shared("offerings", () => catalog.offerings());
}

/** A course's description, website and profile; null when the catalog has none. */
export function courseDetails(courseId: string): Shared<CatalogDetails | null> {
  return shared(`details:${courseId}`, () => catalog.courseDetails(courseId));
}

/** FCE summaries (member data): `signin` while signed out, null value when this catalog has none. */
export function fceSummary(): Shared<FceSummaryData | null> {
  return shared("fce-summary", () => catalog.fceSummary());
}

/**
 * Who teaches each course: semester, then course id, to the instructors' names (member data), from the teaching
 * document, so a card can name them for any semester without loading that semester's courses. Null when this catalog
 * has none.
 */
export function teachersByTerm(): Shared<Map<string, Map<string, string[]>> | null> {
  return shared("teachers", async () => {
    const teaching = await catalog.teaching();
    if (teaching === null) return null;
    const byTerm = new Map<string, Map<string, string[]>>();
    for (const [name, { terms }] of Object.entries(teaching.instructors)) {
      for (const [termId, { courses }] of Object.entries(terms)) {
        let byCourse = byTerm.get(termId);
        if (byCourse === undefined) {
          byCourse = new Map();
          byTerm.set(termId, byCourse);
        }
        for (const courseId of courses) {
          const names = byCourse.get(courseId);
          if (names === undefined) byCourse.set(courseId, [name]);
          else names.push(name);
        }
      }
    }
    return byTerm;
  });
}

/** Every FCE row for a course, newest first (member data). */
export function courseFce(courseId: string): Shared<FceRow[]> {
  return shared(`fce:${courseId}`, () => catalog.courseFce(courseId));
}

/** A course's past syllabi, newest first (member data). */
export function courseSyllabi(courseId: string): Shared<SyllabusEntry[]> {
  return shared(`syllabi:${courseId}`, () => catalog.courseSyllabi(courseId));
}

/** Course id to the names of friends taking it in a semester. Signed out: `signin`. */
export function friendsTaking(termId: string): Shared<Record<string, string[]>> {
  // Signing in or out bumps the catalog generation, which clears this too.
  return shared(`friends:${termId}`, () =>
    session.signedIn
      ? api.friends.taking(termId)
      : Promise.reject(new SignInRequiredError("friends", "signin")),
  );
}

/** The semesters offering a course, newest first: from the offerings document, or the given fallback. */
export function offeredTerms(courseId: string): string[] | undefined {
  const all = offerings();
  if (all.status === "loading") return undefined;
  return all.value?.byId.get(courseId)?.terms ?? [];
}

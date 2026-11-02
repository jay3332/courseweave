// Catalog documents from `GET /api/catalog/<name>` (decision 16), with Courseweave's loaders on top: each document
// is requested once (concurrent callers share the request) and kept in memory until the session changes, when
// invalidate() drops everything, because signing in or out changes which version of a document the server sends.
// The browser's HTTP cache revalidates each request by ETag, so a reload only downloads documents that changed.
import { ApiError } from "../api/errors.ts";
import type { Api } from "../api/endpoints.ts";
import type { CatalogDetails, CatalogIndex } from "../core/catalog-types.ts";
import { indexTerm, type Term } from "../core/data.ts";
import type { ProgramVersion } from "../core/degree-types.ts";
import {
  decodeFceCourses,
  decodeFceInstructors,
  decodeFceSummary,
  type FceAccess,
  type FceRow,
  type FceSummaryData,
  type InstructorFce,
} from "../core/fce.ts";
import { setFceMiniSource } from "../core/fce-minis.ts";
import type { NameIndex } from "../core/fce-names.ts";
import { indexOfferings, type Offerings } from "../core/offerings.ts";
import { bundlesForEntryYear } from "../core/degree/year-bundles.ts";
import type { ProgramSelection, ProgramsIndex } from "../core/plan-types.ts";
import { loadAuditVersions } from "../core/programs.ts";
import type { SyllabiChunk, SyllabusEntry } from "../core/syllabus-files.ts";
import type { TeachingData, TermIndexEntry } from "../core/types.ts";
import type { CellFactory, Cell } from "./cell.ts";
import {
  docs,
  isMemberOnly,
  prefixOf,
  type BuildInfo,
  type DocumentTypes,
  type RegistrarFinal,
  withoutPlaceholders,
} from "./documents.ts";
import { SignInRequiredError } from "./errors.ts";

export { SignInRequiredError, settle } from "./errors.ts";
export type { Loaded } from "./errors.ts";

function isMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** `promise`, or `fallback` when the document doesn't exist (this deployment's catalog doesn't have it). */
async function orIfMissing<T, F>(promise: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await promise;
  } catch (error) {
    if (isMissing(error)) return fallback;
    throw error;
  }
}

/**
 * Says before a member-only document is requested whether the request would be refused: "signin" when nobody is
 * signed in, "forbidden" for an account that isn't a CMU one, null to go ahead.
 */
export type MemberGate = () => Promise<"signin" | "forbidden" | null>;

export class Catalog {
  readonly #api: Api;
  readonly #generation: Cell<number>;
  readonly #cache = new Map<string, Promise<unknown>>();
  #memberGate: MemberGate | null = null;

  constructor(api: Api, cell: CellFactory) {
    this.#api = api;
    this.#generation = cell(0);
  }

  /**
   * Bumped by invalidate(). Every loader reads it, so a Svelte effect or resource that calls a loader runs again
   * after the session changes.
   */
  get generation(): number {
    return this.#generation.value;
  }

  /**
   * Skips member-only documents the server would refuse, so a signed-out page doesn't request them only to get a
   * 401 (and a console error). Without a gate every document is requested.
   */
  setMemberGate(gate: MemberGate): void {
    this.#memberGate = gate;
  }

  /** Forgets every document, for a session change. */
  invalidate(): void {
    this.#cache.clear();
    setFceMiniSource(null);
    this.#generation.value += 1;
  }

  /**
   * Memoizes `load` under `key` for this session. A 401 stays cached (as SignInRequiredError) until invalidate();
   * other failures are forgotten so the next call tries again.
   */
  #memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    // Reading the generation also makes a caller inside a Svelte effect run again after the session changes.
    const generation = this.#generation.value;
    const cached = this.#cache.get(key);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each key is only ever stored with one type
    if (cached !== undefined) return cached as Promise<T>;
    const promise = load().catch((error: unknown) => {
      if (error instanceof SignInRequiredError) throw error;
      if (generation === this.#generation.value && this.#cache.get(key) === promise)
        this.#cache.delete(key);
      throw error;
    });
    this.#cache.set(key, promise);
    return promise;
  }

  /** Any document by name, as JSON. Rejects with SignInRequiredError on 401 and ApiError otherwise. */
  document<T>(name: string): Promise<T> {
    return this.#memo(`doc:${name}`, async () => {
      const refused =
        this.#memberGate !== null && isMemberOnly(name) ? await this.#memberGate() : null;
      if (refused !== null) throw new SignInRequiredError(name, refused);
      try {
        return await this.#api.catalog<T>(name);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          throw new SignInRequiredError(name, "signin");
        // Signed in with an account that isn't a CMU one.
        if (error instanceof ApiError && error.status === 403)
          throw new SignInRequiredError(name, "forbidden");
        throw error;
      }
    });
  }

  build(): Promise<BuildInfo> {
    return this.document<BuildInfo>(docs.build);
  }

  /** Every built semester, newest first. */
  terms(): Promise<TermIndexEntry[]> {
    return this.document<TermIndexEntry[]>(docs.terms);
  }

  /** A semester's courses and sections, indexed for lookups and search (Courseweave's loadTerm). */
  term(id: string): Promise<Term> {
    return this.#memo(`term:${id}`, async () =>
      indexTerm(await this.document<DocumentTypes["term"]>(docs.term(id))),
    );
  }

  catalogIndex(): Promise<CatalogIndex> {
    return this.document<CatalogIndex>(docs.catalogIndex);
  }

  /** Descriptions and profiles for every course with this number prefix; empty when none has any. */
  catalogDetails(prefix: string): Promise<Record<string, CatalogDetails>> {
    return this.#memo(`details:${prefix}`, async () =>
      withoutPlaceholders(
        await orIfMissing(
          this.document<Record<string, CatalogDetails>>(docs.catalogDetails(prefix)),
          {},
        ),
      ),
    );
  }

  /** A course's description and profile, or null when the catalog has none. */
  async courseDetails(courseId: string): Promise<CatalogDetails | null> {
    return (await this.catalogDetails(prefixOf(courseId)))[courseId] ?? null;
  }

  /** Which semesters offer each course; null when this catalog has no offerings document. */
  offerings(): Promise<Offerings | null> {
    return this.#memo("offerings", async () => {
      const data = await orIfMissing(
        this.document<DocumentTypes["offerings"]>(docs.offerings),
        null,
      );
      return data === null ? null : indexOfferings(data);
    });
  }

  /** Who teaches what in each semester (member data); null when this catalog has none. */
  teaching(): Promise<TeachingData | null> {
    return orIfMissing(this.document<TeachingData>(docs.teaching), null);
  }

  /** FCE summaries by course (member data); null when this catalog has no FCEs. */
  fceSummary(): Promise<FceSummaryData | null> {
    return this.#memo("fce:summary", async () => {
      const raw = await orIfMissing(
        this.document<DocumentTypes["fceSummary"]>(docs.fceSummary),
        null,
      );
      if (raw === null) return null;
      const summary = decodeFceSummary(raw);
      // Pure code (plan totals, workload) looks minis up synchronously once the summary is in.
      setFceMiniSource((id) => summary.courses.get(id)?.mini ?? null);
      return summary;
    });
  }

  /**
   * Whether FCEs can be shown: available, locked (member data and nobody is signed in) or unavailable (this
   * catalog has none, or they failed to load).
   */
  async fceAccess(): Promise<FceAccess> {
    try {
      return (await this.fceSummary()) === null ? "unavailable" : "available";
    } catch (error) {
      return error instanceof SignInRequiredError ? "locked" : "unavailable";
    }
  }

  /** The course-number prefixes that have FCE rows. */
  fceCoursesIndex(): Promise<string[]> {
    return orIfMissing(this.document<string[]>(docs.fceCoursesIndex), []);
  }

  /** FCE rows for every course with this number prefix, newest first. */
  fceCourses(prefix: string): Promise<Map<string, FceRow[]>> {
    return this.#memo(`fce:courses:${prefix}`, async () => {
      const raw = await orIfMissing(
        this.document<DocumentTypes["fceCourses"]>(docs.fceCourses(prefix)),
        {},
      );
      return decodeFceCourses(raw);
    });
  }

  /** Every FCE row for a course, newest first; empty when it has none. */
  async courseFce(courseId: string): Promise<FceRow[]> {
    return (await this.fceCourses(prefixOf(courseId))).get(courseId) ?? [];
  }

  /** The instructor FCE index, looked up by name; null when this catalog has no FCEs. */
  fceInstructors(): Promise<NameIndex<InstructorFce> | null> {
    return this.#memo("fce:instructors", async () => {
      const raw = await orIfMissing(
        this.document<DocumentTypes["fceInstructors"]>(docs.fceInstructors),
        null,
      );
      return raw === null ? null : decodeFceInstructors(raw);
    });
  }

  /**
   * The instructor list's document for a semester, or "all" (member data, decision 43); null when this catalog was
   * built without it.
   */
  instructorList(scope: string): Promise<DocumentTypes["instructorList"] | null> {
    return orIfMissing(
      this.document<DocumentTypes["instructorList"]>(docs.instructorList(scope)),
      null,
    );
  }

  /** Degree programs and their versions (member data). */
  programsIndex(): Promise<ProgramsIndex> {
    return this.document<ProgramsIndex>(docs.programsIndex);
  }

  /** One program version's requirements (member data). */
  program(auditId: number): Promise<ProgramVersion> {
    return this.document<ProgramVersion>(docs.program(auditId));
  }

  /** Several program versions, by audit id. */
  async programs(auditIds: number[]): Promise<Map<number, ProgramVersion>> {
    const versions = await Promise.all(auditIds.map((id) => this.program(id)));
    return new Map(versions.map((v) => [v.auditId, v]));
  }

  /**
   * The versions an audit of these programs uses: the selected ones plus attached gen eds and concentrations. Gen eds
   * Stellic splits by entry year are the ones for students who entered in `entryYear` (core/degree/year-bundles.ts).
   */
  auditVersions(
    programs: ProgramSelection[],
    entryYear: number | null = null,
  ): Promise<Map<number, ProgramVersion>> {
    if (programs.length === 0) return Promise.resolve(new Map<number, ProgramVersion>());
    // Without the program list, bundles stay the ones the majors name.
    const index = this.programsIndex().catch(() => null);
    const selected = new Set(programs.map((p) => p.auditId));
    return loadAuditVersions({ programs, courses: [] }, async (id) => {
      const [version, programsIndex] = await Promise.all([this.program(id), index]);
      return programsIndex !== null && selected.has(id)
        ? bundlesForEntryYear(version, programsIndex, entryYear)
        : version;
    });
  }

  /** Past syllabi for every course with this number prefix (member data); empty when none has any. */
  syllabi(prefix: string): Promise<SyllabiChunk> {
    return orIfMissing(this.document<SyllabiChunk>(docs.syllabi(prefix)), {});
  }

  /** A course's past syllabi, newest first. */
  async courseSyllabi(courseId: string): Promise<SyllabusEntry[]> {
    return (await this.syllabi(prefixOf(courseId)))[courseId] ?? [];
  }

  /** The registrar's final exam schedule for a semester; null until the registrar publishes one. */
  finals(termId: string): Promise<RegistrarFinal[] | null> {
    return orIfMissing(this.document<RegistrarFinal[]>(docs.finals(termId)), null);
  }
}

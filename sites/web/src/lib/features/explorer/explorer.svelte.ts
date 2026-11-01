// Everything the Courses page computes: the semester, the documents it needs, the requirement filter, the results
// and the courses other semesters offer. Create one per page while it initializes (it starts loads with $effect).
import { catalogIndex, fceSummary, offerings, termData } from "$lib/components/course/data.svelte";
import { allCourses } from "$lib/core/explorer/allSemesters";
import {
  activeFilterCount,
  FCE_SORTS,
  parseSort,
  withoutSectionFilters,
} from "$lib/core/explorer/filters";
import { requirementLabel } from "$lib/core/explorer/requirementHooks";
import { unofferedDocs } from "$lib/core/explorer/unoffered";
import { compileAcceptor } from "$lib/core/requirement-match";
import { termLabel, termOrdinal } from "$lib/core/requisites";
import type { Course } from "$lib/core/types";
import { catalog, resource, session } from "$lib/data";
import {
  buildScheduleView,
  device,
  fittingSelections,
  isAllSemesters,
  plans,
  resolveTerm,
  saved,
  schedules,
} from "$lib/state";
import { extraFilterCount, sortDir, type ExplorerSort } from "./query";
import { filterCourses, otherTermMatches, scoreDocs, unofferedMatches } from "./results";
import { ExplorerUrl } from "./url-state.svelte";

export class Explorer {
  readonly url = new ExplorerUrl();
  readonly terms = resource(() => catalog.terms());
  readonly #reqVersion = resource(() => {
    const req = this.filters.req;
    return req && session.signedIn ? catalog.program(req.auditId) : null;
  });

  get query() {
    return this.url.query;
  }

  readonly allMode = $derived(isAllSemesters(this.url.query.term));
  /** The semester shown, or in the all-semesters view the one underneath (last visited), for requisite checks. */
  readonly termId = $derived(
    this.terms.value
      ? resolveTerm(this.allMode ? null : this.url.query.term, this.terms.value, device.lastTerm)
      : null,
  );
  readonly termMeta = $derived(this.terms.value?.find((t) => t.id === this.termId) ?? null);
  readonly term = $derived(this.termId === null ? null : termData(this.termId));
  /** "Fall 2025-Spring 2027": the semesters with schedule data. */
  readonly termSpan = $derived.by(() => {
    const ids = (this.terms.value ?? [])
      .map((t) => t.id)
      .toSorted((a, b) => (termOrdinal(a) ?? 0) - (termOrdinal(b) ?? 0));
    const first = ids[0];
    const last = ids.at(-1);
    return first !== undefined && last !== undefined
      ? `${termLabel(first)}\u2013${termLabel(last)}`
      : null;
  });

  readonly index = $derived(catalogIndex());
  readonly offerings = $derived(offerings());
  readonly fce = $derived(fceSummary());
  readonly fceMap = $derived(
    this.fce.status === "ready" ? (this.fce.value?.courses ?? null) : null,
  );

  readonly all = $derived(
    this.allMode && this.offerings.status === "ready" && this.index.status !== "loading"
      ? allCourses(this.offerings.value ?? null, this.index.value ?? null)
      : undefined,
  );

  readonly loading = $derived(
    this.terms.status === "loading" ||
      (this.allMode
        ? this.offerings.status === "loading" || this.index.status === "loading"
        : this.term === null || this.term.status === "loading"),
  );
  readonly error = $derived(
    this.terms.status === "error"
      ? this.terms.error
      : !this.allMode && this.term?.status === "error"
        ? this.term.error
        : null,
  );

  readonly docs = $derived(
    this.allMode ? (this.all?.docs ?? []) : (this.term?.value?.searchDocs ?? []),
  );
  readonly departments = $derived(
    this.allMode ? (this.all?.departments ?? []) : (this.term?.value?.departments ?? []),
  );

  /** Without sections the day, time, delivery, session and schedule filters can't apply; they stay in the URL. */
  readonly filters = $derived(
    this.allMode ? withoutSectionFilters(this.url.query.filters) : this.url.query.filters,
  );
  readonly filterCount = $derived(
    activeFilterCount(this.filters) + extraFilterCount(this.url.query.extra),
  );
  readonly q = $derived(this.url.query.q.trim());
  readonly sort = $derived.by((): ExplorerSort => {
    // Meeting times need a semester's sections; the all-semesters view has none.
    if (this.url.query.sort === "meets" && !this.allMode) return "meets";
    const sort = parseSort(
      new URLSearchParams(this.url.query.sort === null ? "" : `sort=${this.url.query.sort}`),
      this.q !== "",
    );
    if (FCE_SORTS.includes(sort) && this.fceMap === null)
      return this.q === "" ? "number" : "relevance";
    return sort;
  });
  /** The other way round from the sort's usual way, or null. */
  readonly dir = $derived(sortDir(this.sort, this.url.query.dir));

  readonly scheduleView = $derived(
    !this.allMode && this.term?.value && this.termId !== null
      ? buildScheduleView(schedules.active(this.termId), this.term.value)
      : null,
  );

  /** "Counts toward a requirement": the chosen requirement compiled once; null (no filtering) while it loads. */
  readonly reqAccepts = $derived.by(() => {
    const req = this.filters.req;
    if (!req || this.#reqVersion.status === "loading" || this.index.status === "loading")
      return null;
    const version = this.#reqVersion.status === "ready" ? this.#reqVersion.value : undefined;
    if (!version || version.auditId !== req.auditId) return null;
    return compileAcceptor(version, req.nodeId, this.index.value ?? null, {
      ...(this.termId === null ? {} : { term: this.termId }),
      programIds: (plans.active?.programs ?? []).map((p) => p.catalogId),
    });
  });

  /** The requirement filter's chip text. */
  readonly reqName = $derived.by(() => {
    const req = this.filters.req;
    if (!req) return null;
    if (!session.signedIn) return "Requirement (sign in to apply it)";
    const status = this.#reqVersion.status;
    const version = status === "ready" ? this.#reqVersion.value : undefined;
    const label = requirementLabel(
      req,
      version
        ? { status: "ready", value: new Map([[version.auditId, version]]) }
        : status === "loading"
          ? { status: "loading" }
          : { status: "error", error: "" },
    );
    if (label.status === "ready") return `Counts toward ${label.name ?? "a requirement"}`;
    return label.status === "loading" ? "Requirement" : "Unknown requirement";
  });

  /** Semesters offering a course, newest first. */
  termsOf(courseId: string): readonly string[] | undefined {
    return this.allMode
      ? this.all?.termsOf.get(courseId)
      : this.offerings.value?.byId.get(courseId)?.terms;
  }

  readonly #scored = $derived(scoreDocs(this.docs, this.q));

  readonly results = $derived.by((): Course[] => {
    const view = this.scheduleView;
    const here = this.allMode ? null : this.termId;
    return filterCourses(this.#scored, {
      filters: this.filters,
      extra: this.url.query.extra,
      sort: this.sort,
      dir: this.dir,
      catalog: this.index.value ?? null,
      ctx: {
        bookmarks: new Set(saved.ids),
        fittingSelections: (course) => (view ? fittingSelections(course, view) : []),
        fce: this.fceMap,
        reqAccepts: this.reqAccepts,
      },
      termsOf: (id) => {
        const known = this.termsOf(id);
        return here === null ? known : [here, ...(known ?? [])];
      },
    });
  });

  /** Search matches from other semesters, while only department and level filters are on. */
  readonly otherMatches = $derived(
    this.allMode || this.termId === null || this.offerings.status !== "ready"
      ? []
      : otherTermMatches({
          offerings: this.offerings.value ?? null,
          catalog: this.index.value ?? null,
          termId: this.termId,
          offeredHere: (id) => this.term?.value?.courseById.has(id) ?? false,
          q: this.q,
          filters: this.filters,
          extra: this.url.query.extra,
        }),
  );

  /** "Show courses not offered": null while loading or when it's off. */
  readonly unoffered = $derived.by(() => {
    const term = this.term?.value;
    if (this.allMode || !this.url.query.unoffered || !term || this.offerings.status !== "ready")
      return null;
    if (this.index.status === "loading") return null;
    const docs = unofferedDocs(term, this.offerings.value ?? null, this.index.value ?? null) ?? [];
    return unofferedMatches({
      docs,
      q: this.q,
      filters: this.filters,
      extra: this.url.query.extra,
      sort: this.sort,
      dir: this.dir,
      ctx: { bookmarks: new Set(saved.ids), fce: this.fceMap, reqAccepts: this.reqAccepts },
      catalog: this.index.value ?? null,
      fce: this.fceMap,
    });
  });

  /** Paging and keyboard highlight start over when this changes. */
  readonly resultsKey = $derived(
    JSON.stringify([
      this.termId,
      this.allMode,
      this.q,
      this.filters,
      this.url.query.extra,
      this.sort,
      this.dir,
    ]),
  );
}

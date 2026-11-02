<script lang="ts">
  import { ChevronLeft, ListTree, Network } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { catalogIndex, termData } from "$lib/components/course/data.svelte";
  import { termRequisites } from "$lib/components/course/requisite-context.svelte";
  import RequiresAndUnlocks from "$lib/components/course/RequiresAndUnlocks.svelte";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import Title from "$lib/components/shell/Title.svelte";
  import CourseChip from "$lib/components/ui/CourseChip.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { storedViewOf, storeView } from "$lib/components/ui/ViewToggle.svelte";
  import { buildUnlocks, prerequisiteDepth } from "$lib/core/catalog";
  import { codeOf } from "$lib/core/requisite-format";
  import { coursePath, coursesPath } from "$lib/core/routes";
  import { formatUnits } from "$lib/core/time";
  import { catalog, resource } from "$lib/data";
  import { device, isAllSemesters, resolveTerm } from "$lib/state";
  import RequisiteGraph from "./graph/RequisiteGraph.svelte";
  import { requisitesPath, type RequisitesView } from "./paths";
  import RequisiteSearch from "./RequisiteSearch.svelte";

  let {
    courseId,
    requestedTerm,
    requestedView = null,
  }: {
    /** The course in the middle, as a five-digit id; null for the starting points. */
    courseId: string | null;
    requestedTerm: string | null;
    /** The view the link asked for (`?view=`); null for the one this device last chose. */
    requestedView?: RequisitesView | null;
  } = $props();

  const VIEWS: readonly RequisitesView[] = ["list", "graph"];
  const VIEW_OPTIONS = [
    { value: "list", label: "List", icon: ListTree },
    { value: "graph", label: "Graph", icon: Network },
  ];
  // The graph unless the link asks otherwise or this device chose the list.
  let view = $state<RequisitesView>(untrack(() => requestedView) ?? storedViewOf("requisites", VIEWS) ?? "graph");
  $effect(() => {
    if (requestedView !== null) view = requestedView;
  });

  /** Switches views, remembering the choice on this device and in the address (so it can be shared). */
  function chooseView(next: string): void {
    const chosen = VIEWS.find((v) => v === next);
    if (chosen === undefined || chosen === view) return;
    view = chosen;
    storeView("requisites", chosen);
    const url = new URL(page.url);
    if (chosen === "list") url.searchParams.set("view", "list");
    else url.searchParams.delete("view");
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }

  const terms = resource(() => catalog.terms());
  const termId = $derived(
    terms.value ? resolveTerm(isAllSemesters(requestedTerm) ? null : requestedTerm, terms.value, device.lastTerm) : null,
  );
  const term = $derived(termId === null ? null : termData(termId));
  const termValue = $derived(term?.value ?? null);
  const index = $derived(catalogIndex());

  // Every course link moves the explorer to that course, so the chain can be walked either way, in the same view.
  const recenter = (id: string): string => requisitesPath(id, termId, view === "list" ? "list" : null);
  // The student's standing on each requisite, once there's something to check against (as the course page does).
  const requisites = $derived(termId === null ? null : termRequisites(termId));
  const checking = $derived((requisites?.ctx?.credits.size ?? 0) > 0);
  const titleOf = (id: string): string | undefined =>
    termValue?.courseById.get(id)?.title ?? index.value?.courses[id]?.title;
  const offeredHere = (id: string): boolean => termValue?.courseById.has(id) ?? false;

  const entry = $derived(courseId === null ? undefined : index.value?.courses[courseId]);
  const offered = $derived(courseId === null ? undefined : termValue?.courseById.get(courseId));
  const title = $derived(offered?.title ?? entry?.title);
  const units = $derived(offered?.units ?? entry?.units ?? null);
  const unlocks = $derived(courseId !== null && index.value ? (buildUnlocks(index.value).get(courseId) ?? []) : []);
  const depth = $derived(courseId !== null && index.value ? prerequisiteDepth(index.value, courseId) : 0);

  // Starting points: the courses the most others list as a requisite.
  const gateways = $derived.by(() => {
    const value = index.value;
    if (!value) return [];
    return [...buildUnlocks(value)]
      .filter(([id]) => value.courses[id])
      .map(([id, list]) => ({ id, count: list.length, required: list.filter((u) => u.required).length }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 18);
  });

  $effect(() => {
    // A new course in the middle starts at the top.
    if (courseId !== null) window.scrollTo({ top: 0 });
  });
</script>

<Title value={courseId === null ? "Requisites" : `${codeOf(courseId)} requisites`} />

<PageContainer width="wide">
  <header class="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
    <div>
      <a
        href={courseId !== null && offered ? coursePath(courseId, termId) : coursesPath(termId)}
        class="-ml-1 mb-1 inline-flex min-h-10 items-center gap-1 rounded-full pr-2 text-label-lg text-muted hover:text-ink"
      >
        <ChevronLeft aria-hidden="true" class="size-5" />{courseId !== null && offered ? codeOf(courseId) : "Courses"}
      </a>
      <h1 class="text-heading-3 text-strong">Requisites</h1>
    </div>
    <div class="w-full md:w-[380px]">
      <RequisiteSearch index={index.value ?? null} term={termValue} onpick={(id) => goto(recenter(id))} />
    </div>
  </header>

  {#if index.status === "loading"}
    <div aria-busy="true" class="flex flex-col gap-4">
      <Skeleton class="h-32" />
      <Skeleton class="h-64" />
    </div>
  {:else if index.status === "error" || !index.value}
    <p class="text-body-2 text-danger">The course catalog didn't load. Reload the page to try again.</p>
  {:else if courseId !== null}
    {#if !title}
      <div class="rounded-card border border-pressed bg-surface p-5">
        <h2 class="text-heading-5 text-strong">No course {codeOf(courseId)}</h2>
        <p class="mt-1 text-body-2 text-ink">
          It isn't in the catalog or this semester's schedule. Search for another course above, or
          <a href={requisitesPath(null, termId)} class="text-accent-ink underline underline-offset-2"
            >start from the most common gateway courses</a
          >.
        </p>
      </div>
    {:else}
      <div class="flex min-w-0 flex-col gap-5">
        <!-- The course's heading on the page itself, with the List/Graph switch at its end. -->
        <section class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[40px] tabular leading-none font-semibold tracking-tight text-strong">{codeOf(courseId)}</p>
            <h2 class="mt-1 text-heading-4 text-strong">{title}</h2>
            <p class="mt-1.5 text-body-2 text-ink">
              {units === null ? "Variable units" : `${formatUnits(units)} units`}{entry?.passFail
                ? ", pass/fail only"
                : ""}
            </p>
            <dl class="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-body-2">
              <div class="flex gap-1.5" title="Courses in the shortest chain of prerequisites below this one">
                <dt class="text-muted">Prerequisite chain</dt>
                <dd class="text-ink">{depth === 0 ? "none" : `${depth} deep`}</dd>
              </div>
              <div class="flex gap-1.5">
                <dt class="text-muted">Unlocks</dt>
                <dd class="tabular text-ink">{unlocks.length === 1 ? "1 course" : `${unlocks.length} courses`}</dd>
              </div>
            </dl>
            <p class="mt-2 text-body-2">
              {#if offered && termValue}
                <a
                  href={coursePath(courseId, termId)}
                  class="inline-flex min-h-10 items-center text-label-lg text-accent-ink underline underline-offset-2 sm:min-h-0"
                  >Sections in {termValue.meta.name}</a
                >
              {:else}
                <span class="text-muted">Not offered in {termValue?.meta.name ?? "this semester"}.</span>
                <a
                  href={coursePath(courseId, "all")}
                  class="ml-1 inline-flex min-h-10 items-center text-label-lg text-accent-ink underline underline-offset-2 sm:min-h-0"
                  >Course details</a
                >
              {/if}
            </p>
          </div>
          <SegmentedControl
            options={VIEW_OPTIONS}
            label="Show requisites as"
            bind:value={() => view, chooseView}
          />
        </section>
        {#if view === "graph"}
          {#key courseId}
            <RequisiteGraph
              {courseId}
              index={index.value}
              {unlocks}
              {termId}
              termName={termValue?.meta.name}
              offered={termValue ? offeredHere : undefined}
              departments={termValue?.departments ?? []}
              title={titleOf}
              centerHref={recenter}
            />
          {/key}
        {:else}
          <RequiresAndUnlocks
            id={courseId}
            index={index.value}
            {unlocks}
            href={recenter}
            title={titleOf}
            status={checking ? (requisites?.prereqStatus ?? undefined) : undefined}
            coreqStatus={checking ? (requisites?.coreqStatus ?? undefined) : undefined}
            offered={termValue ? offeredHere : undefined}
            termName={termValue?.meta.name}
            departments={termValue?.departments ?? []}
            headingLevel={2}
          />
        {/if}
      </div>
    {/if}
  {:else}
    <section aria-labelledby="gateways" class="min-w-0">
      <h2 id="gateways" class="text-heading-4 text-strong">Gateway courses</h2>
      <p class="mt-1 mb-3 text-body-2 text-ink">The courses that the most other courses list as a requisite.</p>
      <ul class="grid min-w-0 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {#each gateways as g (g.id)}
          <li class="flex min-w-0 items-center gap-2 border-t border-line py-2">
            <CourseChip code={codeOf(g.id)} href={recenter(g.id)} />
            <span class="min-w-0 flex-1 truncate text-body-2 text-ink">{titleOf(g.id) ?? ""}</span>
            <span class="tabular shrink-0 text-label-md text-muted" title="{g.required} of these require it outright">
              {g.count} courses
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</PageContainer>

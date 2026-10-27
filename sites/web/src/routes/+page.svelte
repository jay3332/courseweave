<script lang="ts">
  import { SearchX } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { MediaQuery } from "svelte/reactivity";
  import RailLayout from "$lib/components/layout/RailLayout.svelte";
  import { roomBelow } from "$lib/components/layout/room-below";
  import { getSession } from "$lib/components/shell/session";
  import Title from "$lib/components/shell/Title.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { storedView, type ListView } from "$lib/components/ui/ViewToggle.svelte";
  import { parseCourseCode } from "$lib/core/data";
  import { departmentName } from "$lib/core/departments";
  import { FCE_SORTS, hasSectionFilters, type SortKey } from "$lib/core/explorer/filters";
  import { codeOf } from "$lib/core/requisite-format";
  import { coursePath } from "$lib/core/routes";
  import type { Course } from "$lib/core/types";
  import { ALL_SEMESTERS, semesterOptions } from "$lib/state";
  import CourseDetailPanel from "$lib/features/course/CourseDetailPanel.svelte";
  import { filterChips } from "$lib/features/explorer/chips";
  import CourseResults from "$lib/features/explorer/CourseResults.svelte";
  import { Explorer } from "$lib/features/explorer/explorer.svelte";
  import ExplorerRail from "$lib/features/explorer/ExplorerRail.svelte";
  import ExplorerToolbar from "$lib/features/explorer/ExplorerToolbar.svelte";
  import OtherCourses from "$lib/features/explorer/OtherCourses.svelte";
  import { clearFilters, SORT_LABELS } from "$lib/features/explorer/query";

  const session = getSession();
  const x = new Explorer();
  const url = x.url;
  const query = $derived(url.query);

  $effect(() => url.sync(page.url.searchParams));
  $effect(() => url.followSearch());
  $effect(() => () => url.destroy());

  // A course opens beside the list from 1024px. Below 1440px the filter rail collapses while it's open, to make room;
  // showing the rail again puts the course in place of the list, as on narrower screens.
  const wide = new MediaQuery("(min-width: 90rem)");
  const desktop = new MediaQuery("(min-width: 64rem)");
  let railCollapsed = $state(false);
  const selectedId = $derived(query.course === null ? null : parseCourseCode(query.course));
  const squeezed = $derived(selectedId !== null && desktop.current && !wide.current);
  const panelBeside = $derived(selectedId !== null && (wide.current || (squeezed && railCollapsed)));
  const panelAlone = $derived(selectedId !== null && !panelBeside);

  let view = $state<ListView>(storedView("courses") ?? "cards");
  const chart = $derived(query.chart && x.fceMap !== null);
  let limit = $state(0);
  let active = $state(-1);
  let otherLimit = $state(50);
  $effect.pre(() => {
    void x.resultsKey;
    active = -1;
    otherLimit = 50;
  });

  // A course opens in the detail panel beside the list (the full page is a link away from there): from 1024px, where
  // the rail folds away for it. Narrower, the panel would take the whole screen, so the full course page opens instead.
  const inPanel = $derived(desktop.current);
  const hrefFor = (course: Course): string =>
    inPanel ? url.href({ course: course.code }) : coursePath(course.code, x.allMode ? ALL_SEMESTERS : x.termId);
  const closeHref = $derived(url.href({ course: null }));

  $effect(() => {
    if (panelAlone) window.scrollTo({ top: 0 });
  });

  // ---- Keyboard: "/" focuses the search; arrows move through the results; Enter opens one ----

  let searchRef = $state<HTMLInputElement>();

  function isEditable(el: EventTarget | null): boolean {
    return (
      el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
    );
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    event.preventDefault();
    searchRef?.focus();
    searchRef?.select();
  }

  function onsearchkeydown(event: KeyboardEvent): void {
    const results = x.results;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      active = event.key === "ArrowDown" ? Math.min(results.length - 1, active + 1) : Math.max(0, active - 1);
      if (active >= limit) limit = active + 20;
      const id = results[active]?.id ?? "";
      requestAnimationFrame(() => document.querySelector(`#result-${id}`)?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter") {
      const course = results[Math.max(0, active)];
      if (course) void goto(hrefFor(course), inPanel ? { noScroll: true, keepFocus: true } : {});
    }
  }

  $effect(() => {
    const input = searchRef;
    if (!input) return;
    input.addEventListener("keydown", onsearchkeydown);
    return () => input.removeEventListener("keydown", onsearchkeydown);
  });

  // ---- Toolbar ----

  const termOptions = $derived(semesterOptions(x.terms.value ?? []));
  const sortOptions = $derived(
    (Object.keys(SORT_LABELS) as SortKey[])
      .filter((key) => !FCE_SORTS.includes(key) || x.fceMap !== null)
      .map((key) => ({ value: key, label: SORT_LABELS[key], disabled: key === "relevance" && x.q === "" })),
  );
  const chipList = $derived(
    filterChips(
      { ...query, filters: x.filters },
      {
        department: (code) => x.departments.find((d) => d.code === code)?.name ?? departmentName(code),
        mini: (n) => x.termMeta?.minis.find((m) => String(m.number) === n)?.name ?? `Mini ${n}`,
        requirement: x.reqName,
      },
    ),
  );
  const termName = $derived(x.termMeta?.name ?? "this semester");
  const countText = $derived.by(() => {
    const n = x.results.length;
    const base = `${n.toLocaleString("en-US")} ${n === 1 ? "result" : "results"}`;
    if (x.allMode) return `${base} across all semesters`;
    const others = x.unoffered?.length ?? 0;
    return others > 0 ? `${base}, plus ${others.toLocaleString("en-US")} not offered` : base;
  });

  function reset(): void {
    url.update(clearFilters(query));
  }

  function clearAll(): void {
    url.searchText = "";
    url.update({ ...clearFilters(query), q: "" });
  }

  const emptyText = $derived.by(() => {
    if (x.q === "") return "No course passes every filter. Remove one to see more.";
    if (x.filterCount === 0)
      return `Nothing matches "${x.q}". Try a course number like 15-122, a word from the title, or an instructor's last name.`;
    const filters = x.filterCount === 1 ? "this filter" : `these ${x.filterCount} filters`;
    return `Nothing matches "${x.q}" with ${filters}. Remove a filter or try a course number like 15-122.`;
  });
  const highlight = $derived(new Set(x.scheduleView?.entries.map((e) => e.course.id) ?? []));
  const unofferedNote = $derived(
    x.unoffered === null
      ? "Loading courses from other semesters and the catalog."
      : hasSectionFilters(x.filters)
        ? `Hidden while a day, time, delivery, session or schedule filter is on: those need ${termName}'s sections.`
        : x.unoffered.length === 0
          ? "None of them match either."
          : "Offered in other semesters, or listed in the catalog.",
  );
  const emptyIntro = $derived(
    x.results.length > 0
      ? undefined
      : x.q === ""
        ? `No ${termName} courses pass these filters.`
        : `No ${termName} courses match "${x.q}".`,
  );
</script>

<svelte:window onkeydown={onwindowkeydown} />

<Title value={x.allMode ? "All semesters" : x.termMeta?.name} />

<svelte:head>
  {#if query.course !== null}
    <link rel="canonical" href="{page.url.origin}{coursePath(query.course)}" />
  {/if}
</svelte:head>

{#snippet toolbar()}
  <ExplorerToolbar
    {url}
    count={x.loading ? undefined : countText}
    {chipList}
    onreset={x.filterCount > 0 ? reset : undefined}
    {termOptions}
    termValue={x.allMode ? ALL_SEMESTERS : (x.termId ?? "")}
    onterm={(term) => url.update({ ...query, term }, true)}
    {sortOptions}
    sortValue={x.sort}
    onsort={(sort) => url.update({ ...query, sort })}
    fceAvailable={x.fceMap !== null}
    {chart}
    onchart={(on) => url.update({ ...query, chart: on })}
    bind:view
    bind:searchRef
    allSemesters={x.allMode}
  />
{/snippet}

{#snippet others()}
  {#if !x.allMode && x.termId && query.unoffered}
    <OtherCourses
      heading="Not offered in {termName}"
      intro={emptyIntro}
      note={unofferedNote}
      busy={x.unoffered === null}
      matches={(x.unoffered ?? []).slice(0, otherLimit)}
      total={x.unoffered?.length ?? 0}
      termId={x.termId}
      termSpan={x.termSpan}
    >
      {#snippet more()}
        {#if x.unoffered && otherLimit < x.unoffered.length}
          <div class="mt-3 flex justify-center">
            <Button onclick={() => (otherLimit += 50)}>Show more</Button>
          </div>
        {/if}
      {/snippet}
    </OtherCourses>
  {:else if !x.allMode && x.termId && x.otherMatches.length > 0}
    <OtherCourses
      heading="Not offered in {termName}"
      intro={emptyIntro}
      note={x.otherMatches.length > 8 ? "Keep typing to narrow these down." : undefined}
      matches={x.otherMatches.slice(0, 8)}
      total={x.otherMatches.length}
      termId={x.termId}
      termSpan={x.termSpan}
    />
  {/if}
{/snippet}

<RailLayout
  storageKey="courses"
  filterCount={x.filterCount}
  backLabel="Search"
  sheetDone={x.loading
    ? "Show courses"
    : x.results.length === 0
      ? "No courses match"
      : `Show ${x.results.length.toLocaleString("en-US")} ${x.results.length === 1 ? "course" : "courses"}`}
  header={panelAlone ? undefined : toolbar}
  autoCollapse={squeezed}
  bind:railCollapsed
>
  {#snippet rail()}
    <ExplorerRail
      {query}
      onchange={(next) => url.update(next)}
      onreset={reset}
      departments={x.departments}
      minis={x.termMeta?.minis ?? []}
      termName={x.allMode ? null : (x.termMeta?.name ?? null)}
      fceAvailable={x.fceMap !== null}
      signedIn={session.status === "signed-in"}
      cards={view === "cards"}
    />
  {/snippet}

  <div class="flex items-start gap-6">
    <div id="course-results" class="min-w-0 flex-1 {panelAlone ? 'hidden' : ''}" aria-busy={x.loading}>
      {#if x.error}
        <EmptyState icon={SearchX} title="Couldn't load courses" description="{x.error} Check your connection and try again.">
          <Button variant="primary" onclick={() => location.reload()}>Try again</Button>
        </EmptyState>
      {:else if x.loading}
        {#if x.allMode}
          <p class="mb-4 flex items-center gap-2 text-body-2 text-muted" aria-live="polite">
            <Spinner size="sm" decorative /> Loading courses from every semester and the catalog
          </p>
        {/if}
        <div class="flex flex-col gap-6" aria-label="Loading courses">
          {#each [0, 1, 2] as index (index)}
            <div class="rounded-card border border-pressed bg-surface px-4 py-5 sm:px-9 sm:py-[30px]">
              <Skeleton variant="text" class="w-2/3" />
              <Skeleton variant="text" class="mt-2 w-1/3" />
              <Skeleton variant="text" lines={3} class="mt-5" />
            </div>
          {/each}
        </div>
      {:else if x.allMode && x.all === undefined}
        <EmptyState
          icon={SearchX}
          title="All semesters isn't available"
          description="This catalog has no list of offered courses. Pick a semester instead."
        />
      {:else if x.results.length === 0}
        {@render others()}
        {#if x.otherMatches.length === 0 && !(query.unoffered && (x.unoffered?.length ?? 0) > 0)}
          <EmptyState icon={SearchX} title="No matching courses" description={emptyText}>
            <div class="flex flex-wrap justify-center gap-2">
              {#if x.filterCount > 0}<Button variant="primary" onclick={reset}>Clear filters</Button>{/if}
              {#if x.q !== "" && x.filterCount > 0}<Button onclick={clearAll}>Clear search and filters</Button>{/if}
            </div>
          </EmptyState>
        {/if}
      {:else}
        <CourseResults
          results={x.results}
          resetKey="{x.resultsKey}|{view}"
          {view}
          {chart}
          fce={x.fceMap}
          {highlight}
          termId={x.allMode ? null : x.termId}
          contextTermId={x.termId}
          offeredOf={(id) => x.all?.termsOf.get(id) ?? []}
          {hrefFor}
          keepList={inPanel}
          {selectedId}
          {active}
          bind:limit
          footer={others}
        />
      {/if}
    </div>

    {#if query.course !== null && x.termId !== null}
      <!-- Beside the list, the panel sticks under the header and scrolls on its own. Until the page scrolls it up there
           (under the toolbar), it's only as tall as the room below its top, so its end is always on screen. -->
      <aside
        {@attach roomBelow}
        aria-label="Course details"
        class="min-w-0 rounded-card border border-pressed bg-surface {panelBeside
          ? 'scrollbar-thin sticky top-[calc(var(--header-h)+1rem)] max-h-[min(calc(100dvh-var(--header-h)-2rem),calc(var(--room-below,100dvh)-1rem))] w-[400px] shrink-0 overflow-y-auto overscroll-contain xl:w-[440px] min-[90rem]:w-[460px] min-[105rem]:w-[500px]'
          : 'w-full'}"
      >
        {#key selectedId}
          <CourseDetailPanel
            code={query.course}
            termId={x.allMode ? null : x.termId}
            contextTermId={x.termId}
            {closeHref}
            courseHref={(courseId, termId) =>
              url.href({ course: codeOf(parseCourseCode(courseId)), term: termId ?? ALL_SEMESTERS })}
          />
        {/key}
      </aside>
    {/if}
  </div>
</RailLayout>

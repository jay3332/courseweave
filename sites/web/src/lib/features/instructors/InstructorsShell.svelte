<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { Bookmark, ChevronLeft, GraduationCap, SearchX, UserX } from "@lucide/svelte";
  import FceAggregateSettings from "$lib/components/course/FceAggregateSettings.svelte";
  import FilterButton from "$lib/components/layout/FilterButton.svelte";
  import PageToolbar from "$lib/components/layout/PageToolbar.svelte";
  import RailGroup from "$lib/components/layout/RailGroup.svelte";
  import RailLayout from "$lib/components/layout/RailLayout.svelte";
  import RailSection from "$lib/components/layout/RailSection.svelte";
  import { roomBelow } from "$lib/components/layout/room-below";
  import SignInPrompt from "$lib/components/shell/SignInPrompt.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import MultiSelect from "$lib/components/ui/MultiSelect.svelte";
  import SearchInput from "$lib/components/ui/SearchInput.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import ViewToggle, { storedView } from "$lib/components/ui/ViewToggle.svelte";
  import { departmentName } from "$lib/core/departments";
  import { saved } from "$lib/state";
  import { ALL_SEMESTERS } from "$lib/state/term-scope";
  import { semesterOptions } from "$lib/state";
  import InstructorRows from "./InstructorRows.svelte";
  import { provideInstructorsScope } from "./scope.svelte";

  // The instructor pages' frame (routes/instructors/+layout.svelte): the filter rail, the search toolbar, and on wide
  // screens in the list view, Courseweave's rows beside the open instructor. The pages render inside it.
  let { children }: { children: Snippet } = $props();

  const scope = provideInstructorsScope(storedView("instructors") ?? "cards");
  const SORTS = [
    { value: "name", label: "Last name" },
    { value: "sections", label: "Most sections" },
  ];
  const open = $derived(scope.slug !== null);
  const split = $derived(scope.split);
  const SIDE_ROWS = 200;

  let searchField = $state<HTMLInputElement>();
  let side = $state<HTMLElement>();
  // The open instructor's row stays in view in the side list.
  $effect(() => {
    void [scope.slug, scope.ready];
    const row = side?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (side === undefined || row === null || row === undefined) return;
    // Scroll the column only, never the page.
    const top = row.offsetTop;
    if (top < side.scrollTop || top + row.offsetHeight > side.scrollTop + side.clientHeight)
      side.scrollTop = top - (side.clientHeight - row.offsetHeight) / 2;
  });
  // The search field moves through the rows with the arrow keys, as Courseweave's does; Enter opens one.
  let active = $state(-1);
  $effect(() => {
    void [scope.query, scope.depts, scope.sort, scope.savedOnly, scope.termParam];
    active = -1;
  });

  function onsearchkeydown(event: KeyboardEvent): void {
    const results = scope.results;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (scope.view !== "list" || results.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const from = active === -1 ? (delta > 0 ? -1 : 0) : active;
      active = Math.max(0, Math.min(results.length - 1, from + delta));
      document.querySelector(`#instructor-row-${active}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Escape" && scope.query !== "") {
      event.preventDefault();
      scope.query = "";
    } else if (event.key === "Enter") {
      const doc = results[active === -1 ? 0 : active];
      if (doc !== undefined) {
        event.preventDefault();
        void goto(scope.href(doc.inst.slug));
      }
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    )
      return;
    event.preventDefault();
    searchField?.focus();
    searchField?.select();
  }
</script>

<svelte:window {onkeydown} />

{#snippet semesterPicker(width: string, variant: "field" | "compact")}
  {#if scope.terms.value}
    <Select
      label="Semester"
      {variant}
      options={semesterOptions(scope.terms.value)}
      value={scope.allMode ? ALL_SEMESTERS : (scope.termId ?? "")}
      onchange={(event) => scope.setParams({ term: event.currentTarget.value })}
      class={width}
    />
  {/if}
{/snippet}

{#snippet sortPicker(width: string, variant: "field" | "compact")}
  <Select
    {variant}
    label="Sort by"
    options={SORTS}
    value={scope.sort}
    onchange={(event) => scope.setParams({ sort: event.currentTarget.value === "sections" ? "sections" : null })}
    class={width}
  />
{/snippet}

{#snippet toolbar()}
  <PageToolbar
    title="Instructors"
    hideTitle={open ? true : "desktop"}
    count={scope.signedIn && scope.ready ? scope.countText : undefined}
    onreset={scope.filterCount > 0 || scope.query !== "" ? () => scope.reset() : undefined}
  >
    {#snippet intro()}
      <!-- Phones: the semester and the sort get their own row; wider screens have them beside the view switch. -->
      <div class="mb-2 grid grid-cols-2 gap-2 lg:hidden">
        {@render semesterPicker("min-w-0", "field")}
        {@render sortPicker("min-w-0", "field")}
      </div>
    {/snippet}
    {#snippet search()}
      <SearchInput
        bind:value={scope.query}
        bind:ref={searchField}
        label="Search instructors"
        placeholder="Search instructors by name, course number or course title&hellip;"
        role="combobox"
        aria-expanded={scope.view === "list"}
        aria-controls={scope.view === "list" ? "instructor-results" : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `instructor-row-${active}` : undefined}
        onkeydown={onsearchkeydown}
      />
    {/snippet}
    {#snippet chips()}
      {#each scope.depts as code (code)}
        <Chip
          label={departmentName(code)}
          onremove={() => scope.setParams({ dept: scope.depts.filter((d) => d !== code).join(",") })}
        />
      {/each}
      {#if scope.savedOnly}
        <Chip label="Saved courses" onremove={() => scope.setParams({ saved: null })} />
      {/if}
      {#if scope.sort === "sections"}
        <Chip label="Most sections" onremove={() => scope.setParams({ sort: null })} />
      {/if}
    {/snippet}
    {#snippet actions()}
      <div class="hidden lg:block">{@render semesterPicker("w-44", "compact")}</div>
      <!-- Sort lives in the toolbar, as on the Courses page. -->
      <div class="hidden lg:block">{@render sortPicker("w-[10.5rem]", "compact")}</div>
      <ViewToggle pageKey="instructors" bind:value={scope.view} />
    {/snippet}
  </PageToolbar>
{/snippet}

<RailLayout
  storageKey="instructors"
  filterCount={scope.filterCount + (open ? scope.courses.length : 0)}
  backLabel={open ? "Instructor" : "Instructors"}
  sheetDone={!scope.signedIn || open
    ? undefined
    : !scope.ready
      ? "Show instructors"
      : `Show ${scope.results.length.toLocaleString("en-US")} ${scope.results.length === 1 ? "instructor" : "instructors"}`}
  header={scope.signedIn && (!open || split) ? toolbar : undefined}
>
  {#snippet rail()}
    {#if !scope.signedIn}
      <!-- Nothing to filter until there are instructors to show. -->
      <RailGroup>
        <p class="text-body-2 text-muted">
          {scope.sessionLoading ? "Checking your session\u2026" : "Sign in to search and filter instructors."}
        </p>
      </RailGroup>
    {:else}
    <RailGroup>
      <RailSection title="Department" icon={GraduationCap} badge={scope.depts.length}>
        <MultiSelect
          options={scope.deptOptions}
          value={scope.depts}
          label="Departments"
          placeholder="Any department"
          searchPlaceholder="Search departments"
          onchange={(value: string[]) => scope.setParams({ dept: value.join(",") })}
        />
      </RailSection>
      <RailSection title="Saved courses" icon={Bookmark} badge={scope.savedOnly ? 1 : 0}>
        <Switch
          label="Only instructors teaching my saved courses"
          checked={scope.savedOnly}
          disabled={saved.ids.length === 0 && !scope.savedOnly}
          labelPosition="end"
          onchange={(on) => scope.setParams({ saved: on ? "1" : null })}
        />
        {#if saved.ids.length === 0}
          <p class="text-label-md font-normal text-muted">Save courses on the Courses page to use this filter.</p>
        {/if}
      </RailSection>
      <Button variant="secondary" full onclick={() => scope.reset()}>Reset</Button>
    </RailGroup>
    <RailGroup title="Aggregate FCEs">
      <FceAggregateSettings />
      {#if open}
        <div class="flex flex-col gap-2">
          <MultiSelect
            options={scope.courseOptions}
            bind:value={scope.courses}
            label="Courses"
            hideLabel={false}
            placeholder={scope.fce.value ? "All courses" : "No courses evaluated"}
            searchPlaceholder="Search courses"
            disabled={scope.courseOptions.length === 0}
          />
          <p class="text-label-md font-normal text-muted">
            Count only some of {scope.selected?.name ?? "this instructor"}'s courses.
          </p>
        </div>
      {/if}
    </RailGroup>
    {/if}
  {/snippet}

  {#if open && !split}
    <div class="mb-4 flex items-center justify-between gap-3">
      <a
        href={scope.listHref}
        class="inline-flex min-h-10 items-center gap-1 rounded-full pr-2 text-label-lg text-muted hover:text-ink"
      >
        <ChevronLeft aria-hidden="true" class="size-5" />All instructors
      </a>
      {#if scope.signedIn}<FilterButton />{/if}
    </div>
  {/if}

  {#if scope.sessionLoading}
    <div class="flex justify-center py-16"><Spinner size="lg" label="Checking your session" /></div>
  {:else if !scope.signedIn}
    <SignInPrompt
      title={open ? "Sign in to see this instructor" : "Sign in to see instructors"}
      description="Who teaches each course and their course evaluations come from CMU systems, so they're only shown to signed-in CMU students."
    />
  {:else if scope.forbidden}
    <EmptyState
      icon={UserX}
      title="Instructors need a CMU account"
      description="You're signed in with an account that isn't a CMU one. Sign out, then sign in with your Andrew ID."
    />
  {:else if scope.failed}
    <EmptyState
      icon={SearchX}
      title="Instructors didn't load"
      description="The course catalog couldn't be reached. Check your connection, then reload the page."
    >
      <Button onclick={() => location.reload()}>Reload</Button>
    </EmptyState>
  {:else if scope.noTeaching}
    <EmptyState
      icon={SearchX}
      title="All semesters isn't available"
      description="This catalog has no list of who teaches what across semesters. Pick a semester instead."
    />
  {:else if split}
    <div class="flex items-start gap-6">
      <!-- Sticks under the header and scrolls on its own; until the page scrolls it up there (under the toolbar), it's
           only as tall as the room below its top, so its end is always on screen. -->
      <div
        bind:this={side}
        {@attach roomBelow}
        class="scrollbar-thin sticky top-[calc(var(--header-h)+1rem)] max-h-[min(calc(100dvh-var(--header-h)-2rem),calc(var(--room-below,100dvh)-1rem))] w-[320px] shrink-0 overflow-y-auto overscroll-contain rounded-card border border-pressed bg-surface"
      >
        <InstructorRows docs={scope.results.slice(0, SIDE_ROWS)} {active} stickyTop="top-0" />
        {#if scope.results.length > SIDE_ROWS}
          <p class="px-4 py-3 text-label-md font-normal text-muted">
            Showing the first {SIDE_ROWS}. Search or filter to find others.
          </p>
        {:else if scope.ready && scope.results.length === 0}
          <p class="px-4 py-6 text-center text-body-2 text-muted">No instructors match.</p>
        {/if}
      </div>
      <div class="min-w-0 flex-1">{@render children()}</div>
    </div>
  {:else}
    {@render children()}
  {/if}
</RailLayout>

<script lang="ts">
  // Choose majors, additional majors, minors and concentrations to audit, each at a requirements version (catalog
  // year). Degree programs are member data: signed out, this asks to sign in. Courseweave's ProgramPicker.
  // While the search is in use, a panel under it holds the program-type filter and the matches; a type with no
  // query lists every program of that type.
  import { Plus } from "@lucide/svelte";
  import { catalog, resource } from "$lib/data";
  import { bundlesForEntryYear } from "$lib/core/degree/year-bundles";
  import type { ProgramVersion } from "$lib/core/degree-types";
  import { defaultVersion } from "$lib/core/programs";
  import type { ProgramInfo, ProgramSelection } from "$lib/core/plan-types";
  import Chip from "$lib/components/ui/Chip.svelte";
  import SearchInput from "$lib/components/ui/SearchInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { panelSurface } from "$lib/components/ui/styles";
  import ToggleChips from "$lib/components/ui/ToggleChips.svelte";
  import { countKind, KIND_FILTERS, KIND_LABEL, programCampus, searchPrograms, type KindFilter } from "./programs";
  import SelectedProgram from "./SelectedProgram.svelte";
  import SignInNote from "../SignInNote.svelte";

  let {
    value,
    onchange,
    entryYearHint,
  }: {
    value: ProgramSelection[];
    onchange: (value: ProgramSelection[]) => void;
    /** Entry year (the fall the plan starts), to preselect matching requirement versions. */
    entryYearHint?: number;
  } = $props();

  const LIMIT = 30;
  const panelId = $props.id();
  let query = $state("");
  let filter = $state<KindFilter>("all");
  let open = $state(false);
  let root = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  let panel = $state<HTMLElement>();

  const index = resource(() => catalog.programsIndex());
  const idsKey = $derived(value.map((v) => v.auditId).join(","));
  const versions = resource(() =>
    idsKey === "" ? null : catalog.programs(idsKey.split(",").map(Number)),
  );

  const programs = $derived(index.value?.programs ?? []);
  const byCatalog = $derived(new Map(programs.map((p) => [p.catalogId, p])));

  /** A chosen version with the gen eds the audit checks alongside it: year-split ones at the plan's entry year. */
  function withBundles(version: ProgramVersion | undefined): ProgramVersion | undefined {
    return version && index.value ? bundlesForEntryYear(version, index.value, entryYearHint ?? null) : version;
  }
  const results = $derived(
    searchPrograms(programs, query, filter, new Set(value.map((v) => v.catalogId))),
  );
  const typed = $derived(query.trim() !== "");
  const status = $derived(
    !typed && filter === "all" ? "" : `${results.length} ${results.length === 1 ? "program" : "programs"}`,
  );
  const summary = $derived(
    `${countKind(programs, "major")} majors, ${countKind(programs, "minor")} minors and ${countKind(
      programs,
      "additional-major",
    )} additional majors, from CMU's degree audit.`,
  );

  function add(p: ProgramInfo): void {
    const v = defaultVersion(p, entryYearHint);
    if (v === null) return;
    onchange([...value, { catalogId: p.catalogId, auditId: v.auditId }]);
    query = "";
    // The chosen result leaves the list; keep focus in the search for the next one.
    input?.focus();
  }

  function onfocusout(event: FocusEvent): void {
    // Tabbing out closes the panel; a click outside closes it below (a click on nothing moves focus nowhere).
    if (event.relatedTarget instanceof Node && !root?.contains(event.relatedTarget)) open = false;
  }

  function onkeydown(event: KeyboardEvent): void {
    // The search clears itself on the first Escape (and marks the event); the next one closes the panel.
    if (event.key !== "Escape" || event.defaultPrevented || !open) return;
    event.preventDefault();
    open = false;
  }

  // The panel opens under the search, often near the rail's foot: bring it into view, and again when a type fills it.
  $effect(() => {
    void filter;
    panel?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root?.contains(event.target)) open = false;
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });
</script>

{#if index.status === "signin" || index.status === "forbidden"}
  <SignInNote title="Sign in to pick your programs" forbidden={index.status === "forbidden"} boxed={false} />
{:else if index.status === "error"}
  <p role="alert" class="text-body-2 text-danger">Couldn't load degree programs. {index.error} Reload to try again.</p>
{:else}
  <div class="flex flex-col gap-3">
    {#if value.length > 0}
      <ul class="flex flex-col divide-y divide-line">
        {#each value as selection, i (`${selection.catalogId}-${i}`)}
          <SelectedProgram
            {selection}
            info={byCatalog.get(selection.catalogId)}
            version={withBundles(versions.value?.get(selection.auditId))}
            onchange={(next) => onchange(value.map((v, j) => (j === i ? next : v)))}
            onremove={() => onchange(value.filter((_, j) => j !== i))}
          />
        {/each}
      </ul>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div bind:this={root} class="relative" onfocusin={() => (open = true)} {onfocusout} {onkeydown}>
      <SearchInput
        bind:value={query}
        bind:ref={input}
        variant="field"
        label="Search degree programs"
        placeholder={value.length > 0 ? "Add another program" : "Search majors and minors"}
        aria-controls={panelId}
        oninput={() => (open = true)}
        onclick={() => (open = true)}
      />
      {#if open}
        <!-- Pressing inside the panel keeps focus in the search (a tap on a phone doesn't focus a button), so the
             panel stays open; keyboard users Tab into the filter and the matches. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          bind:this={panel}
          id={panelId}
          role="region"
          aria-label="Degree programs"
          onmousedown={(event) => event.preventDefault()}
          class="{panelSurface} absolute inset-x-0 top-full z-40 mt-1.5 flex max-h-[min(60dvh,26rem)] flex-col overflow-hidden"
        >
          <div class="border-b border-line p-2">
            <ToggleChips
              label="Program type"
              multiple={false}
              options={KIND_FILTERS}
              bind:value={() => [filter], (next) => (filter = (next[0] as KindFilter | undefined) ?? "all")}
              class="max-md:[&>button]:h-10"
            />
          </div>
          <p role="status" class="sr-only">{status}</p>
          <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1">
            {#if index.status === "loading" && index.value === undefined}
              <p class="flex items-center gap-2 px-3.5 py-2.5 text-body-2 text-muted">
                <Spinner size="sm" decorative /> Loading programs
              </p>
            {:else if !typed && filter === "all"}
              <p class="px-3.5 py-2.5 text-body-2 text-muted">
                Type a program's name, or pick a type to see them all. {summary}
              </p>
            {:else if results.length > 0}
              <ul class="flex flex-col">
                {#each results.slice(0, LIMIT) as p (p.catalogId)}
                  {@const campus = programCampus(p)}
                  <li>
                    <button
                      type="button"
                      onclick={() => add(p)}
                      class="flex min-h-11 w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-hover focus-visible:-outline-offset-2 md:min-h-9"
                    >
                      <Plus aria-hidden="true" class="size-4 shrink-0 text-muted" />
                      <span class="min-w-0 flex-1 text-body-2 text-strong">{p.name}</span>
                      {#if campus}<Chip tone="neutral" size="sm" label={campus} />{/if}
                      <Chip tone="soft" size="sm" label={KIND_LABEL[p.kind]} />
                    </button>
                  </li>
                {/each}
              </ul>
              {#if results.length > LIMIT}
                <p class="px-3.5 py-2 text-label-md font-normal text-muted">
                  {results.length - LIMIT} more; {typed ? "keep typing" : "type a name"} to narrow it down
                </p>
              {/if}
            {:else if typed}
              <p class="px-3.5 py-2.5 text-body-2 text-muted">
                No {filter === "all" ? "programs" : "programs of this type"} match "{query.trim()}". Try fewer
                words{filter === "all" ? "" : ", or another type"}.
              </p>
            {:else}
              <p class="px-3.5 py-2.5 text-body-2 text-muted">Every one of these is already in your plan.</p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    {#if value.length === 0 && programs.length > 0 && !open}
      <p class="text-label-md font-normal text-muted">{summary}</p>
    {/if}
  </div>
{/if}

<!--
  The schedule's totals (the Figma's "Total Workload"; Courseweave's units footer). `footer`: pinned to the bottom of
  the rail, the units in large type, the factorable and pass/fail split, "Exceeds 54 units" when it does, and the
  course count and conflicts. `rail`: the same, longer, under a heading. `compact`: one line of units, hours and
  conflicts for the page while the rail is a sheet.
  Hours are member data; signed out they're left out (the rail asks the student to sign in).
-->
<script lang="ts">
  import { CircleCheck, Info, TriangleAlert } from "@lucide/svelte";
  import { catalog, resource } from "$lib/data";
  import type { Term } from "$lib/core/data";
  import { FACTORABLE_HELP, plural } from "$lib/core/planner/format";
  import { formatHours } from "$lib/core/fce";
  import { scheduleLoad } from "$lib/core/fce/workload";
  import { HEAVY_UNITS } from "$lib/core/plan";
  import type { ScheduleView } from "$lib/core/state/schedule-view";
  import { conflictCount } from "./planner";

  let {
    view,
    term,
    variant = "rail",
    class: className = "",
  }: { view: ScheduleView; term: Term; variant?: "footer" | "rail" | "compact"; class?: string } = $props();

  const id = $props.id();
  const fce = resource(() => catalog.fceSummary());
  const load = $derived(
    fce.value === undefined || fce.value === null
      ? null
      : scheduleLoad(view.entries, term.meta.minis, fce.value.courses),
  );
  const peak = $derived(load?.halves && load.peak !== null ? load.halves[load.peak] : null);
  const units = $derived(view.units);
  const unitText = $derived(
    units.hasVariable ? `${units.total} units plus variable` : plural(units.total, "unit"),
  );
  const heavy = $derived(units.factorable > HEAVY_UNITS);
  const conflicts = $derived(conflictCount(view));
  let help = $state(false);
</script>

{#snippet sep()}<span aria-hidden="true" class="text-faint">&middot;</span>{/snippet}

{#snippet conflictText()}
  {#if conflicts > 0}
    <span class="inline-flex items-center gap-1 font-semibold text-danger">
      <TriangleAlert aria-hidden="true" class="size-3.5" />{plural(conflicts, "conflict")}
    </span>
  {:else}
    <span class="inline-flex items-center gap-1 text-ok">
      <CircleCheck aria-hidden="true" class="size-3.5" />No conflicts
    </span>
  {/if}
{/snippet}

<!-- Over the guidance, the count turns the warning color with an icon and says so on hover. -->
{#snippet factorableCount()}
  {#if heavy}
    <span class="inline-flex items-center gap-1 text-warn" title="Exceeds {HEAVY_UNITS} factorable units">
      <TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />
      <!-- One flex item, so the row's gap is only the icon's and the number is a space from its word. -->
      <span
        ><strong class="font-semibold">{units.factorable}</strong> factorable<span class="sr-only"
          >, exceeds {HEAVY_UNITS} factorable units</span
        ></span
      >
    </span>
  {:else}
    <span><strong class="font-semibold text-ink">{units.factorable}</strong> factorable</span>
  {/if}
{/snippet}

{#snippet factorableLine()}
  <p class="flex flex-wrap items-center text-label-md font-normal text-muted">
    {@render factorableCount()}
    {#if units.nonFactorable > 0}
      <span>,&nbsp;<strong class="font-semibold text-ink">{units.nonFactorable}</strong> pass/fail</span>
    {/if}
    <button
      type="button"
      aria-expanded={help}
      aria-controls={help ? id : undefined}
      aria-label="What are factorable units?"
      title="What are factorable units?"
      onclick={() => (help = !help)}
      class="ml-0.5 inline-grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
    >
      <Info aria-hidden="true" class="size-3.5" />
    </button>
  </p>
  {#if help}
    <p {id} class="rounded-tag bg-surface-2 px-2.5 py-2 text-label-md font-normal text-ink">{FACTORABLE_HELP}</p>
  {/if}
{/snippet}

{#if view.entries.length > 0}
  {#if variant === "footer"}
    <div class="flex flex-col gap-1 {className}" aria-live="polite">
      <div class="flex items-end justify-between gap-3">
        <p class="flex items-baseline gap-1.5">
          <span class="tabular text-[32px] leading-9 font-semibold text-strong">{units.total}</span>
          <span class="text-body-2 text-muted">{units.hasVariable ? "units plus variable" : units.total === 1 ? "unit" : "units"}</span>
        </p>
        <p class="flex flex-col items-end text-label-md font-normal">
          <span class="text-muted">{plural(view.entries.filter((e) => !e.entry.hidden).length, "course")}</span>
          {@render conflictText()}
        </p>
      </div>
      {@render factorableLine()}
    </div>
  {:else if variant === "compact"}
    <p
      class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label-md font-normal text-muted {className}"
      aria-live="polite"
    >
      <span
        class="tabular inline-flex items-center gap-1 font-semibold {heavy ? 'text-warn' : 'text-ink'}"
        title={heavy ? `Exceeds ${HEAVY_UNITS} factorable units` : undefined}
      >
        {#if heavy}<TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />{/if}{unitText}{#if heavy}<span
            class="sr-only">, exceeds {HEAVY_UNITS} factorable units</span
          >{/if}
      </span>
      {#if load !== null}
        {@render sep()}
        <span class="tabular">{formatHours(peak ? peak.load.hours : load.total)} hrs/week</span>
      {/if}
      {@render sep()}
      {@render conflictText()}
    </p>
  {:else}
    <div class="flex flex-col gap-1 {className}">
      <p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body-2 text-muted" aria-live="polite">
        <span class="tabular font-semibold text-strong">{unitText}</span>
        {#if load !== null}
          {@render sep()}
          <span class="tabular" title="Expected hours a week from course evaluations (FCEs), including class time">
            {formatHours(peak ? peak.load.hours : load.total)} hrs/week{peak ? " at peak" : ""}
          </span>
        {:else if fce.status === "forbidden"}
          {@render sep()}<span>Hours need a CMU account</span>
        {:else if fce.status === "error"}
          {@render sep()}<span>Hours unavailable</span>
        {:else if fce.status === "loading"}
          {@render sep()}<span>&hellip; hrs/week</span>
        {/if}
        {@render sep()}
        {@render conflictText()}
      </p>
      <p class="flex flex-wrap items-center text-label-md font-normal text-muted">
        {@render factorableCount()}
        {#if units.nonFactorable > 0}
          <span>,&nbsp;<strong class="font-semibold text-ink">{units.nonFactorable}</strong> pass/fail</span>
        {/if}
        <button
          type="button"
          aria-expanded={help}
          aria-controls={help ? id : undefined}
          aria-label="What are factorable units?"
          title="What are factorable units?"
          onclick={() => (help = !help)}
          class="ml-0.5 inline-grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
        >
          <Info aria-hidden="true" class="size-3.5" />
        </button>
      </p>
      {#if help}
        <p {id} class="rounded-tag bg-surface-2 px-2.5 py-2 text-label-md font-normal text-ink">{FACTORABLE_HELP}</p>
      {/if}
    </div>
  {/if}
{/if}

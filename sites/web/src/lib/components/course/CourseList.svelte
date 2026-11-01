<script lang="ts">
  import { ChevronDown, ChevronUp } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { FCE_HOURS_HELP } from "$lib/core/fce";
  import type { ListColumn, SortedColumn } from "./columns";
  import { fceSummary } from "./data.svelte";

  let {
    label,
    allSemesters = false,
    sorted = null,
    onsort,
    children,
    class: className = "",
  }: {
    /** Accessible name for the list, such as "Courses in Spring 2027". */
    label: string;
    /** Rows show the semesters offering each course instead of its meetings. */
    allSemesters?: boolean;
    /** The column the rows are sorted by, marked in its header. */
    sorted?: SortedColumn | null;
    /** Makes the headers buttons: a click sorts by that column, or turns the sort around. Without it they're labels. */
    onsort?: (column: ListColumn) => void;
    /** CourseRow items. */
    children: Snippet;
    class?: string;
  } = $props();

  const fce = $derived(fceSummary());
  const showFce = $derived(fce.status === "ready" && fce.value !== null);

  /** What each header sorts by, and what that is called going up and going down. */
  const ORDERS: Record<ListColumn, { name: string; asc: string; desc: string }> = {
    number: { name: "course number", asc: "lowest first", desc: "highest first" },
    title: { name: "title", asc: "A to Z", desc: "Z to A" },
    meets: { name: "meeting time", asc: "earliest first", desc: "latest first" },
    hours: { name: "FCE hours", asc: "fewest first", desc: "most first" },
    rating: { name: "course rating", asc: "lowest first", desc: "best first" },
    units: { name: "units", asc: "fewest first", desc: "most first" },
  };

  function sortTitle(column: ListColumn): string {
    const order = ORDERS[column];
    const help = column === "hours" ? ` ${FCE_HOURS_HELP}` : "";
    if (sorted?.column !== column) return `Sort by ${order.name}.${help}`;
    const other = order[sorted.dir === "asc" ? "desc" : "asc"];
    return `Sorted by ${order.name}, ${order[sorted.dir]}. Click for ${other}.${help}`;
  }
</script>

<!-- A header that sorts the list. Its arrow hangs beside the name, so names stay where they line up with the rows:
     after it on the left, before it (in the gap between columns) on the right. -->
{#snippet header(column: ListColumn, name: string, end = false)}
  {@const dir = sorted?.column === column ? sorted.dir : null}
  <button
    type="button"
    onclick={() => onsort?.(column)}
    title={sortTitle(column)}
    class="w-full rounded-tag hover:text-ink {end ? 'text-right' : 'text-left'} {dir
      ? 'font-semibold text-ink'
      : ''}"
  >
    <span class="relative">
      {name}{#if dir}{@const Arrow = dir === "asc" ? ChevronUp : ChevronDown}<Arrow
          aria-hidden="true"
          class="absolute top-1/2 size-3.5 -translate-y-1/2 {end ? 'right-full mr-0.5' : 'left-full ml-0.5'}"
        />{/if}
    </span>
    {#if dir}<span class="sr-only">, sorted {ORDERS[column][dir]}</span>{/if}
  </button>
{/snippet}

<!-- The compact list (Courseweave's rows): a header and CourseRows, with columns that appear as it widens. -->
<div class="course-list overflow-hidden rounded-card border border-pressed bg-surface {className}">
  {#if onsort}
    <div
      role="group"
      aria-label="Sort {label}"
      class="course-list-head grid gap-x-3 border-b border-line bg-surface-2 px-3 py-2 text-label-md text-muted sm:px-4"
    >
      <span>{@render header("number", "Course")}</span>
      <span>{@render header("title", "Title")}</span>
      <span class="col-meets text-right"
        >{#if allSemesters}Offered{:else}{@render header("meets", "Meets", true)}{/if}</span
      >
      <span class="col-hours text-right">{#if showFce}{@render header("hours", "FCE hrs", true)}{/if}</span>
      <span class="col-rating text-right">{#if showFce}{@render header("rating", "Rating", true)}{/if}</span>
      <span class="text-right">{@render header("units", "Units", true)}</span>
      <span></span>
    </div>
  {:else}
    <div
      aria-hidden="true"
      class="course-list-head grid gap-x-3 border-b border-line bg-surface-2 px-3 py-2 text-label-md text-muted sm:px-4"
    >
      <span>Course</span>
      <span>Title</span>
      <span class="col-meets text-right">{allSemesters ? "Offered" : "Meets"}</span>
      <span class="col-hours text-right" title={showFce ? FCE_HOURS_HELP : undefined}>{showFce ? "FCE hrs" : ""}</span>
      <span class="col-rating text-right">{showFce ? "Rating" : ""}</span>
      <span class="text-right">Units</span>
      <span></span>
    </div>
  {/if}
  <div role="list" aria-label={label}>
    {@render children()}
  </div>
</div>

<style>
  .course-list {
    container: course-list / inline-size;
  }

  .course-list-head {
    grid-template-columns: 4.25rem minmax(0, 1fr) 2.75rem 2rem;
  }

  .col-meets,
  .col-hours,
  .col-rating {
    display: none;
  }

  @container course-list (min-width: 34rem) {
    .course-list-head {
      grid-template-columns: 4.25rem minmax(0, 1fr) 4.5rem 2.75rem 2rem;
    }

    .col-hours {
      display: block;
    }
  }

  @container course-list (min-width: 48rem) {
    .course-list-head {
      grid-template-columns: 4.25rem minmax(0, 1fr) 10rem 4.5rem 3rem 2.75rem 2rem;
    }

    .col-meets,
    .col-rating {
      display: block;
    }
  }
</style>

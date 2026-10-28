<script lang="ts">
  // Courses that would satisfy an unmet pool requirement, offered ones first and then the fewest FCE hours, each with
  // "Add" (and drag); the whole list opens on the Courses page.
  import { ArrowRight } from "@lucide/svelte";
  import { courseOptions } from "$lib/core/audit";
  import { fmt } from "$lib/core/degree/audit/format";
  import type { ReqNode } from "$lib/core/degree-types";
  import { FCE_HOURS_HELP, formatHours } from "$lib/core/fce";
  import { codeOf } from "$lib/core/requisite-format";
  import AddButton from "./AddButton.svelte";
  import { dragNew, type TreeContext } from "./tree";

  let { node, ctx }: { node: ReqNode; ctx: TreeContext } = $props();

  const SHOWN = 8;
  const LIMIT = 120;
  let all = $state(false);

  /** Fewer FCE hours first; courses without evaluations last. */
  function lighter(a: string, b: string): number {
    const ha = ctx.hours(a);
    const hb = ctx.hours(b);
    if (ha === hb) return a.localeCompare(b);
    if (ha === null) return 1;
    if (hb === null) return -1;
    return ha - hb;
  }

  // Every match, not the first by number, so the lightest courses come up wherever they are in the catalog.
  const options = $derived.by(() => {
    if (ctx.catalog === null) return [];
    return courseOptions(node, ctx.catalog, Infinity)
      .filter((id) => !ctx.inPlan.has(id))
      .toSorted((a, b) => Number(ctx.offered(b)) - Number(ctx.offered(a)) || lighter(a, b));
  });
  const shown = $derived(options.slice(0, all ? LIMIT : SHOWN));
  const more = $derived(Math.min(options.length, LIMIT) - SHOWN);
  const offeredCount = $derived(options.filter((id) => ctx.offered(id)).length);
</script>

{#if options.length > 0}
  <div class="mt-2">
    <p class="text-label-md text-muted">
      Ways to satisfy{offeredCount > 0
        ? `, ${offeredCount.toLocaleString("en-US")} offered in ${ctx.termName}`
        : ""}, fewest FCE hours first
    </p>
    <ul class="mt-1 flex flex-col">
      {#each shown as id (id)}
        {@const drag = dragNew(id, ctx)}
        {@const units = ctx.units(id)}
        {@const hours = ctx.hours(id)}
        <!-- One line, as in CourseLeafRow: Add waits over its end. -->
        <li
          class="group/leaf relative flex min-h-10 items-center gap-2 md:min-h-8 {drag.draggable ? 'cursor-grab' : ''}"
          {...drag}
        >
          <a
            href={ctx.href(id)}
            draggable={drag.draggable ? "false" : undefined}
            class="tabular shrink-0 text-label-lg hover:text-accent-ink hover:underline {ctx.offered(id)
              ? 'text-strong'
              : 'text-muted'}"
          >
            {codeOf(id)}
          </a>
          <span class="min-w-0 flex-1 truncate text-body-2 text-ink" title={ctx.title(id)}>{ctx.title(id) ?? ""}</span>
          {#if hours !== null}
            <span class="tabular shrink-0 text-label-md text-muted" title={FCE_HOURS_HELP}>{formatHours(hours)}h</span>
          {/if}
          {#if units !== null}<span class="tabular shrink-0 text-label-md text-muted">{fmt(units)}u</span>{/if}
          {#if ctx.onAddCourse}<AddButton courseId={id} nodeId={node.id} {ctx} />{/if}
        </li>
      {/each}
    </ul>
    <div class="mt-1 flex flex-wrap items-center gap-x-4">
      {#if more > 0}
        <button
          type="button"
          onclick={() => (all = !all)}
          class="min-h-10 text-label-md text-accent-ink hover:underline md:min-h-7"
        >
          {all ? "Show fewer" : `Show ${more} more`}
        </button>
      {/if}
      <a
        href={ctx.requirementHref(ctx.auditId, node.id)}
        title="Everything that counts toward {node.name} on the Courses page, fewest FCE hours first"
        class="inline-flex min-h-10 items-center gap-1 text-label-md text-accent-ink hover:underline md:min-h-7"
      >
        Browse in Courses
        <ArrowRight aria-hidden="true" class="size-3.5" />
      </a>
    </div>
  </div>
{/if}

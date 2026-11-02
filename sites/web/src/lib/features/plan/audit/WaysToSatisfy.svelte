<script lang="ts">
  // Courses that would satisfy an unmet pool requirement, those the semester shown offers first and then the most
  // recently offered, each with "Add" (and drag); the whole list opens on the Courses page to sort and filter there.
  import { ArrowRight } from "@lucide/svelte";
  import { fmt } from "$lib/core/degree/audit/format";
  import type { ReqNode } from "$lib/core/degree-types";
  import { FCE_HOURS_HELP, formatHours } from "$lib/core/fce";
  import { codeOf } from "$lib/core/requisite-format";
  import AddButton from "./AddButton.svelte";
  import { dragNew, type TreeContext } from "./tree";
  import { orderByOffering, satisfyingCourses } from "./ways-to-satisfy";

  let { node, ctx }: { node: ReqNode; ctx: TreeContext } = $props();

  const SHOWN = 8;
  const LIMIT = 120;
  let all = $state(false);

  // Every match, not the first by number, so recently offered courses come up wherever they are in the catalog. The
  // matches are kept per requirement, so a plan edit only drops what's planned and orders the rest again.
  const options = $derived.by(() => {
    if (ctx.catalog === null) return [];
    return orderByOffering(
      satisfyingCourses(node, ctx.catalog).filter((id) => !ctx.inPlan.has(id)),
      (id) => ctx.offered(id),
      (id) => ctx.lastOffered(id),
    );
  });
  const shown = $derived(options.slice(0, all ? LIMIT : SHOWN));
  const more = $derived(Math.min(options.length, LIMIT) - SHOWN);
  const offeredCount = $derived(options.filter((id) => ctx.offered(id)).length);
</script>

{#if options.length > 0}
  <div class="mt-2">
    <p class="text-label-md text-muted">
      Ways to satisfy{offeredCount > 0 ? `, ${offeredCount.toLocaleString("en-US")} offered in ${ctx.termName}` : ""}
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
        title="Everything that counts toward {node.name} on the Courses page"
        class="inline-flex min-h-10 items-center gap-1 text-label-md text-accent-ink hover:underline md:min-h-7"
      >
        Browse in Courses
        <ArrowRight aria-hidden="true" class="size-3.5" />
      </a>
    </div>
  </div>
{/if}

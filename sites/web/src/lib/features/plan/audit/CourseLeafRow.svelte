<script lang="ts">
  // A requirement for one specific course: done, planned, or an "Add" (and drag) when it's still needed. An option the
  // requirement doesn't need (under "other options not needed") has no Add but still drags onto a semester.
  import { Info } from "@lucide/svelte";
  import { displayState, fmt, STATE_LABEL } from "$lib/core/degree/audit/format";
  import type { RequirementResult } from "$lib/core/plan-types";
  import { codeOf } from "$lib/core/requisite-format";
  import AddButton from "./AddButton.svelte";
  import StateIcon from "./StateIcon.svelte";
  import { assignedStatus } from "./status-text";
  import { dragNew, type TreeContext } from "./tree";

  let { r, ctx }: { r: RequirementResult; ctx: TreeContext } = $props();

  const state = $derived(displayState(r));
  const id = $derived(r.courseId ?? "");
  const title = $derived(ctx.title(id));
  const a = $derived(r.assigned.at(0));
  const counted = $derived(a !== undefined && a.courseId !== id ? a.courseId : null);
  const done = $derived(state === "complete" || state === "complete-with-plan");
  const canDrag = $derived(a === undefined && !done && !ctx.inPlan.has(id));
  const drag = $derived(canDrag ? dragNew(id, ctx) : {});
  const units = $derived(ctx.units(id));
  const canAdd = $derived(!a && !done && state !== "skipped" && ctx.onAddCourse !== undefined && !ctx.inPlan.has(id));
  const notOffered = $derived(!a && !done && !ctx.offered(id));
  /** Where it counted, shortly: "F27" or "Credit"; the whole status is its tooltip. */
  const when = $derived(a === undefined ? null : a.status === "credit" ? "Credit" : (a.term ?? null));
</script>

<!-- One line at any width: the number, the title (truncated), and where it counted or its units. Add waits over the
     line's end (AddButton). -->
<li
  id="req-{r.nodeId}"
  class="group/leaf relative flex min-h-10 items-center gap-2 border-t border-line py-1 first:border-t-0 md:min-h-9 {drag.draggable
    ? 'cursor-grab'
    : ''}"
  title={notOffered ? `Not offered in ${ctx.termName}` : undefined}
  {...drag}
>
  <StateIcon {state} class="size-4" />
  <span class="sr-only">{STATE_LABEL[state]}</span>
  <!-- In a draggable row the link mustn't start its own drag: the row's drag adds the course. -->
  <a
    href={ctx.href(id, a?.term)}
    draggable={drag.draggable ? "false" : undefined}
    class="tabular shrink-0 text-label-lg hover:text-accent-ink hover:underline {notOffered ? 'text-muted' : 'text-strong'}"
  >
    {codeOf(id)}
  </a>
  <span class="min-w-0 flex-1 truncate text-body-2 {state === 'skipped' ? 'text-muted' : 'text-ink'}" {title}>
    {title ?? ""}{#if counted}<span class="text-muted"> (as {codeOf(counted)})</span>{/if}
  </span>
  <span class="tabular flex shrink-0 items-center gap-2 text-label-md text-muted">
    {#if a}
      <span title={assignedStatus(a)}>{when ?? assignedStatus(a)}<span class="sr-only">, {assignedStatus(a)}</span></span>
    {/if}
    {#if units !== null}<span>{fmt(units)}u</span>{/if}
    {#if notOffered}<span class="sr-only">Not offered in {ctx.termName}</span>{/if}
    {#if r.notes.length > 0}
      <span title={r.notes.join("\n")} class="grid size-5 shrink-0 place-items-center">
        <Info aria-hidden="true" class="size-3.5" />
        <span class="sr-only">{r.notes.join(". ")}</span>
      </span>
    {/if}
  </span>
  {#if canAdd}<AddButton courseId={id} nodeId={r.nodeId} {ctx} />{/if}
</li>

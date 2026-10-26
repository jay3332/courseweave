<!--
  One schedule in the profile's Preview view: its week in miniature (the courses' meetings in their colors, no text)
  over its name, class count, units and FCE hours a week. The whole card is a link that opens the schedule.
-->
<script lang="ts">
  import { Clock, Layers, Users } from "@lucide/svelte";
  import WeekThumbnail from "$lib/components/calendar/WeekThumbnail.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import type { Term } from "$lib/core/data";
  import { schedulesPath } from "$lib/core/routes";
  import type { ScheduleItem } from "$lib/state";
  import { classCount, previewBlocks } from "./schedule-previews";

  let {
    schedule,
    term,
    semester,
    loading = false,
    units = null,
    hours = null,
  }: {
    schedule: ScheduleItem;
    /** The semester's courses; until they load (or when the catalog no longer has it) the grid is empty. */
    term: Term | undefined;
    /** The semester's name, for the card's accessible name. */
    semester: string;
    /** The semester's courses are still loading: the grid pulses. */
    loading?: boolean;
    /** Units of the courses that aren't hidden, once the semester's courses load. */
    units?: number | null;
    /** FCE hours a week, as the Details view gives them (member data; null signed out). */
    hours?: string | null;
  } = $props();

  const blocks = $derived(term === undefined ? [] : previewBlocks(schedule, term));
  const count = $derived(classCount(schedule));
  const friends = $derived(schedule.visibility === "friends");
  const empty = $derived(schedule.entries.every((entry) => entry.hidden));
  const facts = $derived(
    [count.toLowerCase(), units !== null && !empty ? `${units} units` : null, hours !== null && !empty ? `${hours} hours a week` : null]
      .filter((fact) => fact !== null)
      .join(", "),
  );
</script>

<Card
  href={schedulesPath(schedule.termId, schedule.id)}
  padding="none"
  class="group flex h-full flex-col overflow-hidden"
  aria-label="{schedule.name}, {semester}, {facts}{friends ? ', friends can see it' : ''}"
>
  <WeekThumbnail {blocks} class="aspect-[4/3] border-b border-line {loading && term === undefined ? 'animate-pulse' : ''}" />
  <div class="flex items-center gap-3 px-5 py-4">
    <div class="min-w-0 flex-1">
      <p class="truncate text-heading-6 text-strong group-hover:underline">{schedule.name}</p>
      <!-- The units and hours wrap together, under the class count when the card is narrow. -->
      <p class="flex flex-wrap items-center gap-x-3 text-body-2 text-muted">
        <span>{count}</span>
        {#if !empty && (units !== null || hours !== null)}
          <span class="inline-flex flex-wrap items-center gap-x-3">
            {#if units !== null}
              <span class="inline-flex items-center gap-1"><Layers aria-hidden="true" class="size-4" />{units} units</span>
            {/if}
            {#if hours !== null}
              <span class="inline-flex items-center gap-1"><Clock aria-hidden="true" class="size-4" />{hours} hrs/week</span>
            {/if}
          </span>
        {/if}
      </p>
    </div>
    {#if friends}
      <span class="shrink-0 text-muted" title="Friends can see it"><Users aria-hidden="true" class="size-5" /></span>
    {/if}
  </div>
</Card>

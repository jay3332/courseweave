<script lang="ts">
  // The course against the semester's active schedule: a full-width "Add to Schedule 1", or once it's in, a status
  // chip with Remove and Open schedule right beside it. Both take one 40px row, so adding or removing doesn't move
  // what comes after. A schedule named otherwise reads "Add to schedule 'From Plan 2'" (in curly quotes) (schedule-label.ts).
  import { Check, Plus } from "@lucide/svelte";
  import { textAction } from "$lib/components/course/text-action";
  import Button from "$lib/components/ui/Button.svelte";
  import { schedulesPath } from "$lib/core/routes";
  import type { CourseSchedule } from "./course-schedule.svelte";
  import { scheduleInSentence, scheduleShort } from "./schedule-label";

  let { sched, class: className = "" }: { sched: CourseSchedule; class?: string } = $props();

  const entry = $derived(sched.entry);
  const name = $derived(scheduleInSentence(sched.scheduleName));
  // The chip is short, so the actions beside it stay on its row where they fit.
  const short = $derived(scheduleShort(sched.scheduleName));
</script>

<div class="flex min-w-0 flex-col gap-2 {className}">
  <div class="flex min-h-10 flex-wrap items-center gap-x-1 gap-y-1" aria-live="polite">
    {#if entry}
      <span
        class="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-ok-bg px-3 text-label-lg text-ok"
      >
        <Check aria-hidden="true" class="size-4 shrink-0" />
        <span class="truncate">
          In {short}{#if entry.entry.hidden}<span class="font-normal">, hidden</span>{/if}{#if entry.entry.passFail && sched.course?.passFail !== true}<span
              class="font-normal">, pass/fail</span
            >{/if}
        </span>
      </span>
      <!-- The actions wrap under the chip together when the row is too narrow for all three. -->
      <span class="flex items-center gap-0.5">
        <button type="button" class={textAction} aria-label="Remove from {name}" onclick={() => sched.remove()}>
          Remove
        </button>
        <a class={textAction} href={schedulesPath(sched.termId, sched.scheduleId)}>Open schedule</a>
      </span>
    {:else}
      <Button variant="primary" icon={Plus} full onclick={() => sched.addDefault()}>
        <span class="min-w-0 truncate">Add to {name}</span>
      </Button>
    {/if}
  </div>
  {#if entry?.needsChild}
    <p class="text-body-2 text-warn">Pick a recitation in the sections below to finish this course's schedule.</p>
  {/if}
</div>

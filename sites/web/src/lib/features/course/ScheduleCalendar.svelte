<!--
  The semester's active schedule as a small week calendar, with this course placed, or previewed (hatched) as the
  student points at, focuses or taps a section row (Courseweave's ScheduleCalendar). A line under it says what it
  shows and warns about conflicts.
-->
<script lang="ts">
  import WeekGrid from "$lib/components/calendar/WeekGrid.svelte";
  import { schedulesPath } from "$lib/core/routes";
  import type { CourseSchedule } from "./course-schedule.svelte";
  import { scheduleHeading } from "./schedule-label";

  let {
    sched,
    hourHeight = 28,
    headingId = "course-calendar",
    class: className = "",
  }: {
    sched: CourseSchedule;
    /** Pixels per hour. */
    hourHeight?: number;
    /** Unique per page: the full page can show two copies (beside and below the sections). */
    headingId?: string;
    class?: string;
  } = $props();

  const name = $derived(scheduleHeading(sched.scheduleName));
</script>

<section aria-labelledby={headingId} class="min-w-0 {className}">
  <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
    <h2 id={headingId} class="text-heading-4 text-strong">{name}</h2>
    <a
      href={schedulesPath(sched.termId, sched.scheduleId)}
      class="inline-flex min-h-10 items-center text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
    >
      Open schedule
    </a>
  </div>
  <div class="rounded-card border border-pressed bg-surface p-1.5 sm:p-2">
    <WeekGrid blocks={sched.blocks} compact view="week" {hourHeight} label="{name} with {sched.course?.code ?? 'this course'}" />
  </div>
  <p
    aria-live="polite"
    class="mt-1.5 min-h-5 text-body-2 {sched.captionIsConflict ? 'text-danger' : 'text-muted'}"
  >
    {sched.caption}
  </p>
</section>

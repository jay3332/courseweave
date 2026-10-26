<script lang="ts">
  import { Star } from "@lucide/svelte";
  import { getSession } from "$lib/components/shell/session";
  import { FCE_HOURS_HELP, courseIsMini, formatHours } from "$lib/core/fce";
  import { workloadDescription } from "$lib/core/fce/workload";
  import { meetingSummary } from "$lib/core/explorer/summary";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath } from "$lib/core/routes";
  import { formatUnits } from "$lib/core/time";
  import type { Course } from "$lib/core/types";
  import { fceSummary } from "./data.svelte";
  import SaveButton from "./SaveButton.svelte";
  import WorkloadMeter from "./WorkloadMeter.svelte";

  let {
    course,
    termId,
    offered,
    href: hrefProp,
    active = false,
    selected = false,
    class: className = "",
  }: {
    course: Course;
    /** The semester the row links to; null for the all-semesters view. */
    termId: string | null;
    /** All-semesters view: the semesters offering it, newest first, shown instead of its meetings. */
    offered?: readonly string[];
    /** Where the row links; defaults to the course page. */
    href?: string;
    /** Highlighted by keyboard navigation from the search field. */
    active?: boolean;
    /** The course open in the detail panel. */
    selected?: boolean;
    class?: string;
  } = $props();

  const session = getSession();
  const summary = $derived(offered === undefined ? meetingSummary(course) : null);
  const fce = $derived(fceSummary());
  const stats = $derived(fce.value?.courses.get(course.id));
  const showFce = $derived(fce.status === "ready" && fce.value !== null);
  const mini = $derived(courseIsMini(course, stats));
  const workload = $derived(stats ? workloadDescription(stats.hours, course.units, mini) : "");
  const offeredText = $derived(
    offered === undefined
      ? ""
      : offered.length > 0
        ? `Offered ${offered.map((term) => termLabel(term)).join(", ")}`
        : "Not offered in a recent semester",
  );
  const href = $derived(hrefProp ?? coursePath(course.code, termId ?? offered?.[0] ?? null));
</script>

<div
  role="listitem"
  class="course-row group relative grid items-start gap-x-3 border-b border-line px-3 py-2.5 transition-colors sm:px-4 {selected
    ? 'bg-selected'
    : active
      ? 'bg-hover'
      : 'hover:bg-hover'} {className}"
>
  <span class="tabular pt-px text-heading-6 font-semibold whitespace-nowrap text-strong">{course.code}</span>

  <span class="min-w-0">
    <a
      {href}
      data-course-preview="off"
      aria-current={selected ? "true" : undefined}
      class="title block text-body-1 font-medium text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:animate-focus-ring focus-visible:after:rounded-tag focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
      >{course.title}</a
    >
    <span class="flex min-w-0 gap-2 text-label-md text-muted">
      <span class="shrink-0 text-ink">{course.dept}</span>
      {#if course.level === "G"}<span class="shrink-0">Grad</span>{/if}
      <span class="truncate">
        {#if offered !== undefined}
          {offeredText}
        {:else if course.instructors.length > 0}
          {course.instructors.join(", ")}
        {:else if course.sections.length > 0 && session.status === "signed-in"}
          <!-- Instructors are member data: signed out, no listing has any. -->
          Instructor TBA
        {/if}
      </span>
    </span>
    {#if summary || (showFce && stats)}
      <span class="narrow-meta flex min-w-0 gap-3 text-label-md">
        {#if summary}
          <span class="min-w-0 truncate text-ink">
            {summary.primary}{#if summary.secondary}<span class="text-muted">, {summary.secondary}</span>{/if}
          </span>
        {/if}
        {#if showFce && stats}
          <span class="narrow-fce ml-auto flex shrink-0 gap-2 text-muted" title={workload}>
            {#if stats.hours !== null}<span><span class="tabular text-ink">{formatHours(stats.hours)}</span> h/wk</span>{/if}
            {#if stats.courseRate !== null}<span class="inline-flex items-center gap-0.5"
                ><span class="tabular text-ink">{stats.courseRate.toFixed(1)}</span><Star
                  aria-hidden="true"
                  class="size-3 fill-current"
                /><span class="sr-only">course rating</span></span
              >{/if}
          </span>
        {/if}
      </span>
    {/if}
  </span>

  <span class="col-meets min-w-0 text-right text-body-2">
    {#if summary}
      <span class="block truncate text-ink">{summary.primary}</span>
      <span class="block truncate text-label-md text-muted">{summary.secondary ?? ""}</span>
    {:else if offered !== undefined}
      <span class="block truncate text-ink">{offered.length > 0 ? termLabel(offered[0] ?? "") : "-"}</span>
    {/if}
  </span>

  <!-- Courseweave's WorkloadCell: the hours, and under them the bar against what the units suggest. -->
  <span class="col-hours pt-px text-right text-body-2">
    {#if showFce}
      {#if stats?.hours != null}
        <span class="block" title="{workload}. {FCE_HOURS_HELP}">
          <span class="block whitespace-nowrap" aria-hidden="true">
            {#if mini}<span class="mr-1 text-label-sm font-semibold text-muted">mini</span>{/if}<span
              class="tabular text-ink">{formatHours(stats.hours)}</span
            ><span class="ml-0.5 text-label-md text-muted">h</span>
          </span>
          <WorkloadMeter hours={stats.hours} units={course.units} {mini} class="mt-1.5" />
          <span class="sr-only">{workload}</span>
        </span>
      {:else}
        <span class="text-label-md text-muted">No FCE</span>
      {/if}
    {/if}
  </span>

  <span class="col-rating pt-px text-right text-body-2" title="Overall course rating from FCEs, 1 to 5">
    {#if showFce}
      {#if stats?.courseRate != null}
        <span class="tabular text-ink">{stats.courseRate.toFixed(1)}</span>
      {:else}
        <span class="text-label-md text-muted">-</span>
      {/if}
    {/if}
  </span>

  <span class="tabular pt-px text-right text-body-2 {course.units === null ? 'text-muted' : 'text-ink'}"
    >{formatUnits(course.units)}</span
  >

  <SaveButton courseId={course.id} size="sm" class="relative z-10 -my-1" />
</div>

<style>
  .course-row {
    grid-template-columns: 4.25rem minmax(0, 1fr) 2.75rem 2rem;
  }

  .col-meets,
  .col-hours,
  .col-rating {
    display: none;
  }

  /* Narrow lists give the title two lines; wider ones keep every row one line tall. */
  .title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  @container course-list (min-width: 34rem) {
    .course-row {
      grid-template-columns: 4.25rem minmax(0, 1fr) 4.5rem 2.75rem 2rem;
    }

    .col-hours {
      display: block;
    }

    .narrow-fce {
      display: none;
    }

    .title {
      display: block;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }

  @container course-list (min-width: 48rem) {
    .course-row {
      grid-template-columns: 4.25rem minmax(0, 1fr) 10rem 4.5rem 3rem 2.75rem 2rem;
    }

    .col-meets,
    .col-rating {
      display: block;
    }

    .narrow-meta {
      display: none;
    }
  }
</style>

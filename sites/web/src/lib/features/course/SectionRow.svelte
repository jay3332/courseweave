<script lang="ts">
  import { ArrowLeftRight, Check, Plus, TriangleAlert, X } from "@lucide/svelte";
  import type { Attachment } from "svelte/attachments";
  import InstructorFceBadge from "$lib/components/course/InstructorFceBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { instructorSlug } from "$lib/core/data";
  import { modeLabel } from "$lib/core/departments";
  import { miniName } from "$lib/core/explorer/summary";
  import { teachesSection } from "$lib/core/sections";
  import { joinList, partLabel } from "$lib/core/planner/format";
  import { instructorPath } from "$lib/core/routes";
  import { formatDays, formatLocation, formatTimeRange } from "$lib/core/time";
  import type { Course, Section, TermMeta } from "$lib/core/types";
  import type { CourseSchedule } from "./course-schedule.svelte";
  import SectionSeats from "./SectionSeats.svelte";

  let {
    course,
    section,
    sched,
    meta,
    redacted,
  }: {
    course: Course;
    section: Section;
    sched: CourseSchedule;
    meta: TermMeta;
    /** Signed out: instructors and rooms are left out of the public document. */
    redacted: boolean;
  } = $props();

  const entry = $derived(sched.entry);
  const isChild = $derived(section.parent !== null);
  const isChosen = $derived(
    isChild
      ? entry?.child?.name === section.name && entry.section?.name === section.parent
      : entry?.section?.name === section.name,
  );
  const conflicts = $derived(sched.conflictsFor(section));
  const label = $derived(partLabel(section));
  const kind = $derived(isChild ? "Recitation" : section.kind === "lecture" ? "Lecture" : "Section");
  const actionLabel = $derived(
    entry
      ? `Switch ${course.code} to ${isChild ? `recitation ${section.name}` : label}`
      : `Add ${course.code} ${label}`,
  );
  // Recitations usually repeat their lecture's instructors; list only the ones who teach this section.
  const instructors = $derived(section.instructors.filter((name) => teachesSection(course, section, name)));
  const location = (m: Section["meetings"][number]): string => (redacted ? "Hidden" : formatLocation(m));
  const previewing = $derived(sched.hovered === section);

  /**
   * Previews this row's result in the schedule's calendar: while a mouse points at it or focus is inside it, and on
   * a touch screen when the row itself (not its buttons or links) is tapped, until another row is tapped or this one
   * again.
   */
  const previewOnHover: Attachment<HTMLElement> = (node) => {
    let touch = false;
    const stop = (): void => {
      if (sched.hovered === section) sched.preview(null);
    };
    const enter = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") sched.preview(section);
    };
    const leave = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") stop();
    };
    const down = (event: PointerEvent): void => {
      touch = event.pointerType !== "mouse";
    };
    const tap = (event: MouseEvent): void => {
      if (!touch || (event.target instanceof Element && event.target.closest("a, button") !== null)) return;
      sched.preview(sched.hovered === section ? null : section);
    };
    const focusIn = (): void => sched.preview(section);
    const focusOut = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) stop();
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("pointerdown", down);
    node.addEventListener("click", tap);
    node.addEventListener("focusin", focusIn);
    node.addEventListener("focusout", focusOut);
    return () => {
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("click", tap);
      node.removeEventListener("focusin", focusIn);
      node.removeEventListener("focusout", focusOut);
      stop();
    };
  };

  // The chosen section's "Added" turns into Remove under a mouse or keyboard focus. A touch has no hover, so its
  // first tap shows Remove and a second one removes.
  let armed = $state(false);
  let touched = false;
  let disarm: ReturnType<typeof setTimeout> | undefined;
  function removeChosen(event: MouseEvent): void {
    if (touched && event.detail > 0 && !armed) {
      armed = true;
      clearTimeout(disarm);
      disarm = setTimeout(() => (armed = false), 4000);
      return;
    }
    clearTimeout(disarm);
    armed = false;
    sched.remove();
  }
  $effect(() => () => clearTimeout(disarm));

  /** Every state of the action column shares one pill size, so their labels line up row to row. */
  const PILL = "h-8 min-w-24 rounded-full border px-3 text-label-md max-sm:h-10 [&_svg]:size-4";
</script>

<div
  {@attach previewOnHover}
  class="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] gap-x-2 px-2 py-2.5 transition-colors hover:bg-hover @md:grid-cols-[3.75rem_minmax(0,1fr)_6rem] @3xl:grid-cols-[4.5rem_20rem_minmax(0,1fr)_5rem_6rem] @3xl:gap-x-3 {isChosen
    ? 'bg-ok-bg/60'
    : previewing
      ? 'bg-hover'
      : ''}"
>
  <div class={isChild ? "@3xl:border-l @3xl:border-line @3xl:pl-2" : ""}>
    <span class="tabular block leading-tight text-strong {isChild ? 'text-body-1' : 'text-heading-6'}">{section.name}</span>
    <span class="block text-label-md text-muted">{kind}</span>
  </div>

  <!-- In the wide layout this wrapper dissolves, so meetings and details become their own columns. -->
  <div class="min-w-0 text-body-2 @3xl:contents">
    <ul class="space-y-0.5">
      {#each section.meetings as m, index (index)}
        <li class="flex flex-wrap gap-x-2 @lg:grid @lg:grid-cols-[3rem_8.5rem_minmax(0,1fr)]">
          <span class="font-medium text-strong">{formatDays(m.days)}</span>
          <span class="whitespace-nowrap text-ink">{formatTimeRange(m.start, m.end)}</span>
          <span
            title={location(m)}
            class="truncate whitespace-nowrap {redacted ? 'text-muted' : 'text-ink'}">{location(m)}</span
          >
        </li>
      {/each}
    </ul>
    <div class="min-w-0">
      {#if section.title}<div class="mt-0.5 font-medium text-strong @3xl:mt-0">{section.title}</div>{/if}
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-label-md text-muted @3xl:mt-0">
        {#if instructors.length > 0}
          <span class="flex flex-wrap gap-x-2 text-body-2">
            {#each instructors as name (name)}
              <a
                href={instructorPath(instructorSlug(name), meta.id)}
                class="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent-ink">{name}</a
              >
            {/each}
          </span>
          {#if !isChild}
            {#each instructors as name (name)}
              <InstructorFceBadge courseId={course.id} instructor={name} />
            {/each}
          {/if}
        {:else if !isChild}
          <span class="text-body-2 text-ink">{redacted ? "Instructor hidden" : "Instructor TBA"}</span>
        {/if}
        {#if section.mode}<span title="Delivery mode {section.mode}">{modeLabel(section.mode)}</span>{/if}
        {#if section.mini !== null}<span class="font-medium text-ink">{miniName(section.mini, meta)}</span>{/if}
        {#if section.capacity !== undefined || (section.reservations?.length ?? 0) > 0}
          <span class="@3xl:hidden"><SectionSeats {section} suffix=" seats" /></span>
        {/if}
      </div>
      {#if conflicts.length > 0}
        <div class="mt-1 flex items-center gap-1 text-label-md text-danger">
          <TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />
          Conflicts with {joinList(conflicts)}
        </div>
      {/if}
    </div>
  </div>

  <div class="hidden text-right text-body-2 text-ink @3xl:block">
    <SectionSeats {section} />
  </div>

  <div class="flex flex-col items-end">
    {#if isChosen && isChild}
      <span class="inline-flex items-center justify-center gap-1.5 border-transparent text-ok {PILL}">
        <Check aria-hidden="true" /> Added
      </span>
    {:else if isChosen}
      <button
        type="button"
        aria-label="Added. Remove {course.code}"
        onpointerdown={(event) => (touched = event.pointerType !== "mouse")}
        onblur={() => (armed = false)}
        onclick={removeChosen}
        class="group/added grid place-items-center border-transparent transition-colors duration-150 select-none pointer-fine:hover:border-danger/35 pointer-fine:hover:bg-danger-bg focus-visible:border-danger/35 focus-visible:bg-danger-bg {armed
          ? 'border-danger/35 bg-danger-bg'
          : ''} {PILL}"
      >
        <span
          class="col-start-1 row-start-1 inline-flex items-center gap-1.5 text-ok group-focus-visible/added:invisible pointer-fine:group-hover/added:invisible {armed
            ? 'invisible'
            : ''}"
        >
          <Check aria-hidden="true" /> Added
        </span>
        <span
          class="col-start-1 row-start-1 inline-flex items-center gap-1.5 text-danger group-focus-visible/added:visible pointer-fine:group-hover/added:visible {armed
            ? ''
            : 'invisible'}"
        >
          <X aria-hidden="true" /> Remove
        </span>
      </button>
    {:else}
      <Button
        size="sm"
        variant="secondary"
        icon={entry ? ArrowLeftRight : Plus}
        aria-label={actionLabel}
        title={actionLabel}
        class="min-w-24 max-sm:h-10"
        onclick={() => sched.choose(section)}
      >
        {entry ? "Switch" : "Add"}
      </Button>
    {/if}
  </div>
</div>

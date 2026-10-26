<!--
  One course in the schedule (Courseweave's CourseEntryRow): its color, units, lecture and recitation pickers (dropdowns,
  or the compact letters when the student prefers them), conflicts, pass/fail, and buttons to hide it from the
  calendar, move it in the list or remove it. Clicking the row selects the course on the calendar, which outlines its
  other sections.
-->
<script lang="ts">
  import { ArrowDown, ArrowUp, Ellipsis, Eye, EyeOff, TriangleAlert, X } from "@lucide/svelte";
  import { coursePreview } from "$lib/components/course/preview";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Menu, { type MenuEntry } from "$lib/components/ui/Menu.svelte";
  import {
    PASS_FAIL_ONLY_HELP,
    conflictingCodes,
    joinList,
    partLabel,
    timesAndRoom,
    unitsText,
  } from "$lib/core/planner/format";
  import { instructorPreview } from "$lib/components/instructor/preview";
  import { coursePath } from "$lib/core/routes";
  import { allSelections, childSections, teachesSection, topSections } from "$lib/core/sections";
  import type { ResolvedEntry, ScheduleView } from "$lib/core/state/schedule-view";
  import type { Section } from "$lib/core/types";
  import { session } from "$lib/data";
  import { preferences } from "$lib/state";
  import ColorPicker from "./ColorPicker.svelte";
  import { conflictCodes } from "./planner";
  import SectionButtons from "./SectionButtons.svelte";
  import SectionPicker from "./SectionPicker.svelte";

  let {
    resolved,
    view,
    termId,
    first,
    last,
    selected = false,
    onselect,
    onsection,
    onchild,
    onpick,
    oncolor,
    onpassfail,
    ontogglehidden,
    onremove,
    onmove,
    onpreview,
  }: {
    resolved: ResolvedEntry;
    view: ScheduleView;
    termId: string;
    first: boolean;
    last: boolean;
    /** Selected on the calendar. */
    selected?: boolean;
    onselect: () => void;
    onsection: (name: string) => void;
    onchild: (name: string) => void;
    /** A lecture or section and its recitation at once (the compact letters). */
    onpick: (section: string, child: string | null) => void;
    oncolor: (color: number) => void;
    onpassfail: (passFail: boolean) => void;
    ontogglehidden: () => void;
    onremove: () => void;
    /** -1: up a place; 1: down a place. */
    onmove: (direction: -1 | 1) => void;
    /** Sections to preview on the calendar, or null. */
    onpreview: (sections: string[] | null) => void;
  } = $props();

  const entry = $derived(resolved.entry);
  const course = $derived(resolved.course);
  const hidden = $derived(entry.hidden);
  const tops = $derived(topSections(course));
  const children = $derived(resolved.section === null ? [] : childSections(course, resolved.section.name));
  const topNoun = $derived(tops.every((s) => s.kind === "lecture") ? "lecture" : "section");
  const conflicts = $derived(conflictCodes(resolved, view));
  const passFailOnly = $derived(course.passFail === true);
  // The compact letters, when the student prefers them and there's more than one way to take the course.
  const compact = $derived(preferences.sectionPicker === "compact" && allSelections(course).length > 1);

  /** Instructors worth naming: a recitation's only when they aren't its lecture's. */
  function teachers(s: Section): string[] {
    return s.instructors.filter((name) => teachesSection(course, s, name));
  }

  const more = $derived<MenuEntry[]>([
    { label: "Move up", icon: ArrowUp, disabled: first, onselect: () => onmove(-1) },
    { label: "Move down", icon: ArrowDown, disabled: last, onselect: () => onmove(1) },
  ]);

  function conflictsFor(s: Section): string[] {
    return conflictingCodes(s, course.id, view);
  }

  function preview(name: string | null): void {
    onpreview(name === null ? null : [name]);
  }

  function onclick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('button, a, input, label, [role="listbox"]')) onselect();
  }
</script>

{#snippet fixed(s: Section)}
  {@const where = timesAndRoom(s, !session.signedIn)}
  {@const names = teachers(s)}
  <div class="min-w-0">
    <p class="flex min-w-0 gap-2 text-body-2 text-ink">
      <span class="shrink-0 font-semibold text-strong">{partLabel(s)}</span>
      <span class="min-w-0 truncate">{where.times}</span>
      {#if where.room}<span class="shrink-0 text-muted">{where.room}</span>{/if}
    </p>
    {#if names.length > 0}
      <p class="truncate text-label-md font-normal text-muted">
        {#each names as name, n (name)}{n > 0 ? ", " : ""}<span {...instructorPreview(name, termId)}>{name}</span>{/each}
      </p>
    {/if}
  </div>
{/snippet}

<!-- Clicking the row is a shortcut for clicking the course on the calendar; the calendar's blocks are the keyboard way. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<li
  {onclick}
  class="relative rounded-field border px-2.5 py-2 transition-colors {selected
    ? 'border-line-strong bg-surface-2'
    : 'border-transparent hover:border-line'}"
>
  <div class="flex items-start gap-1">
    <ColorPicker color={entry.color} code={course.code} onchange={oncolor} />
    <div class="min-w-0 flex-1 pt-1 {hidden ? 'opacity-50' : ''}">
      <p class="flex min-w-0 items-baseline gap-x-2 whitespace-nowrap">
        <span {...coursePreview(course.id, termId)} class="tabular shrink-0 text-heading-6 font-semibold text-strong"
          >{course.code}</span
        >
        <span class="min-w-0 truncate text-label-md font-normal text-muted">{unitsText(course.units)}</span>
        {#if !resolved.factorable}
          <!-- The degree plan's compact pass/fail tag, so the line fits beside the row's buttons. -->
          <span
            class="shrink-0 self-center rounded-tag border border-pressed px-1 text-label-sm font-semibold text-muted"
            title={passFailOnly ? PASS_FAIL_ONLY_HELP : "You're taking this pass/fail, so its units don't count toward your QPA."}
            >P/F<span class="sr-only">, not factorable</span></span
          >
        {/if}
        {#if hidden}<span class="shrink-0 text-label-md font-normal text-muted">Hidden</span>{/if}
      </p>
      <a
        href={coursePath(course.code, termId)}
        class="block truncate text-body-2 text-ink hover:text-strong hover:underline"
        title={course.title}>{course.title}</a
      >
    </div>
    <div class="flex shrink-0 items-center">
      <IconButton
        label={hidden ? `Show ${course.code} on the calendar` : `Hide ${course.code} from the calendar`}
        icon={hidden ? EyeOff : Eye}
        class="size-10 lg:size-8"
        onclick={ontogglehidden}
      />
      <IconButton label="Remove {course.code}" icon={X} class="size-10 lg:size-8" onclick={onremove} />
      <Menu items={more} label="More for {course.code}">
        {#snippet trigger(props)}
          <IconButton {...props} label="More for {course.code}" icon={Ellipsis} class="size-10 lg:size-8" />
        {/snippet}
      </Menu>
    </div>
  </div>

  <div class="mt-1.5 flex flex-col gap-1.5 pl-[42px] lg:pl-[34px] {hidden ? 'opacity-50' : ''}">
    {#if compact}
      <SectionButtons
        {course}
        section={resolved.section}
        child={resolved.child}
        color={entry.color}
        {termId}
        roomsHidden={!session.signedIn}
        {conflictsFor}
        {onpick}
        {onpreview}
      />
    {:else if tops.length > 1}
      <SectionPicker
        noun={topNoun}
        listLabel="{topNoun === 'lecture' ? 'Lectures' : 'Sections'} of {course.code}"
        options={tops}
        current={resolved.section}
        fceCourseId={course.id}
        {termId}
        {conflictsFor}
        {teachers}
        onchange={(name) => {
          if (name !== resolved.section?.name) onsection(name);
        }}
        onpreview={preview}
      />
    {:else if resolved.section}
      {@render fixed(resolved.section)}
    {/if}

    <!-- The compact letters cover the recitation too. -->
    {#if !compact && resolved.section && children.length > 1}
      <SectionPicker
        noun="recitation"
        listLabel="Recitations of {course.code} {partLabel(resolved.section)}"
        options={children}
        current={resolved.child}
        {conflictsFor}
        {teachers}
        placeholder="Choose a recitation for {partLabel(resolved.section)}"
        {termId}
        onchange={onchild}
        onpreview={preview}
      />
    {:else if !compact && resolved.child}
      {@render fixed(resolved.child)}
    {/if}

    {#if resolved.needsChild && children.length > 1}
      <p class="text-label-md text-warn">Pick a recitation to finish this course's schedule.</p>
    {/if}

    {#if !hidden && conflicts.length > 0}
      <p class="flex items-center gap-1.5 text-label-md font-semibold text-danger">
        <TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />Conflicts with {joinList(conflicts)}
      </p>
    {/if}

    {#if passFailOnly}
      <p class="text-label-md font-normal text-muted" title={PASS_FAIL_ONLY_HELP}>Pass/fail only</p>
    {:else}
      <Checkbox
        checked={entry.passFail}
        label="Take pass/fail"
        title="Pass/fail units don't count toward your QPA."
        onchange={(event) => onpassfail((event.currentTarget as HTMLInputElement).checked)}
        class="-my-1 -ml-2 self-start text-label-md font-normal text-ink"
      />
    {/if}
  </div>
</li>

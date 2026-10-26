<!--
  A listbox of sections (Courseweave's SectionPicker). The button shows the chosen section's times, room and
  instructors; each option shows its times, room, instructors with their FCEs, and the scheduled courses it would
  conflict with. Hovering or arrowing to an option previews it on the calendar.
-->
<script lang="ts">
  import { Check, ChevronDown, TriangleAlert } from "@lucide/svelte";
  import { tick } from "svelte";
  import { panelSurface } from "$lib/components/ui/styles";
  import {
    joinList,
    locationSummary,
    meetingSummary,
    partLabel,
    timesAndRoom,
  } from "$lib/core/planner/format";
  import type { Section } from "$lib/core/types";
  import { instructorPreview } from "$lib/components/instructor/preview";
  import { session } from "$lib/data";
  import InstructorLine from "./InstructorLine.svelte";

  let {
    noun,
    listLabel,
    options,
    current,
    conflictsFor,
    onchange,
    onpreview,
    placeholder,
    fceCourseId,
    termId,
    teachers,
  }: {
    /** "lecture", "recitation" or "section", for labels. */
    noun: string;
    /** Accessible name of the list, such as "Lectures of 15-122". */
    listLabel: string;
    options: readonly Section[];
    current: Section | null;
    /** Codes of scheduled courses a section would conflict with. */
    conflictsFor: (section: Section) => string[];
    onchange: (name: string) => void;
    /** The section being considered, or null when nothing is. */
    onpreview: (name: string | null) => void;
    /** Shown in place of a current choice, as a prompt to pick one. */
    placeholder?: string;
    /** Show each option's instructors' FCEs for this course. */
    fceCourseId?: string;
    /** The semester the sections are in, for instructor previews. */
    termId?: string | null;
    /** The instructors to name on the button for the chosen section (a recitation's only when not its lecture's). */
    teachers?: (section: Section) => string[];
  } = $props();

  const id = $props.id();
  let open = $state(false);
  let active = $state(0);
  let root = $state<HTMLElement>();
  let list = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();

  const nounTitle = $derived(`${noun.charAt(0).toUpperCase()}${noun.slice(1)}`);
  // Signed out, term documents leave rooms out: say so rather than "Room TBA".
  const roomsHidden = $derived(!session.signedIn);
  const where = $derived(current === null ? null : timesAndRoom(current, roomsHidden));
  const names = $derived(current === null || teachers === undefined ? [] : teachers(current));

  function close(): void {
    open = false;
    onpreview(null);
  }

  async function openList(): Promise<void> {
    const i = Math.max(
      0,
      options.findIndex((s) => s.name === current?.name),
    );
    active = i;
    open = true;
    onpreview(options[i]?.name ?? null);
    await tick();
    list?.focus();
    list?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function move(i: number): void {
    const n = options.length;
    active = (i + n) % n;
    onpreview(options[active]?.name ?? null);
    list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function choose(name: string): void {
    onchange(name);
    close();
    button?.focus();
  }

  function onListKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(options.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      const s = options[active];
      if (s !== undefined) choose(s.name);
    } else if (event.key === "Escape" || event.key === "Tab") {
      close();
      if (event.key === "Escape") button?.focus();
      if (event.key === "Tab") return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  $effect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      if (root !== undefined && !root.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  });
</script>

<div bind:this={root} class="relative min-w-0">
  <button
    bind:this={button}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    aria-label={current
      ? `${nounTitle}: ${partLabel(current)}, ${meetingSummary(current)}. Change ${noun}`
      : (placeholder ?? `Choose a ${noun}`)}
    onclick={() => (open ? close() : void openList())}
    onkeydown={(event) => {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
        event.preventDefault();
        void openList();
      }
    }}
    class="flex min-h-10 w-full items-center gap-2 rounded-tag border bg-surface px-2.5 py-1 text-left text-body-2 transition-colors hover:border-ink lg:min-h-8 {current
      ? 'border-line-strong text-ink'
      : 'border-warn text-warn'}"
  >
    {#if current && where}
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 gap-2">
          <span class="shrink-0 font-semibold text-strong">{partLabel(current)}</span>
          <span class="min-w-0 truncate">{where.times}</span>
          {#if where.room}<span class="shrink-0 text-muted">{where.room}</span>{/if}
        </span>
        {#if names.length > 0}
          <span class="truncate text-label-md font-normal text-muted">{names.join(", ")}</span>
        {/if}
      </span>
    {:else}
      <span class="font-semibold">{placeholder ?? `Choose a ${noun}`}</span>
    {/if}
    <ChevronDown aria-hidden="true" class="ml-auto size-4 shrink-0 text-muted" />
  </button>

  {#if open}
    <ul
      bind:this={list}
      id="{id}-list"
      role="listbox"
      tabindex="-1"
      aria-label={listLabel}
      aria-activedescendant="{id}-opt-{active}"
      onkeydown={onListKey}
      onmouseleave={() => onpreview(null)}
      class="{panelSurface} scrollbar-thin absolute top-full right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto overscroll-contain p-1 outline-none"
    >
      {#each options as s, i (s.name)}
        {@const conflicts = conflictsFor(s)}
        {@const selected = s.name === current?.name}
        <li
          id="{id}-opt-{i}"
          data-index={i}
          role="option"
          aria-selected={selected}
          onmouseenter={() => {
            active = i;
            onpreview(s.name);
          }}
          onclick={() => choose(s.name)}
          onkeydown={() => {}}
          class="cursor-pointer rounded-[6px] px-2.5 py-1.5 text-body-2 {i === active ? 'bg-paper ring-1 ring-line-strong' : ''}"
        >
          <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span class="font-semibold text-strong">{partLabel(s)}</span>
            {#if s.mini}<span class="rounded-tag bg-line px-1 text-label-sm font-semibold text-ink">Mini {s.mini}</span>{/if}
            {#if selected}<Check aria-label="Current choice" class="size-3.5 text-ok" />{/if}
            {#if conflicts.length > 0}
              <span class="ml-auto flex items-center gap-1 text-label-md text-danger">
                <TriangleAlert aria-hidden="true" class="size-3" />Conflicts with {joinList(conflicts)}
              </span>
            {/if}
          </span>
          <span class="block text-ink">{meetingSummary(s)}</span>
          <span class="flex flex-wrap gap-x-3 text-label-md font-normal text-muted">
            <span class="shrink-0">{locationSummary(s, roomsHidden)}</span>
          </span>
          {#if s.instructors.length > 0}
            {#if fceCourseId}
              <span class="block text-muted"><InstructorLine courseId={fceCourseId} instructors={s.instructors} {termId} /></span>
            {:else}
              <span class="block text-label-md font-normal text-muted"
                >{#each s.instructors as name, n (name)}{n > 0 ? ", " : ""}<span {...instructorPreview(name, termId)}
                    >{name}</span
                  >{/each}</span
              >
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

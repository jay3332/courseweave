<!--
  The compact way to pick a course's sections (the schedule page's Compact choice; the old CMU Courses' section
  letters). Each option is a letter: recitations when the course has them, each lecture's after the last's and split
  by a rule (a recitation stands for its lecture too), otherwise its lectures or sections. The letters are one line,
  stretched to fill it when they fit and scrolled sideways when they don't. Hovering or focusing a letter previews it
  on the calendar and in the lines under the letters (times, room, instructors, conflicts); choosing it places it. The
  lines sit under the letters so a preview that changes their height never moves a letter out from under the pointer.
-->
<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import { instructorPreview } from "$lib/components/instructor/preview";
  import { courseColorStyle } from "$lib/core/colors";
  import { joinList, partLabel, timesAndRoom } from "$lib/core/planner/format";
  import { childSections, teachesSection, topSections } from "$lib/core/sections";
  import type { Course, Section } from "$lib/core/types";

  let {
    course,
    section,
    child,
    color,
    termId,
    roomsHidden,
    conflictsFor,
    onpick,
    onpreview,
  }: {
    course: Course;
    /** The chosen lecture or section. */
    section: Section | null;
    /** The chosen recitation. */
    child: Section | null;
    /** The course's calendar color, for the chosen letter. */
    color: number;
    termId: string;
    /** Signed out, term documents leave rooms out. */
    roomsHidden: boolean;
    /** Codes of scheduled courses a section would conflict with. */
    conflictsFor: (section: Section) => string[];
    onpick: (section: string, child: string | null) => void;
    /** Section names to preview on the calendar, or null when nothing is. */
    onpreview: (names: string[] | null) => void;
  } = $props();

  interface Choice {
    key: string;
    top: Section;
    child: Section | null;
    /** The letter: a recitation's or section's name, or a lecture's number. */
    text: string;
    /** Everything taking it would conflict with: the recitation's and its lecture's. */
    conflicts: string[];
    /** What the letter itself is marked for: the recitation's own conflicts (its lecture's tint all its letters). */
    own: string[];
  }

  // A, B, ... Z, then AA, AB (the data lists them as plain strings: A, AB, B).
  const byName = (a: Section, b: Section): number => a.name.length - b.name.length || a.name.localeCompare(b.name);

  interface Group {
    /** The lecture a run of recitations belongs to, for its conflict's tooltip. */
    label: string | null;
    /** What that lecture conflicts with. */
    conflicts: string[];
    choices: Choice[];
  }

  const groups = $derived.by((): Group[] => {
    const tops = topSections(course).toSorted(byName);
    const lone = (t: Section, text: string): Choice => {
      const conflicts = conflictsFor(t);
      return { key: t.name, top: t, child: null, text, conflicts, own: conflicts };
    };
    if (!tops.some((t) => childSections(course, t.name).length > 0)) {
      return [{ label: null, conflicts: [], choices: tops.map((t) => lone(t, t.name)) }];
    }
    return tops.map((t) => {
      const kids = childSections(course, t.name).toSorted(byName);
      const lecture = conflictsFor(t);
      return {
        label: kids.length > 0 ? partLabel(t) : null,
        conflicts: kids.length > 0 ? lecture : [],
        choices:
          kids.length === 0
            ? [lone(t, partLabel(t))]
            : kids.map((c) => {
                const own = conflictsFor(c);
                return { key: `${t.name}/${c.name}`, top: t, child: c, text: c.name, conflicts: [...new Set([...lecture, ...own])], own };
              }),
      };
    });
  });
  const choices = $derived(groups.flatMap((g) => g.choices));

  let hovered = $state<Choice | null>(null);
  let root = $state<HTMLElement>();
  // Whether letters run past the line's start or end; that end fades out.
  let moreBefore = $state(false);
  let moreAfter = $state(false);
  const mask = $derived(
    moreBefore || moreAfter
      ? `linear-gradient(to right, ${moreBefore ? "transparent, black 1.5rem" : "black"}, ${moreAfter ? "black calc(100% - 1.5rem), transparent" : "black"})`
      : undefined,
  );

  function measure(line: HTMLElement): void {
    moreBefore = line.scrollLeft > 1;
    moreAfter = line.scrollLeft + line.clientWidth < line.scrollWidth - 1;
  }

  // Centers the chosen letter when it's out of view. Setting scrollLeft scrolls only the line, never the rail or page.
  function reveal(line: HTMLElement): void {
    const button = line.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (button === null) return;
    const left = button.offsetLeft;
    if (left < line.scrollLeft || left + button.offsetWidth > line.scrollLeft + line.clientWidth) {
      line.scrollLeft = left - (line.clientWidth - button.offsetWidth) / 2;
    }
  }

  function chosen(c: Choice): boolean {
    return c.top.name === section?.name && (c.child === null || c.child.name === child?.name);
  }

  // The chosen letter takes the one tab stop (the first letter when none is chosen); arrows move between letters.
  const tabKey = $derived(choices.find((c) => chosen(c))?.key ?? choices[0]?.key);

  // The chosen letter stays in view as it changes.
  $effect(() => {
    void tabKey;
    if (root === undefined) return;
    reveal(root);
    measure(root);
  });

  // The fades follow the line's width; a line that mounted hidden (in a closed sheet) reveals its letter on showing.
  $effect(() => {
    const line = root;
    if (line === undefined) return;
    let shown = line.clientWidth > 0;
    const observer = new ResizeObserver(() => {
      if (!shown && line.clientWidth > 0) reveal(line);
      shown = line.clientWidth > 0;
      measure(line);
    });
    observer.observe(line);
    return () => observer.disconnect();
  });

  function preview(c: Choice | null): void {
    hovered = c;
    if (c === null) onpreview(null);
    else onpreview(c.child === null ? [c.top.name] : c.top.name === section?.name ? [c.child.name] : [c.top.name, c.child.name]);
  }

  function onkeydown(event: KeyboardEvent): void {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = [...(root?.querySelectorAll<HTMLButtonElement>("button[data-choice]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    const target = buttons[next];
    if (target === undefined) return;
    target.focus({ preventScroll: true });
    // Just enough to show it clear of the fades: the line's scroll padding is their width.
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    event.preventDefault();
  }

  // What the lines under the letters describe: the hovered choice, else the current one.
  const shownTop = $derived(hovered?.top ?? section);
  const shownChild = $derived(hovered === null ? child : hovered.child);
  const shownConflicts = $derived(hovered?.conflicts ?? []);

  /** Instructors worth naming: a recitation's only when they aren't its lecture's. */
  function teachers(s: Section): string[] {
    return s.instructors.filter((name) => teachesSection(course, s, name));
  }

  function describe(c: Choice): string {
    const parts = c.child === null ? [c.top] : [c.child, c.top];
    const where = parts.map((p) => {
      const w = timesAndRoom(p, roomsHidden);
      return `${partLabel(p)}, ${w.times}${w.room ? `, ${w.room}` : ""}`;
    });
    return `${where.join("; ")}${c.conflicts.length > 0 ? `; conflicts with ${joinList(c.conflicts)}` : ""}`;
  }
</script>

{#snippet line(s: Section)}
  {@const where = timesAndRoom(s, roomsHidden)}
  {@const names = teachers(s)}
  <div class="min-w-0">
    <p class="flex min-w-0 items-baseline gap-2 text-body-2 text-ink">
      <span class="shrink-0 font-semibold text-strong">{partLabel(s)}</span>
      <span class="min-w-0 truncate">{where.times}</span>
      {#if where.room}<span class="shrink-0 text-muted">{where.room}</span>{/if}
      {#if s.mini}<span class="shrink-0 rounded-tag bg-line px-1 text-label-sm font-semibold text-ink">Mini {s.mini}</span>{/if}
    </p>
    {#if names.length > 0}
      <p class="truncate text-label-md font-normal text-muted">
        {#each names as name, n (name)}{n > 0 ? ", " : ""}<span {...instructorPreview(name, termId)}>{name}</span>{/each}
      </p>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-1.5">
  <div class="rounded-tag border border-line-strong bg-surface p-0.5">
    <!-- A toolbar: one tab stop, arrows move between the letters. One line: each lecture's letters after the last's,
         split by a rule, a conflicting lecture's tinted red. Scroll padding keeps a focused letter clear of the fades. -->
    <div
      bind:this={root}
      role="toolbar"
      aria-label="Sections of {course.code}"
      tabindex="-1"
      {onkeydown}
      onscroll={(event) => measure(event.currentTarget)}
      onmouseleave={() => preview(null)}
      style:mask-image={mask}
      class="scrollbar-thin relative flex scroll-px-6 items-center gap-0.5 overflow-x-auto overscroll-x-contain"
    >
      {#each groups as group, g (g)}
        {#if g > 0}<span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-line-strong"></span>{/if}
        {#each group.choices as c (c.key)}
          {@const isChosen = chosen(c)}
          <!-- 40px (28px from 1024px) or its label's width, and an equal share of any room left on the line. -->
          <button
            type="button"
            data-choice
            aria-pressed={isChosen}
            aria-label={describe(c)}
            title={c.own.length > 0
              ? `Conflicts with ${joinList(c.own)}`
              : group.conflicts.length > 0 && group.label
                ? `${group.label} conflicts with ${joinList(group.conflicts)}`
                : undefined}
            tabindex={c.key === tabKey ? 0 : -1}
            onmouseenter={() => preview(c)}
            onfocus={() => preview(c)}
            onblur={() => preview(null)}
            onclick={() => {
              if (!isChosen) onpick(c.top.name, c.child?.name ?? null);
            }}
            style={isChosen ? courseColorStyle(color) : undefined}
            class="inline-flex h-10 min-w-max flex-[1_0_2.5rem] items-center justify-center rounded-[3px] px-1.5 text-label-lg tabular transition-colors focus-visible:-outline-offset-2 lg:h-7 lg:flex-[1_0_1.75rem] {isChosen
              ? 'course-block'
              : c.own.length > 0
                ? 'font-medium text-danger hover:bg-danger-bg'
                : group.conflicts.length > 0
                  ? 'bg-danger-bg font-medium text-ink hover:bg-hover'
                  : 'font-medium text-ink hover:bg-hover'}"
          >
            <!-- The dot sits by the letter, however wide its button has stretched. -->
            <span class="relative"
              >{c.text}{#if c.own.length > 0}<span
                  aria-hidden="true"
                  class="absolute top-0 -right-1.5 size-1.5 rounded-full bg-danger"
                ></span>{/if}</span
            >
          </button>
        {/each}
      {/each}
    </div>
  </div>

  {#if shownTop}
    <div class="flex flex-col gap-1">
      {@render line(shownTop)}
      {#if shownChild}{@render line(shownChild)}{/if}
      {#if shownConflicts.length > 0}
        <p class="flex items-center gap-1.5 text-label-md font-semibold text-danger">
          <TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />Would conflict with {joinList(shownConflicts)}
        </p>
      {/if}
    </div>
  {/if}
</div>

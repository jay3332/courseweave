<!--
  The week calendar (Courseweave's WeekGrid): weekday columns, hour rows, blocks placed by time with overlapping
  blocks side by side. Blocks come in (core/week-grid.ts's CalendarBlock, built with core/blocks.ts or
  core/planner/format.ts); clicks and hovers go out through each block's onClick/onHover and the onblockclick and
  onblockhover props. What a block shows besides its course code follows the student's calendar display preferences.
  At phone width it shows one day at a time, with a switch to the whole week. A visually hidden list repeats the
  calendar for screen readers.
-->
<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import { readLocal, writeLocal } from "$lib/components/ui/storage";
  import { courseColorStyle } from "$lib/core/colors";
  import type { CalendarDisplay } from "$lib/core/state/store";
  import { DAY_LONG, DAY_SHORT, formatTime, formatTimeRange } from "$lib/core/time";
  import type { Day } from "$lib/core/types";
  import { hourRange, layoutDay, shownDays, type CalendarBlock } from "$lib/core/week-grid";
  import { preferences } from "$lib/state";
  import type { CalendarView, TbaItem } from "./types";

  let {
    blocks,
    days,
    minHour = 8,
    maxHour = 18,
    hourHeight,
    compact = false,
    display,
    label = "Weekly calendar",
    view: viewMode = "auto",
    tba = [],
    tbaTitle = "No set meeting time",
    tbaDescription = "These count toward your units but don't appear on the calendar.",
    empty,
    onblockclick,
    onblockhover,
    class: className = "",
  }: {
    blocks: readonly CalendarBlock[];
    /** Days to show. Defaults to Monday to Friday plus any weekend day that has a block. */
    days?: Day[];
    /** First and last hour shown; widened to fit every block. */
    minHour?: number;
    maxHour?: number;
    /** Pixels per hour. Defaults to 52 (56 in the day view, 30 compact). */
    hourHeight?: number;
    /** Small type and no time or room lines, for previews in dialogs. */
    compact?: boolean;
    /** What blocks show besides the course code. Defaults to the student's calendar display preferences. */
    display?: CalendarDisplay;
    /** Accessible name of the calendar. */
    label?: string;
    /** auto: day by day on phones (with a switch to the week), the week otherwise. */
    view?: "auto" | CalendarView;
    /** Things without a set time, listed under the grid. */
    tba?: readonly TbaItem[];
    tbaTitle?: string;
    tbaDescription?: string;
    /** Shown over the grid when there are no blocks. */
    empty?: Snippet;
    /** A block was clicked (in addition to the block's own onClick). */
    onblockclick?: (block: CalendarBlock) => void;
    /** The pointer or focus entered (true) or left (false) a clickable block. */
    onblockhover?: (block: CalendarBlock, hovering: boolean) => void;
    class?: string;
  } = $props();

  const VIEW_KEY = "cmucourses:calendar-view";
  const id = $props.id();
  const phone = new MediaQuery("(max-width: 639.98px)");

  let chosenView = $state<CalendarView>(readLocal(VIEW_KEY) === "week" ? "week" : "day");
  let pickedDay = $state<Day | null>(null);

  const view = $derived<CalendarView>(
    viewMode === "auto" ? (phone.current ? chosenView : "week") : viewMode,
  );
  const shown = $derived(display ?? preferences.calendarDisplay);
  const allDays = $derived(shownDays([...blocks], days));
  const activeDay = $derived(
    pickedDay !== null && allDays.includes(pickedDay) ? pickedDay : defaultDay(allDays),
  );
  const visibleDays = $derived(view === "day" ? [activeDay] : allDays);
  const range = $derived(hourRange([...blocks], minHour, maxHour));
  const rowHeight = $derived(hourHeight ?? (compact ? 30 : view === "day" ? 56 : 52));
  const hours = $derived(Array.from({ length: range.to - range.from }, (_, i) => range.from + i));
  const small = $derived(compact || (view === "week" && phone.current));
  const byDay = $derived(
    new Map(allDays.map((d) => [d, layoutDay(blocks.filter((b) => b.day === d))])),
  );
  const solid = $derived(blocks.filter((b) => (b.variant ?? "solid") !== "ghost"));
  const showSwitch = $derived(viewMode === "auto" && phone.current);

  /** Today when it's shown, else the first day with a class, else the first day. */
  function defaultDay(list: Day[]): Day {
    const today = ((new Date().getDay() + 6) % 7) as Day;
    if (list.includes(today) && blocks.some((b) => b.day === today)) return today;
    return list.find((d) => blocks.some((b) => b.day === d)) ?? list[0] ?? 0;
  }

  function setView(next: string): void {
    chosenView = next === "week" ? "week" : "day";
    writeLocal(VIEW_KEY, chosenView);
  }

  function top(minutes: number): number {
    return ((minutes - range.from * 60) / 60) * rowHeight;
  }

  function hourLabel(hour: number): string {
    if (small) return formatTime(hour * 60, true);
    const h = hour % 12 === 0 ? 12 : hour % 12;
    return `${h} ${hour < 12 ? "AM" : "PM"}`;
  }

  function clickable(block: CalendarBlock): boolean {
    return block.onClick !== undefined || onblockclick !== undefined;
  }

  function click(block: CalendarBlock): void {
    block.onClick?.();
    onblockclick?.(block);
  }

  function hover(block: CalendarBlock, hovering: boolean): void {
    block.onHover?.(hovering);
    onblockhover?.(block, hovering);
  }

  /**
   * "15-122 Principles of Imperative Computation, Lec 1, Monday 9:30-10:50 AM, GHC 4401, conflicts with another class",
   * then the tooltip's hint ("Select to see other lectures.") when `hint` is set.
   */
  function spoken(block: CalendarBlock, hint = true): string {
    const [main = "", ...rest] = (block.tooltip ?? [block.label, block.section].filter(Boolean).join(" "))
      .replace(/\.$/u, "")
      .split(". ");
    const parts = [main, `${DAY_LONG[block.day]} ${formatTimeRange(block.start, block.end)}`];
    const where = block.location;
    if (where !== undefined && where !== "TBA") parts.push(where);
    if (block.mini !== null && block.mini !== undefined) parts.push(`mini ${block.mini}`);
    if (block.variant === "preview") parts.unshift("Preview");
    if (block.variant === "ghost") parts.unshift("Option");
    if (block.conflict === true) parts.push("conflicts with another class");
    const text = parts.join(", ");
    return hint && rest.length > 0 ? `${text}. ${rest.join(". ")}.` : text;
  }

  function blockStyle(block: CalendarBlock, lane: number, lanes: number): string {
    const y = top(block.start) + 1;
    const h = Math.max(top(block.end) - top(block.start) - 2, 14);
    return `top:${y}px;height:${h}px;left:calc(${(lane / lanes) * 100}% + 2px);width:calc(${100 / lanes}% - 4px);${courseColorStyle(block.color)}`;
  }

  function blockHeight(block: CalendarBlock): number {
    return Math.max(top(block.end) - top(block.start) - 2, 14);
  }

  const variants = {
    solid: "course-block",
    preview: "hatch z-10 border border-dashed border-(--course) bg-surface/85 text-strong",
    ghost:
      "border border-dashed border-line-strong bg-surface/75 text-muted hover:course-tint hover:border-(--course) hover:text-ink focus-visible:course-tint",
  };

  function blockClass(block: CalendarBlock): string {
    const ring =
      block.conflict === true
        ? "ring-2 ring-danger"
        : block.selected === true
          ? "z-20 shadow-popover ring-2 ring-(--course)"
          : "";
    return `@container absolute overflow-hidden rounded-[5px] text-left leading-tight transition-[box-shadow,opacity] duration-100 ${variants[block.variant ?? "solid"]} ${ring}`;
  }

  // Day tabs: arrow keys move between days.
  let dayTabs = $state<HTMLElement>();
  function onDayKey(event: KeyboardEvent): void {
    const i = allDays.indexOf(activeDay);
    let next = i;
    if (event.key === "ArrowRight") next = i + 1;
    else if (event.key === "ArrowLeft") next = i - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = allDays.length - 1;
    else return;
    event.preventDefault();
    const day = allDays[(next + allDays.length) % allDays.length];
    if (day === undefined) return;
    pickedDay = day;
    dayTabs?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  }
</script>

{#snippet blockBody(block: CalendarBlock)}
  {@const h = blockHeight(block)}
  {@const structured = block.section !== undefined || block.location !== undefined}
  {@const tag = shown.section && block.section ? block.section : null}
  {@const room = block.location === "TBA" ? undefined : block.location}
  {@const detail = structured ? (shown.location ? room : undefined) : block.detail}
  {@const title = shown.title && !small && h >= 30 ? block.title : undefined}
  <!-- Each line under the code needs about 20px more: the course name first, then the time, then the room. -->
  {@const showTime = shown.time && !small && h >= (title ? 50 : 30)}
  {@const inline = view === "day" && !small && h < 50}
  {@const showDetail =
    !small && Boolean(detail) && (inline ? h >= 30 : h >= 30 + (title ? 20 : 0) + (showTime ? 20 : 0))}
  <span class="flex items-start gap-1 {small ? 'px-1 pt-0.5' : 'px-1.5 pt-1'}">
    <span
      class="flex min-w-0 flex-wrap items-baseline gap-x-1 leading-tight {small
        ? 'text-[10.5px]'
        : 'text-[13px]'}"
    >
      <span class="tabular font-bold">{block.label}</span>
      {#if tag}
        <span class="font-semibold whitespace-nowrap opacity-85 {small ? 'text-[9.5px]' : 'text-[11.5px]'}"
          >{tag}</span
        >
      {/if}
    </span>
    {#if block.mini}
      <span
        class="ml-auto shrink-0 rounded-sm bg-[color-mix(in_oklab,var(--course)_22%,transparent)] px-1 text-[9.5px] font-semibold @max-[5.5rem]:hidden"
        >M{block.mini}</span
      >
    {/if}
    {#if block.conflict}
      <TriangleAlert aria-hidden="true" class="ml-auto size-3 shrink-0 text-danger @max-[4.5rem]:hidden" />
    {/if}
  </span>
  {#if inline && (title || showTime || showDetail)}
    <span class="block truncate px-1.5 text-[11.5px] opacity-80">
      {#if title}<span class="font-medium">{title}</span>{/if}{#if title && (showTime || showDetail)}&nbsp;&middot;&nbsp;{/if}{#if showTime}{formatTimeRange(block.start, block.end)}{/if}{#if showTime && showDetail}&nbsp;&middot;&nbsp;{/if}{#if showDetail}{detail}{/if}
    </span>
  {:else}
    {#if title}
      <span class="block truncate px-1.5 text-[11px] font-medium opacity-90">{title}</span>
    {/if}
    {#if showTime}
      <span class="block truncate px-1.5 text-[11px] opacity-80">{formatTimeRange(block.start, block.end)}</span>
    {/if}
    {#if showDetail}
      <span class="block truncate px-1.5 text-[11px] opacity-80">{detail}</span>
    {/if}
  {/if}
{/snippet}

<div class="flex min-w-0 flex-col {className}">
  {#if showSwitch}
    <div class="mb-2 flex items-center gap-2">
      {#if view === "day"}
        <div
          bind:this={dayTabs}
          role="tablist"
          aria-label="Day"
          tabindex="-1"
          onkeydown={onDayKey}
          class="flex min-w-0 flex-1 gap-1"
        >
          {#each allDays as d (d)}
            {@const selected = d === activeDay}
            {@const count = blocks.filter((b) => b.day === d && (b.variant ?? "solid") === "solid").length}
            <button
              type="button"
              role="tab"
              data-day={d}
              aria-selected={selected}
              aria-controls="{id}-grid"
              aria-label="{DAY_LONG[d]}, {count} {count === 1 ? 'class' : 'classes'}"
              tabindex={selected ? 0 : -1}
              onclick={() => (pickedDay = d)}
              class="relative flex h-10 min-w-0 flex-1 flex-col items-center justify-center rounded-field text-label-md transition-colors {selected
                ? 'bg-strong text-surface'
                : 'text-ink hover:bg-hover'}"
            >
              {DAY_SHORT[d]}
              <span
                aria-hidden="true"
                class="mt-0.5 size-1 rounded-full {count > 0
                  ? selected
                    ? 'bg-surface'
                    : 'bg-accent'
                  : 'bg-transparent'}"
              ></span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="min-w-0 flex-1 text-label-md text-muted">Whole week</p>
      {/if}
      <SegmentedControl
        label="Calendar view"
        size="sm"
        value={view}
        onchange={setView}
        options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
        ]}
      />
    </div>
  {/if}

  <div
    id="{id}-grid"
    role={showSwitch && view === "day" ? "tabpanel" : "group"}
    aria-label={showSwitch && view === "day" ? `${label}, ${DAY_LONG[activeDay]}` : label}
    class="relative flex min-w-0 flex-col"
  >
    <!-- The rule under the day names spans the days only, like the hour lines, so the first hour's label sits on its
         line without a rule through it. -->
    <div class="flex" aria-hidden="true">
      <div class="shrink-0 {small ? 'w-8' : 'w-12'}"></div>
      <div class="flex min-w-0 flex-1 border-b border-line">
        {#each visibleDays as d (d)}
          <div
            class="min-w-0 flex-1 text-center font-semibold text-ink {small
              ? 'py-1 text-[11px]'
              : 'py-2 text-label-md'}"
          >
            {view === "day" ? DAY_LONG[d] : DAY_SHORT[d]}
          </div>
        {/each}
      </div>
    </div>

    <div class="relative flex" style="height:{hours.length * rowHeight}px">
      <div class="relative shrink-0 {small ? 'w-8' : 'w-12'}" aria-hidden="true">
        {#each hours as h (h)}
          <div
            class="tabular absolute right-1.5 -translate-y-1/2 whitespace-nowrap text-muted {small
              ? 'text-[10px]'
              : 'text-[11px]'}"
            style="top:{top(h * 60)}px"
          >
            {hourLabel(h)}
          </div>
        {/each}
      </div>

      <div
        class="relative flex flex-1 border-l border-line"
        style="background-image: repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px {rowHeight /
          2}px, color-mix(in oklab, var(--color-line) 45%, transparent) {rowHeight / 2}px {rowHeight / 2 +
          1}px, transparent {rowHeight / 2 + 1}px {rowHeight}px)"
      >
        {#each visibleDays as d (d)}
          <div class="relative min-w-0 flex-1 border-r border-line last:border-r-0">
            {#each byDay.get(d) ?? [] as { block, lane, lanes } (block.key)}
              {#if clickable(block)}
                <button
                  type="button"
                  aria-label={spoken(block)}
                  title={block.tooltip}
                  class="{blockClass(block)} cursor-pointer focus-visible:z-30"
                  style={blockStyle(block, lane, lanes)}
                  onclick={() => click(block)}
                  onmouseenter={() => hover(block, true)}
                  onmouseleave={() => hover(block, false)}
                  onfocus={() => hover(block, true)}
                  onblur={() => hover(block, false)}
                >
                  {@render blockBody(block)}
                </button>
              {:else}
                <div
                  aria-hidden="true"
                  title={block.tooltip}
                  class={blockClass(block)}
                  style={blockStyle(block, lane, lanes)}
                >
                  {@render blockBody(block)}
                </div>
              {/if}
            {/each}
          </div>
        {/each}
        {#if blocks.length === 0 && empty}
          <div class="absolute inset-0 grid place-items-center p-6">{@render empty()}</div>
        {/if}
      </div>
    </div>
  </div>

  <ul class="sr-only" aria-label="{label}, as a list">
    {#each allDays as d (d)}
      {@const list = solid.filter((b) => b.day === d).toSorted((a, b) => a.start - b.start)}
      <li>
        {DAY_LONG[d]}: {list.length === 0 ? "no classes" : `${list.length} ${list.length === 1 ? "class" : "classes"}`}
        {#if list.length > 0}
          <ul>
            {#each list as block (block.key)}
              <li>{spoken(block, false)}</li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>

  {#if tba.length > 0}
    <section aria-labelledby="{id}-tba" class="mt-6">
      <h3 id="{id}-tba" class="text-heading-6 text-strong">{tbaTitle}</h3>
      {#if tbaDescription}<p class="mb-2 text-body-2 text-muted">{tbaDescription}</p>{/if}
      <ul class="divide-y divide-line rounded-card border border-line bg-surface">
        {#each tba as item (item.key)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2" style={courseColorStyle(item.color)}>
            <span aria-hidden="true" class="course-swatch size-2.5 shrink-0 rounded-full"></span>
            <span class="tabular code-column text-label-lg text-strong">{item.label}</span>
            {#if item.title}
              {#if item.href}
                <a href={item.href} class="min-w-0 flex-1 basis-40 truncate text-body-2 text-ink hover:underline"
                  >{item.title}</a
                >
              {:else}
                <span class="min-w-0 flex-1 basis-40 truncate text-body-2 text-ink">{item.title}</span>
              {/if}
            {/if}
            {#if item.detail}<span class="shrink-0 text-label-md text-muted">{item.detail}</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

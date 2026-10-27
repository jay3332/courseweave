<!--
  The semester's schedules as tabs (Courseweave's ScheduleTabs), each with its units in a pill: switch, create (blank or from
  a degree plan's semester), rename (double-click or the menu), duplicate, share, delete and rearrange (drag a tab, or
  move the shown one from the menu). A tab synced with the active degree plan's semester is marked, as is one friends
  can see.
-->
<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    CirclePlus,
    Copy,
    Ellipsis,
    GraduationCap,
    Link2,
    Pencil,
    PencilLine,
    Plus,
    RefreshCw,
    Trash2,
    Users,
  } from "@lucide/svelte";
  import { tick } from "svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Menu, { type MenuEntry } from "$lib/components/ui/Menu.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import type { Term } from "$lib/core/data";
  import { effectiveTermCourses } from "$lib/core/plan";
  import { plural, scheduleUnits } from "$lib/core/planner/format";
  import { entriesFromPlan } from "$lib/core/planner/fromPlan";
  import { codeOf } from "$lib/core/requisite-format";
  import { nextScheduleName } from "$lib/core/state/store";
  import { plans, schedules, type ScheduleItem } from "$lib/state";

  let {
    term,
    activeId,
    onshare,
    ontarget,
  }: {
    term: Term;
    /** The schedule shown, or null when the semester has none yet. */
    activeId: string | null;
    /** Opens sharing for the shown schedule. */
    onshare: () => void;
    /** The shown schedule's id, created when the semester has none yet. */
    ontarget: () => string;
  } = $props();

  const termId = $derived(term.meta.id);
  let tablist = $state<HTMLElement>();
  const list = $derived(schedules.forTerm(termId));
  const active = $derived(list.find((s) => s.id === activeId) ?? null);
  const activeIndex = $derived(list.findIndex((s) => s.id === activeId));
  const placeholder = $derived(nextScheduleName(Object.values(schedules.items).filter((s) => s.termId === termId)));

  // Schedules a semester of the active degree plan is synced with.
  const activePlan = $derived(plans.active);
  const synced = $derived(
    new Set(
      activePlan?.terms
        .filter((t) => t.term === termId && t.link !== undefined && t.link !== null)
        .map((t) => t.link?.scheduleId ?? "") ?? [],
    ),
  );

  // Degree plans with courses in this semester can start a schedule.
  const fromPlans = $derived(
    plans.list
      .map((plan) => ({ plan, courses: effectiveTermCourses(plan, schedules.items).get(termId)?.courses ?? [] }))
      .filter((p) => p.courses.length > 0),
  );

  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let pendingDelete = $state<ScheduleItem | null>(null);
  let deleteOpen = $state(false);
  let tabs = $state<HTMLElement>();

  function create(): void {
    schedules.createSchedule(termId);
  }

  function createFromPlan(name: string, courses: { courseId: string; passFail?: boolean }[]): void {
    const { entries, skipped } = entriesFromPlan(courses, term);
    schedules.createSchedule(termId, `From ${name}`, entries);
    toast(
      skipped.length > 0
        ? `Added ${plural(entries.length, "course")} from ${name}. Not offered in ${term.meta.name}: ${skipped.map((id) => codeOf(id)).join(", ")}.`
        : `Added ${plural(entries.length, "course")} from ${name}.`,
      { kind: "success" },
    );
  }

  async function startRename(id: string): Promise<void> {
    const s = schedules.get(id);
    renameValue = s?.name ?? placeholder;
    renaming = id;
    await tick();
    const input = tabs?.querySelector<HTMLInputElement>("[data-rename]");
    input?.focus();
    input?.select();
  }

  function finishRename(save: boolean): void {
    const id = renaming;
    renaming = null;
    const name = renameValue.trim();
    if (id === null || !save || name === "") return;
    schedules.renameSchedule(id, name.slice(0, 120));
  }

  // Dragging a tab: it follows the pointer along the strip, the tabs it passes make room, and letting go puts it there
  // and shows it, as a browser's tabs do. A mouse drags once it has moved a few pixels, so clicks and double-clicks
  // still switch and rename; a finger holds the tab a moment first, so a swipe still scrolls the strip.
  let drag = $state<{ id: string; from: number; to: number; dx: number; size: number } | null>(null);
  // For the update that puts the tabs in their new order: the ones that made room are already there, so they don't
  // slide.
  let settling = $state(false);
  let endPress: (() => void) | null = null;
  $effect(() => () => endPress?.());

  // Once a drag starts, a finger moves the tab instead of scrolling the strip. The browser only waits to scroll for
  // a listener that was there when the touch began, so this one always is.
  $effect(() => {
    const strip = tablist;
    if (strip === undefined) return;
    const hold = (event: TouchEvent): void => {
      if (drag !== null) event.preventDefault();
    };
    strip.addEventListener("touchmove", hold, { passive: false });
    return () => strip.removeEventListener("touchmove", hold);
  });

  function press(event: PointerEvent, id: string): void {
    const tab = event.currentTarget;
    const strip = tablist;
    if (event.button !== 0 || !(tab instanceof HTMLElement) || strip === undefined) return;
    const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
    const from = tabs.indexOf(tab);
    if (renaming !== null || tabs.length < 2 || from < 0) return;
    endPress?.();

    // Positions along the strip's content, which hold as it scrolls.
    const stripLeft = strip.getBoundingClientRect().left;
    const at = (clientX: number): number => clientX - stripLeft + strip.scrollLeft;
    const boxes = tabs.map((t) => {
      const r = t.getBoundingClientRect();
      return { left: at(r.left), right: at(r.right) };
    });
    const first = boxes[0];
    const second = boxes[1];
    const last = boxes.at(-1);
    const self = boxes[from];
    if (first === undefined || second === undefined || last === undefined || self === undefined) return;
    const size = self.right - self.left + second.left - first.right;
    const startX = at(event.clientX);
    const touch = event.pointerType === "touch";
    let pointerX = event.clientX;
    let started = false;
    let frame = 0;

    // It goes past a tab once its leading edge passes that tab's middle; it stays within the row of tabs.
    const update = (): void => {
      const dx = Math.min(Math.max(at(pointerX) - startX, first.left - self.left), last.right - self.right);
      const to = boxes.filter((b, i) => {
        const middle = (b.left + b.right) / 2;
        return i < from ? self.left + dx > middle : i > from && self.right + dx > middle;
      }).length;
      drag = { id, from, to, dx, size };
    };
    // Near either end of a strip that scrolls, it scrolls along.
    const scroll = (): void => {
      frame = 0;
      const r = strip.getBoundingClientRect();
      const before = strip.scrollLeft;
      if (pointerX < r.left + 40) strip.scrollLeft -= 8;
      else if (pointerX > r.right - 40) strip.scrollLeft += 8;
      if (strip.scrollLeft === before) return;
      update();
      frame = requestAnimationFrame(scroll);
    };
    const begin = (): void => {
      started = true;
      try {
        tab.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that's already gone: the drag still follows its events.
      }
      update();
    };
    const timer = touch ? setTimeout(begin, 400) : undefined;

    const end = (drop: boolean): void => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      endPress = null;
      const done = drag;
      drag = null;
      if (!started || done === null || !drop) return;
      schedules.setActiveSchedule(termId, id);
      if (done.to === done.from) return;
      settling = true;
      schedules.moveSchedule(id, list.filter((s) => s.id !== id)[done.to]?.id ?? null);
      void tick().then(() => {
        // Lays the tabs out in their new places before their slide comes back.
        strip.getBoundingClientRect();
        settling = false;
      });
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== event.pointerId) return;
      pointerX = e.clientX;
      if (!started) {
        const moved = Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY);
        // A finger that moves before the hold is up is scrolling.
        if (touch && moved > 8) end(false);
        else if (!touch && moved > 4) begin();
        return;
      }
      update();
      if (frame === 0) frame = requestAnimationFrame(scroll);
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId === event.pointerId) end(true);
    };
    const cancel = (e: PointerEvent): void => {
      if (e.pointerId === event.pointerId) end(false);
    };
    endPress = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  /** How far a drag moves tab `i`: the dragged one follows the pointer; the ones it passes move a place. */
  function shift(i: number): number {
    if (drag === null) return 0;
    if (i === drag.from) return drag.dx;
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -drag.size;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.size;
    return 0;
  }

  // Arrow keys move between tabs, as in the design system's Tabs.
  function onTabKey(event: KeyboardEvent): void {
    const i = list.findIndex((s) => s.id === activeId);
    let next = i;
    if (event.key === "ArrowRight") next = i + 1;
    else if (event.key === "ArrowLeft") next = i - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    const target = list[(next + list.length) % list.length];
    if (target === undefined) return;
    schedules.setActiveSchedule(termId, target.id);
    void tick().then(() => tabs?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
  }

  const newItems = $derived<MenuEntry[]>([
    { label: "Blank schedule", icon: Plus, onselect: create },
    ...fromPlans.map(({ plan, courses }) => ({
      label: `From ${plan.name} (${plural(courses.length, "course")})`,
      icon: GraduationCap,
      onselect: () => createFromPlan(plan.name, courses),
    })),
  ]);

  const optionItems = $derived<MenuEntry[]>([
    { label: "Rename", icon: Pencil, onselect: () => void startRename(ontarget()) },
    {
      label: "Duplicate",
      icon: Copy,
      disabled: active === null,
      onselect: () => {
        if (active !== null) schedules.duplicateSchedule(active.id);
      },
    },
    { label: "Share", icon: Link2, onselect: onshare },
    // What dragging a tab does, for the keyboard and screen readers.
    ...(list.length > 1
      ? ([
          "separator",
          {
            label: "Move left",
            icon: ArrowLeft,
            disabled: activeIndex < 1,
            onselect: () => {
              if (active !== null) schedules.moveSchedule(active.id, list[activeIndex - 1]?.id ?? null);
            },
          },
          {
            label: "Move right",
            icon: ArrowRight,
            disabled: activeIndex < 0 || activeIndex === list.length - 1,
            onselect: () => {
              if (active !== null) schedules.moveSchedule(active.id, list[activeIndex + 2]?.id ?? null);
            },
          },
        ] satisfies MenuEntry[])
      : []),
    "separator",
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      disabled: active === null,
      onselect: () => {
        pendingDelete = active;
        deleteOpen = true;
      },
    },
  ]);

  // Narrow screens scroll the tabs: keep the shown schedule's tab in view, such as a new one at the end.
  $effect(() => {
    void activeId;
    void list.length;
    const strip = tablist;
    const tab = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (strip === undefined || tab === null || tab === undefined) return;
    // Room for the focus ring on either side (the strip's padding).
    const left = tab.offsetLeft - strip.offsetLeft - 4;
    const right = left + tab.offsetWidth + 8;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  });
</script>

<div bind:this={tabs} class="flex items-end gap-3 border-b border-line">
  <!-- The padding (offset by negative margins) keeps the 2px focus rings of the tabs and the rename field inside the
       scrolling strip, which would otherwise clip them. -->
  <div
    bind:this={tablist}
    role="tablist"
    aria-label="Schedules"
    class="scrollbar-thin -mx-1 -mt-1 -mb-1.5 flex min-w-0 items-end gap-5 overflow-x-auto px-1 pt-1 pb-1.5 select-none"
  >
    {#each list.length > 0 ? list : [null] as s, i (s?.id ?? "placeholder")}
      {@const id = s?.id ?? null}
      {@const isActive = id === activeId || s === null}
      {#if renaming !== null && (renaming === id || (s === null && renaming === activeId))}
        <input
          data-rename
          bind:value={renameValue}
          aria-label="Schedule name"
          maxlength={120}
          onblur={() => finishRename(true)}
          onkeydown={(event) => {
            if (event.key === "Enter") finishRename(true);
            if (event.key === "Escape") {
              event.preventDefault();
              finishRename(false);
            }
          }}
          class="focus-field mb-1.5 h-9 w-52 shrink-0 rounded-field border border-line-strong bg-surface px-3 text-heading-6 text-strong"
        />
      {:else}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          tabindex={isActive ? 0 : -1}
          onclick={() => {
            if (id !== null) schedules.setActiveSchedule(termId, id);
          }}
          onkeydown={onTabKey}
          onpointerdown={(event) => {
            if (id !== null) press(event, id);
          }}
          ondblclick={() => void startRename(id ?? ontarget())}
          title={isActive ? "Double-click to rename, or drag to move" : undefined}
          style={shift(i) === 0 ? undefined : `transform: translateX(${shift(i)}px)`}
          class="relative -mb-px flex shrink-0 items-center gap-2 border-b-2 pt-1 pb-3 {drag?.id === id
            ? 'z-10 -mx-2 cursor-grabbing rounded-t-field bg-surface-2 px-2 shadow-md transition-colors'
            : settling
              ? 'transition-colors'
              : 'transition-[color,border-color,transform] motion-reduce:transition-colors'} {isActive
            ? 'border-accent text-strong'
            : 'border-transparent text-muted hover:text-ink'}"
        >
          <span class="max-w-52 truncate {isActive ? 'text-heading-4' : 'text-heading-6'}">{s?.name ?? placeholder}</span>
          {#if s !== null && synced.has(s.id)}
            <span title="Synced with {activePlan?.name}" class="inline-flex text-ok">
              <RefreshCw aria-hidden="true" class="size-4" />
              <span class="sr-only">(synced with {activePlan?.name})</span>
            </span>
          {/if}
          {#if s?.visibility === "friends"}
            <span title="Friends can see it" class="inline-flex text-muted">
              <Users aria-hidden="true" class="size-4" />
              <span class="sr-only">(friends can see it)</span>
            </span>
          {/if}
          <Chip tone="neutral" size="sm" shape="pill" class="tabular font-normal"
            >{plural(s === null ? 0 : scheduleUnits(s, term), "unit")}</Chip
          >
        </button>
      {/if}
    {/each}
  </div>

  <div class="mb-1.5 flex shrink-0 items-center">
    <IconButton label="Rename schedule" icon={PencilLine} size="sm" onclick={() => void startRename(ontarget())} />
    {#if fromPlans.length > 0}
      <Menu items={newItems} label="New schedule">
        {#snippet trigger(props)}
          <IconButton {...props} label="New schedule" icon={CirclePlus} size="sm" />
        {/snippet}
      </Menu>
    {:else}
      <IconButton label="New schedule" icon={CirclePlus} size="sm" onclick={create} />
    {/if}
    <Menu items={optionItems} label="Options for {active?.name ?? placeholder}">
      {#snippet trigger(props)}
        <IconButton {...props} label="Options for {active?.name ?? placeholder}" icon={Ellipsis} size="sm" />
      {/snippet}
    </Menu>
  </div>
</div>

<Dialog bind:open={deleteOpen} title="Delete this schedule?" size="sm">
  {#if pendingDelete}
    <p class="text-body-2 text-ink">
      &ldquo;{pendingDelete.name}&rdquo; and its {plural(pendingDelete.entries.length, "course")} will be removed. This
      can't be undone.
    </p>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (deleteOpen = false)}>Cancel</Button>
    <Button
      variant="danger"
      onclick={() => {
        if (pendingDelete !== null) schedules.deleteSchedule(pendingDelete.id);
        pendingDelete = null;
        deleteOpen = false;
      }}>Delete schedule</Button
    >
  {/snippet}
</Dialog>

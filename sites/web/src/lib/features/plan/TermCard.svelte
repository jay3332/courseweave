<script lang="ts">
  // One semester of the plan: its courses from the record and the plan, unit totals and load guidance, adding
  // courses, drag and drop between semesters, and a link to a schedule (synced or copied).
  // Courseweave's features/degree/TermCard.tsx.
  import {
    CalendarDays,
    ChevronDown,
    Copy,
    RefreshCw,
    Trash2,
    TriangleAlert,
    Unlink,
  } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import { statusFnFor } from "$lib/core/record/check-summary";
  import type { ColumnView } from "$lib/core/degree/hooks";
  import { DRAG_NEW_COURSE, DRAG_TYPE } from "$lib/core/degree/hooks";
  import {
    coursesMissingFrom,
    loadFlags,
    planRequisiteContext,
    termPhase,
    type PlanCourse,
  } from "$lib/core/plan";
  import type { requirementsByCourse } from "$lib/core/plan-table";
  import { codeOf } from "$lib/core/requisite-format";
  import { termLabel } from "$lib/core/requisites";
  import { schedulesPath } from "$lib/core/routes";
  import type { Schedule } from "$lib/core/state/store";
  import { links, plans, schedules } from "$lib/state";
  import AddCourseInput from "./AddCourseInput.svelte";
  import { planPage } from "./context";
  import MenuItem from "./MenuItem.svelte";
  import MenuLabel from "./MenuLabel.svelte";
  import OptionsMenu from "./OptionsMenu.svelte";
  import PlanCourseRow from "./PlanCourseRow.svelte";
  import PlanCourseTableRow from "./PlanCourseTableRow.svelte";
  import RecordCourseRow from "./RecordCourseRow.svelte";
  import RecordCourseTableRow from "./RecordCourseTableRow.svelte";
  import { dropsInPlace, nudgeTarget } from "./rows";
  import TermTotals from "./TermTotals.svelte";

  let {
    column,
    requirements,
  }: {
    column: ColumnView;
    /** Detailed layout: the requirements each course counts toward. */
    requirements: ReturnType<typeof requirementsByCourse> | undefined;
  } = $props();

  const page = planPage();
  const term = $derived(column.term);
  const plan = $derived(page.plan);
  const table = $derived(page.layout === "table");
  const open = $derived(!page.compact || page.isOpen(term));
  const headingId = $derived(`term-${term}-heading`);
  const bodyId = $derived(`term-${term}-body`);

  // Where a dragged course would land: before this course (null: at the end); undefined when not dragging here.
  let dropBefore = $state<string | null | undefined>(undefined);
  let pendingImport = $state<Schedule | null>(null);
  let pendingLink = $state<{ schedule: Schedule; missing: PlanCourse[] } | null>(null);
  let confirmRemove = $state(false);

  const phase = $derived(termPhase(term, page.derived.current));
  const tag = $derived(phase === "past" ? "Completed" : phase === "current" ? "In progress" : null);
  const termSchedules = $derived(schedules.forTerm(term));
  const withCourses = $derived(termSchedules.filter((s) => s.entries.length > 0));
  const synced = $derived(page.derived.terms.get(term));
  const syncedSchedule = $derived(synced?.schedule ? schedules.get(synced.schedule.id) : undefined);
  const published = $derived(page.published.has(term));
  const scheduled = $derived(page.scheduled.get(term));
  const inPlan = $derived(
    new Set(page.derived.resolved.terms.flatMap((t) => t.courses.map((c) => c.courseId))),
  );
  const chipStatus = $derived(
    table
      ? statusFnFor(planRequisiteContext(page.derived.resolved, page.record, page.catalog, term), false)
      : undefined,
  );
  const moveTargets = $derived(plan.terms.map((t) => t.term).filter((t) => t !== term));
  const flags = $derived(loadFlags(column.totals));
  const problems = $derived(
    column.planned.filter((c) => page.derived.checks.get(c.id)?.check.level === "problem").length,
  );
  const empty = $derived(column.planned.length === 0 && column.recorded.length === 0);
  const removeLabel = $derived(syncedSchedule ? `Remove from ${syncedSchedule.name}` : undefined);
  const visibleCount = (s: Schedule): number => s.entries.filter((e) => !e.hidden).length;

  function startSync(s: Schedule): void {
    const own = plan.terms.find((t) => t.term === term)?.courses ?? [];
    const missing = coursesMissingFrom(own, s);
    if (missing.length > 0) pendingLink = { schedule: s, missing };
    else links.linkTermToSchedule(plan, term, s, "as-is");
  }

  function importSchedule(s: Schedule): void {
    plans.setTermCourses(
      plan.id,
      term,
      s.entries.filter((e) => !e.hidden).map((e) => ({ courseId: e.courseId, passFail: e.passFail })),
    );
    pendingImport = null;
  }

  function openSchedule(id: string): void {
    schedules.setActiveSchedule(term, id);
    void goto(schedulesPath(term, id));
  }

  // ---- Drag and drop ----

  function dragKind(event: DragEvent): "move" | "add" | null {
    const types = event.dataTransfer?.types ?? [];
    if (types.includes(DRAG_NEW_COURSE)) return "add";
    if (types.includes(DRAG_TYPE)) return "move";
    return null;
  }

  /** The planned course the pointer is above (by row midpoints), or null past the last one. */
  function dropTarget(event: DragEvent): string | null {
    if (!(event.currentTarget instanceof HTMLElement)) return null;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-plan-row]")];
    const hit = rows.find((r) => {
      const box = r.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    return hit?.dataset.planRow ?? null;
  }

  function ondragover(event: DragEvent): void {
    const kind = dragKind(event);
    if (kind === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = kind === "add" ? "copy" : "move";
    dropBefore = dropTarget(event);
  }

  function ondragleave(event: DragEvent): void {
    if (event.currentTarget instanceof HTMLElement && event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    dropBefore = undefined;
  }

  function ondrop(event: DragEvent): void {
    const moved = event.dataTransfer?.getData(DRAG_TYPE) ?? "";
    const added = event.dataTransfer?.getData(DRAG_NEW_COURSE) ?? "";
    const before = dropTarget(event);
    dropBefore = undefined;
    page.endDrag();
    if (moved === "" && added === "") return;
    event.preventDefault();
    if (moved !== "") {
      if (dropsInPlace(column.planned, moved, before)) return;
      links.moveInPlan(plan, moved, term, before);
    } else {
      const id = links.addToTerm(plan, term, added);
      if (before !== null) links.placeInTerm(plan, id, term, before);
    }
  }

  /** Reorders by one, keeping focus on the course's options button for repeated moves. */
  function nudge(id: string, before: string | null): void {
    links.moveInPlan(plan, id, term, before);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[id="plan-course-${id}"] button[aria-label^="Options"]`)?.focus();
    });
  }

  function rowProps(c: PlanCourse, i: number) {
    const up = nudgeTarget(column.planned, i, "up");
    const down = nudgeTarget(column.planned, i, "down");
    const last = i === column.planned.length - 1;
    return {
      course: c,
      term,
      scheduled,
      moveTargets,
      removeLabel,
      dropMark:
        dropBefore === c.id
          ? ("before" as const)
          : dropBefore === null && last
            ? ("after" as const)
            : undefined,
      onmove: (t: string) => links.moveInPlan(plan, c.id, t),
      onmoveup: up === undefined ? undefined : () => nudge(c.id, up),
      onmovedown: down === undefined ? undefined : () => nudge(c.id, down),
      onremove: () => links.removeFromPlan(plan, c.id),
      onupdate: (patch: { passFail?: boolean; units?: number }) => {
        if ("passFail" in patch) links.setPlanPassFail(plan, c.id, patch.passFail === true);
        if ("units" in patch) links.setPlanUnits(plan, c.id, patch.units);
      },
    };
  }
</script>

{#snippet chips()}
  {#if tag}
    <span class="shrink-0 rounded-full bg-paper px-2 py-0.5 text-label-md text-ink">{tag}</span>
  {/if}
  {#if problems > 0}
    <span
      class="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-label-md text-danger"
      title="Courses with unmet requisites"
    >
      <TriangleAlert aria-hidden="true" class="size-3" />
      {problems}<span class="max-sm:sr-only">{problems === 1 ? " issue" : " issues"}</span>
    </span>
  {/if}
{/snippet}

<section
  id="term-{term}"
  aria-labelledby={headingId}
  ondragover={page.dragEnabled ? ondragover : undefined}
  ondragleave={page.dragEnabled ? ondragleave : undefined}
  ondrop={page.dragEnabled ? ondrop : undefined}
  class="flex min-w-0 flex-col rounded-card border transition-colors {dropBefore !== undefined
    ? 'border-accent ring-2 ring-accent/25'
    : page.dragging
      ? 'border-dashed border-line-strong'
      : 'border-pressed'} bg-surface"
>
  <!-- Collapsed, the footer's rule is enough under the header. -->
  <header class="flex items-center gap-2 py-2 pr-2 pl-4 {open ? 'border-b border-line' : ''}">
    <div class="flex min-h-10 min-w-0 flex-1 items-center gap-2 md:min-h-9">
      <!-- On phones the name is a button whose focus ring the heading mustn't clip, so the button truncates. -->
      <h3 id={headingId} class="min-w-0 text-heading-6 text-strong {page.compact ? 'flex' : 'truncate'}">
        {#if page.compact}
          <button
            type="button"
            onclick={() => page.toggleTerm(term)}
            aria-expanded={open}
            aria-controls={bodyId}
            class="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-tag px-1 text-left"
          >
            <ChevronDown
              aria-hidden="true"
              class="size-4 shrink-0 text-muted transition-transform {open ? '' : '-rotate-90'}"
            />
            <span class="truncate">{termLabel(term)}</span>
          </button>
        {:else}
          {termLabel(term)}
        {/if}
      </h3>
      {@render chips()}
    </div>
    {#if syncedSchedule}
      <button
        type="button"
        onclick={() => openSchedule(syncedSchedule.id)}
        title="Synced with {syncedSchedule.name}: this semester's courses come from that schedule, and changes here update it. Open it on the schedules page."
        class="inline-flex h-10 max-w-44 shrink-0 items-center gap-1 rounded-full border border-line-strong px-2.5 text-label-md text-ink hover:bg-hover md:h-7"
      >
        <RefreshCw aria-hidden="true" class="size-3 shrink-0 text-ok" />
        <span class="sr-only">Synced with</span>
        <span class="truncate max-sm:sr-only">{syncedSchedule.name}</span>
      </button>
    {/if}
    <span class="shrink-0 text-right leading-none">
      <span class="tabular text-heading-5 text-strong">{column.totals.units}</span>
      <span class="text-label-md font-normal text-muted"
        ><span class="max-sm:sr-only">{column.totals.hasVariable ? "units+" : "units"}</span><span
          aria-hidden="true"
          class="sm:hidden">{column.totals.hasVariable ? "u+" : "u"}</span
        ></span
      >
    </span>
    <OptionsMenu label="Options for {termLabel(term)}">
      {#snippet children(close)}
        {#if published && syncedSchedule}
          <MenuItem icon={Unlink} onclick={() => { close(); links.unlinkTerm(plan, term); }}>
            <span class="min-w-0 flex-1 truncate">Stop syncing with {syncedSchedule.name}</span>
          </MenuItem>
          <div role="separator" class="my-1.5 h-px bg-line"></div>
        {/if}
        {#if published && !syncedSchedule && termSchedules.length > 0}
          <MenuLabel>Sync with a schedule</MenuLabel>
          {#each termSchedules as s (s.id)}
            <MenuItem icon={RefreshCw} onclick={() => { close(); startSync(s); }}>
              <span class="min-w-0 flex-1 truncate">{s.name}</span>
              <span class="tabular text-label-md text-muted">{visibleCount(s)} courses</span>
            </MenuItem>
          {/each}
          <div role="separator" class="my-1.5 h-px bg-line"></div>
        {/if}
        {#if published && !syncedSchedule}
          <MenuLabel>
            {withCourses.length > 0 ? "Copy courses from a schedule" : "No schedules for this semester yet"}
          </MenuLabel>
          {#each withCourses as s (s.id)}
            <MenuItem
              icon={Copy}
              onclick={() => {
                close();
                if (column.planned.length > 0) pendingImport = s;
                else importSchedule(s);
              }}
            >
              <span class="min-w-0 flex-1 truncate">{s.name}</span>
              <span class="tabular text-label-md text-muted">{visibleCount(s)} courses</span>
            </MenuItem>
          {/each}
        {/if}
        {#if published}
          <MenuItem icon={CalendarDays} href={schedulesPath(term)} onclick={close}>
            Open the {termLabel(term)} schedule
          </MenuItem>
          <div role="separator" class="my-1.5 h-px bg-line"></div>
        {/if}
        <MenuItem
          icon={Trash2}
          danger
          disabled={column.fromRecordOnly}
          onclick={() => {
            close();
            if (column.planned.length > 0) confirmRemove = true;
            else plans.removeTerm(plan.id, term);
          }}
        >
          Remove semester
        </MenuItem>
      {/snippet}
    </OptionsMenu>
  </header>

  {#if synced?.missing && !syncedSchedule}
    <div role="status" class="flex flex-wrap items-center gap-2 border-b border-line bg-warn-bg px-4 py-1.5 text-label-md text-warn">
      <span class="min-w-0 flex-1">The synced schedule was deleted; showing your planned courses.</span>
      <button
        type="button"
        onclick={() => links.unlinkTerm(plan, term)}
        class="min-h-10 font-semibold text-ink underline underline-offset-2 md:min-h-7"
      >
        Stop syncing
      </button>
    </div>
  {/if}

  {#if open}
    <div id={bodyId} class="flex flex-1 flex-col gap-1 px-2 py-2">
      {#if empty}
        <p class="px-2 py-2 text-body-2 text-muted">
          {phase === "past" ? "Nothing recorded for this semester." : "Nothing planned yet."}
          {#if page.dragEnabled && phase !== "past"}Drag a course here, or add one below.{/if}
        </p>
      {/if}

      {#if table && !empty}
        <div class="data-table-scroll scrollbar-thin -mx-2">
          <table class="w-full min-w-[930px] table-fixed text-left text-body-2">
            <caption class="sr-only">{termLabel(term)} courses</caption>
            <colgroup>
              <col class="w-[92px]" />
              <col class="min-w-[180px]" />
              <!-- Wide enough for a variable-units course's 56px field and the cell's padding. -->
              <col class="w-[64px]" />
              <col class="w-[170px]" />
              <col class="w-[110px]" />
              <col class="w-[260px]" />
              <col class="w-[52px]" />
              <col class="w-[44px]" />
            </colgroup>
            <thead class="text-label-md text-muted">
              <tr>
                <th scope="col" class="sticky left-0 z-[1] bg-surface py-1.5 pr-2 pl-[26px] font-medium">Course</th>
                <th scope="col" class="py-1.5 pr-2 font-medium">Name</th>
                <th scope="col" class="py-1.5 pr-2 text-right font-medium">Units</th>
                <th scope="col" class="py-1.5 pr-2 font-medium">Satisfies</th>
                <th scope="col" class="py-1.5 pr-2 font-medium">Offered</th>
                <th scope="col" class="py-1.5 pr-2 font-medium">Prerequisites</th>
                <th scope="col" class="py-1.5 pr-2 text-right font-medium">FCE</th>
                <th scope="col" class="py-1.5"><span class="sr-only">Options</span></th>
              </tr>
            </thead>
            <tbody>
              {#each column.recorded as e (e.id)}
                <RecordCourseTableRow
                  entry={e}
                  units={column.recordUnits.get(e.id) ?? 0}
                  satisfies={e.courseId === null ? null : (requirements?.get(e.courseId, term) ?? null)}
                />
              {/each}
              {#each column.planned as c, i (c.id)}
                <PlanCourseTableRow
                  {...rowProps(c, i)}
                  satisfies={requirements?.get(c.courseId, term) ?? null}
                  freeElective={requirements?.free.has(c.courseId) === true}
                  {chipStatus}
                />
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if !table && column.recorded.length > 0}
        <ul aria-label="From your record" class="flex flex-col">
          {#each column.recorded as e (e.id)}
            <RecordCourseRow entry={e} units={column.recordUnits.get(e.id) ?? 0} />
          {/each}
        </ul>
      {/if}

      {#if column.alsoRecorded.length > 0}
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-label-md font-normal text-muted">
          <span>
            {column.alsoRecorded.length === 1
              ? "1 planned course is"
              : `${column.alsoRecorded.length} planned courses are`} already on your record for this semester{syncedSchedule
              ? ` (still in ${syncedSchedule.name})`
              : ""}.
          </span>
          {#if !syncedSchedule}
            <button
              type="button"
              class="min-h-10 font-semibold text-accent-ink hover:underline md:min-h-0"
              onclick={() => {
                for (const c of column.alsoRecorded) links.removeFromPlan(plan, c.id);
              }}
            >
              Remove from plan
            </button>
          {/if}
        </div>
      {/if}

      {#if !table && column.planned.length > 0}
        <ul aria-label="Planned" class="flex flex-col">
          {#each column.planned as c, i (c.id)}
            <PlanCourseRow {...rowProps(c, i)} />
          {/each}
        </ul>
      {/if}

      <div class="mt-auto pt-1">
        <AddCourseInput
          {term}
          catalog={page.catalog}
          termDocs={page.routed?.searchDocs ?? []}
          {scheduled}
          {inPlan}
          onadd={(id) => links.addToTerm(plan, term, id)}
        />
      </div>
    </div>
  {/if}

  {#if column.totals.count > 0}
    <TermTotals totals={column.totals} {flags} />
  {/if}
</section>

<Dialog
  open={pendingImport !== null}
  onclose={() => (pendingImport = null)}
  title="Replace planned courses"
  size="sm"
>
  <p class="text-body-2 text-ink">
    Replace the {column.planned.length} course{column.planned.length === 1 ? "" : "s"} planned for {termLabel(term)} with
    the {pendingImport ? visibleCount(pendingImport) : 0} in {pendingImport?.name}?
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (pendingImport = null)}>Cancel</Button>
    <Button variant="primary" onclick={() => pendingImport && importSchedule(pendingImport)}>Replace courses</Button>
  {/snippet}
</Dialog>

<Dialog
  open={pendingLink !== null}
  onclose={() => (pendingLink = null)}
  title="Sync {termLabel(term)} with a schedule"
>
  {#if pendingLink}
    {@const n = pendingLink.missing.length}
    <p class="text-body-2 text-ink">
      {n} course{n === 1 ? "" : "s"} planned for {termLabel(term)}
      {n === 1 ? "isn't" : "aren't"} in {pendingLink.schedule.name}:
      <span class="tabular font-semibold text-strong">{pendingLink.missing.map((c) => codeOf(c.courseId)).join(", ")}</span>.
    </p>
    <p class="mt-2 text-body-2 text-muted">
      Once synced, this semester shows the schedule's courses, and changes in either place update both.
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (pendingLink = null)}>Cancel</Button>
    <Button
      onclick={() => {
        if (pendingLink) links.linkTermToSchedule(plan, term, pendingLink.schedule, "as-is");
        pendingLink = null;
      }}
    >
      Use the schedule as is
    </Button>
    <Button
      variant="primary"
      onclick={() => {
        if (pendingLink) links.linkTermToSchedule(plan, term, pendingLink.schedule, "merge");
        pendingLink = null;
      }}
    >
      Add {pendingLink?.missing.length === 1 ? "it" : `these ${pendingLink?.missing.length ?? 0}`} to the schedule
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmRemove} title="Remove semester" size="sm">
  <p class="text-body-2 text-ink">
    Remove {termLabel(term)} and the {column.planned.length} course{column.planned.length === 1 ? "" : "s"} planned in it?
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmRemove = false)}>Cancel</Button>
    <Button
      variant="danger"
      icon={Trash2}
      onclick={() => {
        plans.removeTerm(plan.id, term);
        confirmRemove = false;
      }}
    >
      Remove semester
    </Button>
  {/snippet}
</Dialog>

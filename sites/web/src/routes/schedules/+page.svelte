<script lang="ts">
  import { CalendarClock, CalendarDays, Info, ListPlus, LogIn, RotateCw, WandSparkles } from "@lucide/svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import WeekGrid from "$lib/components/calendar/WeekGrid.svelte";
  import PageToolbar from "$lib/components/layout/PageToolbar.svelte";
  import RailGroup from "$lib/components/layout/RailGroup.svelte";
  import RailLayout from "$lib/components/layout/RailLayout.svelte";
  import Title from "$lib/components/shell/Title.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { session } from "$lib/data";
  import { childForSection, initialChoice, partLabel } from "$lib/core/planner/format";
  import { coursesPath } from "$lib/core/routes";
  import { childSections, topSections } from "$lib/core/sections";
  import { buildScheduleView } from "$lib/core/state/schedule-view";
  import type { SectionChoice } from "$lib/core/state/store";
  import type { Course } from "$lib/core/types";
  import { personal, schedules } from "$lib/state";
  import type { FriendSchedule } from "$lib/api/types";
  import FinalsDialog from "$lib/features/finals/FinalsDialog.svelte";
  import AddCourseSearch from "$lib/features/schedules/AddCourseSearch.svelte";
  import CopyField from "$lib/components/ui/CopyField.svelte";
  import CourseEntryRow from "$lib/features/schedules/CourseEntryRow.svelte";
  import DisplayMenu from "$lib/features/schedules/DisplayMenu.svelte";
  import ExportMenu from "$lib/features/schedules/ExportMenu.svelte";
  import FriendOverlay from "$lib/features/schedules/FriendOverlay.svelte";
  import ImportLinkDialog from "$lib/features/schedules/ImportLinkDialog.svelte";
  import {
    overlayBlocks,
    plannerBlocks,
    tbaItems,
    type CalendarSelection,
    type Preview,
  } from "$lib/features/schedules/planner";
  import ScheduleRequisiteSummary from "$lib/features/schedules/ScheduleRequisiteSummary.svelte";
  import SavedCourses from "$lib/features/schedules/SavedCourses.svelte";
  import ScheduleGenerator from "$lib/features/schedules/ScheduleGenerator.svelte";
  import ScheduleTabs from "$lib/features/schedules/ScheduleTabs.svelte";
  import ScheduleWorkload from "$lib/features/schedules/ScheduleWorkload.svelte";
  import SendToStellicDialog from "$lib/components/stellic/SendToStellicDialog.svelte";
  import ShareDialog from "$lib/features/schedules/ShareDialog.svelte";
  import { pageTerm } from "$lib/features/schedules/term-page.svelte";
  import WorkloadTotals from "$lib/features/schedules/WorkloadTotals.svelte";

  const t = pageTerm();
  const termId = $derived(t.termId);
  const term = $derived(t.current);
  const signedIn = $derived(session.status === "signed-in");
  const loadingAccount = $derived(personal.mode === "loading");
  const active = $derived(termId === null ? null : schedules.active(termId));
  const activeId = $derived(active?.id ?? null);
  const view = $derived(term === null ? null : buildScheduleView(active, term));

  let selected = $state<CalendarSelection | null>(null);
  let preview = $state<Preview | null>(null);
  let miniChoice = $state<number | null>(null);
  let overlay = $state<{ owner: string; schedule: FriendSchedule } | null>(null);
  let shareOpen = $state(false);
  let generatorOpen = $state(false);
  let sendOpen = $state(false);
  let copyText = $state<{ title: string; text: string } | null>(null);
  let copyOpen = $state(false);

  // Wide desktops have room for the session switch in the toolbar row; narrower screens show it above the calendar.
  const wideToolbar = new MediaQuery("(min-width: 80rem)");
  const courseCount = $derived(view?.entries.length ?? 0);

  // `?schedule=<id>` (links from the profile and shared schedules) shows that schedule.
  $effect(() => {
    const wanted = page.url.searchParams.get("schedule");
    if (wanted === null || termId === null || loadingAccount) return;
    if (schedules.get(wanted)?.termId === termId) schedules.setActiveSchedule(termId, wanted);
    const url = new URL(page.url);
    url.searchParams.delete("schedule");
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  });

  // Switching schedules or semesters drops the selection and preview of the previous one.
  $effect(() => {
    void activeId;
    void termId;
    selected = null;
    preview = null;
  });

  // Escape clears the calendar selection (popovers handle their own Escape first).
  $effect(() => {
    if (selected === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) selected = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** The shown schedule's id; a semester without one gets one on its first edit. */
  function target(): string {
    if (termId === null) throw new Error("The semester hasn't loaded.");
    return activeId ?? schedules.ensureSchedule(termId);
  }

  function add(course: Course): void {
    if (view === null) return;
    const choice = initialChoice(course, view);
    schedules.addCourse(target(), course.id, choice.section, choice.child);
  }

  function switchSection(courseId: string, name: string): void {
    const course = term?.courseById.get(courseId);
    if (course === undefined || view === null) return;
    schedules.setSection(target(), courseId, name, childForSection(course, name, view));
  }

  // The session toggle matters only when a placed course runs in one mini.
  const hasMinis = $derived(view?.placed.some((e) => e.parts.some((p) => p.mini !== null)) ?? false);
  const showSessions = $derived(hasMinis && (term?.meta.minis.length ?? 0) > 0);
  const mini = $derived(hasMinis ? miniChoice : null);

  const blocks = $derived.by(() => {
    if (view === null || term === null) return [];
    const own = plannerBlocks(view, term, {
      selected,
      preview,
      mini,
      on: {
        select: (s) => (selected = s),
        switchSection,
        switchChild: (courseId, name) => schedules.setChild(target(), courseId, name),
      },
    });
    if (overlay === null || overlay.schedule.termId !== term.meta.id) return own;
    return [...overlayBlocks(overlay.schedule, term, overlay.owner, mini), ...own];
  });

  const selectedEntry = $derived(
    selected === null || view === null
      ? undefined
      : view.entries.find((e) => e.course.id === selected?.courseId && !e.entry.hidden),
  );
  const unplaced = $derived(view?.entries.filter((e) => !e.entry.hidden && e.section === null).length ?? 0);

  // `?finals=1` opens the final exams dialog for the shown schedule, so it can be linked to.
  const finalsOpen = $derived(page.url.searchParams.get("finals") === "1");

  function setFinals(open: boolean): void {
    if (open === finalsOpen) return;
    const url = new URL(page.url);
    if (open) url.searchParams.set("finals", "1");
    else url.searchParams.delete("finals");
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function applySections(sections: Record<string, SectionChoice>): void {
    schedules.setSections(target(), sections);
  }

  function saveAsNew(name: string, sections: Record<string, SectionChoice>): void {
    if (active === null || termId === null) return;
    schedules.createSchedule(
      termId,
      name,
      active.entries.map((e) => Object.assign(structuredClone(e), sections[e.courseId])),
    );
  }

  function bannerText(): string {
    if (selected === null || selectedEntry === undefined) return "";
    const { course, section, child } = selectedEntry;
    if (selected.level === "child" && section !== null) {
      const others = childSections(course, section.name).length - (child === null ? 0 : 1);
      return others > 0
        ? `Showing other recitations of ${course.code} ${partLabel(section)} as outlines. Select one to switch.`
        : `${course.code} ${partLabel(section)} has only one recitation.`;
    }
    const tops = topSections(course);
    const noun = tops.every((s) => s.kind === "lecture") ? "lecture" : "section";
    return tops.length > 1
      ? `Showing other ${noun}s of ${course.code} as outlines. Select one to switch${child === null ? "" : "; a recitation that fits comes with it"}.`
      : `${course.code} has only one ${noun}.`;
  }
</script>

<Title value="Schedules" />

{#snippet sessions()}
  {#if term}
    <SegmentedControl
      label="Session"
      value={mini === null ? "all" : String(mini)}
      onchange={(value) => (miniChoice = value === "all" ? null : Number(value))}
      options={[
        { value: "all", label: "Full semester" },
        ...term.meta.minis.map((m) => ({ value: String(m.number), label: m.name })),
      ]}
      class="self-start"
    />
  {/if}
{/snippet}

<ImportLinkDialog {term} onswitch={(id) => t.set(id)} />

{#snippet totalsFooter()}
  {#if view && term}<WorkloadTotals {view} {term} variant="footer" />{/if}
{/snippet}

<RailLayout
  title="Schedule"
  name="schedule panel"
  sheetLabel="Courses"
  sheetButtonLabel={courseCount > 0 ? `Courses (${courseCount})` : "Add courses"}
  sheetIcon={ListPlus}
  backLabel="Schedule"
  storageKey="schedules"
  filterCount={courseCount}
  railFooter={view && term && !loadingAccount && view.entries.length > 0 ? totalsFooter : undefined}
>
  {#snippet rail()}
    <RailGroup>
      {#if t.terms.value}
        <Select
          value={termId ?? ""}
          label="Semester"
          hideLabel={false}
          options={t.terms.value.map((x) => ({ value: x.id, label: x.name }))}
          onchange={(event) => t.set(event.currentTarget.value)}
        />
      {:else}
        <Skeleton variant="block" class="h-16" />
      {/if}
    </RailGroup>

    <RailGroup title="Courses" count={view && !loadingAccount && courseCount > 0 ? courseCount : undefined}>
      <!-- The search adds to the list under it, so the two sit closer than the rail's groups. -->
      <div class="flex flex-col gap-3">
        {#if session.status === "signed-out"}
          <p class="text-body-2 text-muted">
            <button type="button" class="text-accent-ink underline underline-offset-2" onclick={() => session.signIn()}
              >Sign in</button
            > to see rooms, instructors and hours a week.
          </p>
        {/if}
        {#if view && term && termId && !loadingAccount}
          <AddCourseSearch
            {term}
            {view}
            onadd={add}
            onpreview={(id) => (preview = id === null ? null : { courseId: id, sections: null })}
          />
          {#if view.entries.length > 0}
            <ul class="-mx-2.5 flex flex-col gap-1" aria-label="Courses in this schedule">
              {#each view.entries as resolved, i (resolved.course.id)}
                {@const id = resolved.course.id}
                <CourseEntryRow
                  {resolved}
                  {view}
                  {termId}
                  first={i === 0}
                  last={i === view.entries.length - 1}
                  selected={selected?.courseId === id}
                  onselect={() => (selected = selected?.courseId === id ? null : { courseId: id, level: "section" })}
                  onsection={(name) => switchSection(id, name)}
                  onchild={(name) => schedules.setChild(target(), id, name)}
                  onpick={(name, child) => schedules.setSection(target(), id, name, child)}
                  oncolor={(c) => schedules.setColor(target(), id, c)}
                  onpassfail={(p) => schedules.setPassFail(target(), id, p)}
                  ontogglehidden={() => schedules.toggleHidden(target(), id)}
                  onremove={() => schedules.removeCourse(target(), id)}
                  onmove={(d) => schedules.moveEntry(target(), id, view.entries[i + (d === 1 ? 2 : -1)]?.course.id ?? null)}
                  onpreview={(sections) => (preview = sections === null ? null : { courseId: id, sections })}
                />
              {/each}
            </ul>
          {:else}
            <p class="text-body-2 text-muted">
              Courses you add show up here, with their sections and any time conflicts.
            </p>
          {/if}
        {:else}
          <Skeleton variant="text" lines={3} />
        {/if}
      </div>
    </RailGroup>

    {#if view && term}
      <RailGroup title="Saved courses">
        <SavedCourses
          {term}
          {view}
          onadd={add}
          onpreview={(id) => (preview = id === null ? null : { courseId: id, sections: null })}
        />
      </RailGroup>
      {#if view.entries.length > 0}
        <RailGroup title="Requisites">
          <ScheduleRequisiteSummary entries={view.entries} {term} />
        </RailGroup>
      {/if}
      <RailGroup title="Workload">
        <ScheduleWorkload entries={view.entries} {term} />
      </RailGroup>
      {#if signedIn && termId}
        <RailGroup title="Compare with a friend">
          <FriendOverlay {termId} termName={term.meta.name} onchange={(value) => (overlay = value)} />
        </RailGroup>
      {/if}
    {/if}
  {/snippet}

  {#snippet header()}
    {#if term && view}
      <h1 class="sr-only">Schedules: {active?.name ?? "Schedule 1"}, {term.meta.name}</h1>
      <ScheduleTabs {term} {activeId} onshare={() => (shareOpen = true)} ontarget={target} />
      <PageToolbar class="mt-1" actionsLayout="inline" chips={wideToolbar.current && showSessions ? sessions : undefined}>
        {#snippet actions()}
          <!-- Phones show these as icon buttons; the names stay for screen readers. -->
          <Button
            icon={WandSparkles}
            class="h-10 max-sm:w-10 max-sm:px-0 lg:h-9"
            title="Generate schedules"
            disabled={view.entries.length === 0}
            onclick={() => (generatorOpen = true)}><span class="max-sm:sr-only">Generate</span></Button
          >
          <Button
            icon={CalendarClock}
            class="h-10 max-sm:w-10 max-sm:px-0 lg:h-9"
            title="Final exams"
            onclick={() => setFinals(true)}><span class="max-sm:sr-only">Finals</span></Button
          >
          {#if active}
            <ExportMenu
              schedule={active}
              {view}
              {term}
              onshare={() => (shareOpen = true)}
              onsend={() => (sendOpen = true)}
              oncopyfallback={(text, title) => {
                copyText = { text, title };
                copyOpen = true;
              }}
            />
          {/if}
          <DisplayMenu />
        {/snippet}
        <WorkloadTotals {view} {term} variant="compact" class="mt-3 lg:hidden" />
      </PageToolbar>
    {:else}
      <Skeleton variant="block" class="h-10 w-64" />
      <Skeleton variant="block" class="mt-4 h-12" />
    {/if}
  {/snippet}

  <div class="flex flex-col gap-4">
    {#if personal.mode === "draft" && session.status === "signed-out"}
      <div class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-warn-bg px-4 py-3" role="note">
        <Info aria-hidden="true" class="size-5 shrink-0 text-warn" />
        <p class="min-w-0 flex-1 text-body-2 text-ink">
          <strong class="font-semibold">Not saved.</strong> You're signed out, so this schedule is kept in this tab only.
          Sign in to save it to your account.
        </p>
        <Button size="sm" variant="primary" icon={LogIn} onclick={() => session.signIn()}>Sign in</Button>
      </div>
    {:else if personal.status === "error" || personal.status === "offline"}
      <div class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-danger-bg px-4 py-3" role="alert">
        <p class="min-w-0 flex-1 text-body-2 text-ink">
          {personal.status === "offline"
            ? "You're offline. Your changes are kept here and saved when you're back online."
            : (personal.error ?? "Couldn't save your changes.")}
        </p>
        <Button size="sm" icon={RotateCw} onclick={() => personal.retry()}>Retry</Button>
      </div>
    {/if}

    {#if t.terms.status === "error" || t.term.status === "error"}
      <EmptyState
        icon={CalendarDays}
        title="Couldn't load the semester"
        description="Check your connection and reload the page. {t.term.error ?? t.terms.error ?? ''}"
      />
    {:else if term === null || view === null || loadingAccount}
      <div class="flex justify-center py-16"><Spinner size="lg" label="Loading your schedule" /></div>
    {:else}
      {#if term.meta.notes?.length}
        <div class="flex gap-2 rounded-card border border-line bg-surface px-4 py-3 text-body-2 text-ink">
          <Info aria-hidden="true" class="mt-0.5 size-4 shrink-0 text-muted" />
          <div class="flex flex-col gap-0.5">
            {#each term.meta.notes as note (note)}<p>{note}</p>{/each}
          </div>
        </div>
      {/if}

      {#if showSessions && !wideToolbar.current}
        {@render sessions()}
      {/if}

      {#if selected && selectedEntry}
        <div
          role="status"
          class="flex items-center gap-3 rounded-card border border-line-strong bg-surface px-4 py-2 text-body-2 text-ink"
        >
          <p class="min-w-0 flex-1">{bannerText()}</p>
          <Button size="sm" variant="ghost" onclick={() => (selected = null)}>Done</Button>
        </div>
      {/if}

      <!-- Clicking empty calendar space clears the selection, as Escape does. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="rounded-card border border-line bg-surface p-2 sm:p-3"
        onclick={(event) => {
          if (selected !== null && !(event.target as HTMLElement).closest("button")) selected = null;
        }}
      >
        <WeekGrid {blocks} tba={tbaItems(view, term.meta.id)} label="{active?.name ?? 'Schedule'} calendar">
          {#snippet empty()}
            {#if view.entries.length === 0}
              <div class="max-w-xs rounded-card border border-line bg-surface px-5 py-4 text-center shadow-popover">
                <p class="text-heading-6 text-strong">Nothing scheduled yet</p>
                <p class="mt-1 text-body-2 text-ink">
                  <span class="max-lg:hidden">Add one with the search under Courses,</span>
                  <span class="lg:hidden">Tap Add courses to search for one,</span>
                  or <a href={coursesPath(term.meta.id)} class="text-accent-ink underline">browse all courses</a>.
                </p>
              </div>
            {:else if unplaced > 0}
              <p class="max-w-xs rounded-card border border-line bg-surface px-5 py-4 text-center text-body-2 text-ink">
                Choose a section for each course to place it on the calendar.
              </p>
            {/if}
          {/snippet}
        </WeekGrid>
      </div>

      {#if overlay}
        <p class="text-label-md font-normal text-muted" aria-live="polite">
          Showing {overlay.owner}'s &ldquo;{overlay.schedule.name}&rdquo; as striped blocks.
        </p>
      {/if}

    {/if}
  </div>
</RailLayout>

{#if term && view}
  {#if active}
    <ShareDialog bind:open={shareOpen} schedule={active} termName={term.meta.name} />
  {:else if shareOpen}
    <Dialog bind:open={shareOpen} title="Share schedule" size="sm">
      <p class="text-body-2 text-ink">Add a course first, then share the schedule.</p>
    </Dialog>
  {/if}
  <FinalsDialog
    bind:open={() => finalsOpen, (value) => setFinals(value)}
    {term}
    entries={view.entries}
    scheduleName={active?.name ?? "Schedule 1"}
  />
  <ScheduleGenerator
    bind:open={generatorOpen}
    {view}
    {term}
    name={active?.name ?? "Schedule"}
    onapply={applySections}
    onsaveasnew={saveAsNew}
  />
{/if}
<SendToStellicDialog bind:open={sendOpen} mode="schedules" initialId={activeId ?? undefined} />
<Dialog bind:open={copyOpen} title={copyText?.title ?? "Copy"} size="md">
  {#if copyText}
    <CopyField value={copyText.text} label="Your browser blocked copying. Copy the text yourself." rows={8} />
  {/if}
</Dialog>

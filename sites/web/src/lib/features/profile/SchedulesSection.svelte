<!--
  The profile's Schedules section (Figma "Profile Page (Schedule)"): every schedule, newest semester first, filtered by
  semester, in one of two views. Preview groups them under their semesters as miniature weeks (SchedulePreviewCard);
  Details is the Figma's cards with the semester, units, expected hours a week and courses. Each card opens the
  schedule.
-->
<script lang="ts">
  import { CalendarDays, CalendarPlus, Clock, ExternalLink, Layers, LayoutList, Users } from "@lucide/svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { profileBand } from "$lib/components/layout/profile-band.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import CourseChip from "$lib/components/ui/CourseChip.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import ViewToggle, { storedViewOf, type ViewOption } from "$lib/components/ui/ViewToggle.svelte";
  import { catalog, resource } from "$lib/data";
  import type { Term } from "$lib/core/data";
  import { formatHours } from "$lib/core/fce";
  import { scheduleLoad } from "$lib/core/fce/workload";
  import { scheduleUnits } from "$lib/core/planner/format";
  import { codeOf } from "$lib/core/requisite-format";
  import { termLabel, termOrdinal } from "$lib/core/requisites";
  import { coursePath, schedulesPath } from "$lib/core/routes";
  import { resolveEntries } from "$lib/core/state/schedule-view";
  import { personal, schedules, type ScheduleItem } from "$lib/state";
  import SchedulePreviewCard from "./SchedulePreviewCard.svelte";
  import { bySemester } from "./schedule-previews";

  let { title }: { title: string } = $props();

  type SchedulesView = "preview" | "details";
  const VIEW_KEY = "profile-schedules";
  const VIEWS: readonly ViewOption<SchedulesView>[] = [
    { value: "preview", label: "Preview", icon: CalendarDays },
    { value: "details", label: "Details", icon: LayoutList },
  ];

  let semester = $state("");
  let view = $state<SchedulesView>(storedViewOf(VIEW_KEY, ["preview", "details"]) ?? "preview");
  // Phones get the taller field select (40px tap targets); wider screens the Figma's compact filter box.
  const wide = new MediaQuery("(min-width: 40rem)");

  // The semester filter, the count and the view switch sit in the section's title band.
  profileBand(() => ({ filters: all.length > 0 ? schedulesFilters : undefined }));

  const all = $derived(
    Object.values(schedules.items).toSorted(
      (a, b) => (termOrdinal(b.termId) ?? 0) - (termOrdinal(a.termId) ?? 0) || b.updatedAt - a.updatedAt,
    ),
  );
  const termIds = $derived([...new Set(all.map((s) => s.termId))]);
  const shown = $derived(semester === "" ? all : all.filter((s) => s.termId === semester));
  const groups = $derived(bySemester(shown));

  // Each semester's courses, for the previews, units and hours; a semester the catalog no longer has is left out.
  const terms = resource(async () => {
    const results = await Promise.allSettled(termIds.map((id) => catalog.term(id)));
    const out = new Map<string, Term>();
    for (const r of results) if (r.status === "fulfilled") out.set(r.value.meta.id, r.value);
    return out;
  });
  const fce = resource(() => catalog.fceSummary());

  function hours(s: ScheduleItem, term: Term | undefined): string | null {
    const summary = fce.value;
    if (term === undefined || summary === undefined || summary === null) return null;
    const load = scheduleLoad(resolveEntries(s, term), term.meta.minis, summary.courses);
    const peak = load.halves && load.peak !== null ? load.halves[load.peak] : null;
    return formatHours(peak ? peak.load.hours : load.total);
  }
</script>

{#snippet schedulesFilters()}
  <div class="flex w-full flex-wrap items-center gap-3">
    {#if termIds.length > 1}
      <Select
        bind:value={semester}
        label="Semester"
        variant={wide.current ? "compact" : "field"}
        class="w-full sm:w-48"
        options={[{ value: "", label: "All semesters" }, ...termIds.map((id) => ({ value: id, label: termLabel(id) }))]}
      />
    {/if}
    <div class="flex flex-1 items-center justify-between gap-3 sm:justify-end">
      <p class="text-label-md text-muted" aria-live="polite">
        {shown.length === all.length
          ? `${all.length} ${all.length === 1 ? "schedule" : "schedules"}`
          : `${shown.length} of ${all.length} schedules`}
      </p>
      <ViewToggle pageKey={VIEW_KEY} options={VIEWS} bind:value={view} />
    </div>
  </div>
{/snippet}

<div class="flex flex-col gap-6">
  {#if personal.mode === "loading"}
    {#if view === "preview"}
      <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton variant="block" class="aspect-[4/3]" />
        <Skeleton variant="block" class="aspect-[4/3] max-sm:hidden" />
      </div>
    {:else}
      <div class="grid gap-6 xl:grid-cols-2">
        <Skeleton variant="block" class="h-40" />
        <Skeleton variant="block" class="h-40" />
      </div>
    {/if}
  {:else if all.length === 0}
    <EmptyState
      icon={CalendarPlus}
      title="No schedules yet"
      description="Plan a semester on the schedules page: pick courses and sections, and they show up here."
    >
      <Button variant="primary" href={schedulesPath()}>Make a schedule</Button>
    </EmptyState>
  {:else if view === "preview"}
    {#each groups as group (group.termId)}
      {@const name = terms.value?.get(group.termId)?.meta.name ?? termLabel(group.termId)}
      <section aria-labelledby="schedules-{group.termId}" class="flex flex-col gap-4">
        <h2 id="schedules-{group.termId}" class="flex items-center gap-3 text-heading-5 text-accent-ink">
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
            <CalendarDays aria-hidden="true" class="size-5" />
          </span>
          {name}
        </h2>
        <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          {#each group.schedules as s (s.id)}
            {@const term = terms.value?.get(s.termId)}
            <li>
              <SchedulePreviewCard
                schedule={s}
                {term}
                semester={name}
                loading={terms.status === "loading"}
                units={term ? scheduleUnits(s, term) : null}
                hours={hours(s, term)}
              />
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {:else}
    <ul class="grid gap-6 xl:grid-cols-2" aria-label={title}>
      {#each shown as s (s.id)}
        {@const term = terms.value?.get(s.termId)}
        {@const visible = s.entries.filter((e) => !e.hidden)}
        {@const perWeek = hours(s, term)}
        <li>
          <Card padding="none" class="relative flex h-full flex-col gap-3 px-5 py-6">
            <div class="flex items-start justify-between gap-3">
              <h3 class="min-w-0 text-heading-6 text-strong">
                <a href={schedulesPath(s.termId, s.id)} class="hover:underline">{s.name}</a>
              </h3>
              <a
                href={schedulesPath(s.termId, s.id)}
                aria-label="Open {s.name}"
                title="Open schedule"
                class="-mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-hover"
              >
                <ExternalLink aria-hidden="true" class="size-5" />
              </a>
            </div>
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-1 text-ink">
              <span class="text-muted">{term?.meta.name ?? termLabel(s.termId)}</span>
              {#if term}
                <span class="inline-flex items-center gap-1.5">
                  <Layers aria-hidden="true" class="size-5" />{scheduleUnits(s, term)} units
                </span>
              {:else if terms.status === "loading"}
                <span class="text-muted">&hellip;</span>
              {/if}
              {#if perWeek !== null}
                <span aria-hidden="true" class="hidden h-5 w-px bg-line-strong sm:block"></span>
                <span class="inline-flex items-center gap-1.5">
                  <Clock aria-hidden="true" class="size-5" />{perWeek} hrs/week
                </span>
              {/if}
              {#if s.visibility === "friends"}
                <span class="inline-flex items-center gap-1 text-label-md text-muted" title="Friends can see it">
                  <Users aria-hidden="true" class="size-4" />Friends
                </span>
              {/if}
            </p>
            {#if visible.length > 0}
              <ul class="flex flex-wrap gap-2" aria-label="Courses in {s.name}">
                {#each visible as e (e.courseId)}
                  <li><CourseChip code={codeOf(e.courseId)} href={coursePath(e.courseId, s.termId)} /></li>
                {/each}
              </ul>
            {:else}
              <p class="text-body-2 text-muted">No courses yet.</p>
            {/if}
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</div>

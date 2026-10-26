<script lang="ts">
  import { goto } from "$app/navigation";
  import WeekGrid from "$lib/components/calendar/WeekGrid.svelte";
  import type { TbaItem } from "$lib/components/calendar/types";
  import StatBox from "$lib/components/ui/StatBox.svelte";
  import { NO_VALUE } from "$lib/components/course/fce-format";
  import { isUnscheduled, sectionBlocks, sectionLabel } from "$lib/core/blocks";
  import { hashColor } from "$lib/core/colors";
  import { instructorSlug, type Instructor, type Term } from "$lib/core/data";
  import { coInstructors, taughtSections, weeklyHours } from "$lib/core/instructors/instructorData";
  import { coursePath, instructorPath } from "$lib/core/routes";
  import { formatDays, formatLocation, formatTimeRange, formatUnits } from "$lib/core/time";
  import type { Meeting } from "$lib/core/types";
  import type { CalendarBlock } from "$lib/core/week-grid";

  let { inst, term }: { inst: Instructor; term: Term } = $props();

  const termId = $derived(term.meta.id);
  const taught = $derived(taughtSections(inst, term));
  const hours = $derived(weeklyHours(taught.map((t) => t.section), term));
  const partners = $derived(coInstructors(inst, taught));
  const scheduled = $derived(taught.filter((t) => !isUnscheduled(t.section)).length);
  const slugByName = $derived(new Map(term.instructors.map((i) => [i.name, i.slug])));
  // Courseweave's weekly timetable: every section they teach, a color per course; a class opens its course.
  const blocks = $derived(
    taught.flatMap(({ course, section }): CalendarBlock[] =>
      sectionBlocks(course, section, hashColor(course.id), {
        onClick: () => void goto(coursePath(course.id, termId)),
        tooltip: `${course.code} ${section.title ?? course.title}, ${sectionLabel(section)}. Select to open the course.`,
      }),
    ),
  );
  const tba = $derived(
    taught
      .filter(({ section }) => isUnscheduled(section))
      .map(({ course, section }): TbaItem => ({
        key: `${course.id}-${section.name}`,
        label: course.code,
        title: section.title ?? course.title,
        detail: sectionLabel(section),
        color: hashColor(course.id),
        href: coursePath(course.id, termId),
      })),
  );

  function partnerHref(name: string): string {
    return instructorPath(slugByName.get(name) ?? instructorSlug(name), termId);
  }

  function miniName(number: number | null): string | null {
    if (number === null) return null;
    return term.meta.minis.find((mini) => mini.number === number)?.name ?? `Mini ${number}`;
  }

  function meets(meeting: Meeting): string {
    return meeting.days.length > 0
      ? `${formatDays(meeting.days)} ${formatTimeRange(meeting.start, meeting.end)}`
      : "Time to be announced";
  }
</script>

<section aria-labelledby="teaching-heading" class="flex flex-col gap-4">
  <h2 id="teaching-heading" class="text-heading-5 text-strong">Teaching in {term.meta.name}</h2>
  <div class="grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
    <StatBox label="Courses" value={inst.courseIds.length} />
    <StatBox label="Sections" value={inst.sectionCount} />
    <div
      title="Scheduled class time in the busiest week, counting overlapping cross-listed sections once"
      class="grid"
    >
      <StatBox
        label="Class hrs/wk"
        value={hours > 0 ? (Number.isInteger(hours) ? hours : hours.toFixed(1)) : NO_VALUE}
      />
    </div>
  </div>

  <!-- Phones: one block per section. -->
  <ul class="flex flex-col divide-y divide-line rounded-card border border-pressed bg-surface md:hidden">
    {#each taught as { course, section } (`${course.id}-${section.name}`)}
      {@const others = section.instructors.filter((name) => name !== inst.name)}
      <li class="px-4 py-3 text-body-2">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <a href={coursePath(course.id, termId)} class="text-heading-6 text-ink hover:text-accent-ink hover:underline"
            >{course.code}</a
          >
          <span class="text-ink">{sectionLabel(section)}</span>
          {#if miniName(section.mini)}<span class="text-label-md font-normal text-muted">{miniName(section.mini)}</span>{/if}
        </div>
        <p class="text-ink">{section.title ?? course.title}</p>
        {#each section.meetings as meeting, index (index)}
          <p class="tabular text-muted">{meets(meeting)}, {formatLocation(meeting)}</p>
        {/each}
        {#if others.length > 0}
          <p class="mt-0.5 text-label-md font-normal text-muted">
            With {#each others as name, index (name)}{index > 0 ? ", " : ""}<a
                href={partnerHref(name)}
                class="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent-ink"
                >{name}</a
              >{/each}
          </p>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- Wider screens: a table. -->
  <div class="hidden md:block">
    <div class="data-table-scroll rounded-card border border-pressed bg-surface">
      <table class="data-table-outline data-table-card">
        <caption class="sr-only">Sections {inst.name} teaches in {term.meta.name}</caption>
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Title</th>
            <th scope="col">Section</th>
            <th scope="col">Meets</th>
            <th scope="col">Where</th>
            <th scope="col">Co-instructors</th>
          </tr>
        </thead>
        <tbody>
          {#each taught as { course, section } (`${course.id}-${section.name}`)}
            {@const others = section.instructors.filter((name) => name !== inst.name)}
            <tr class="align-top">
              <td class="whitespace-nowrap"><a href={coursePath(course.id, termId)}>{course.code}</a></td>
              <td>
                <div>{section.title ?? course.title}</div>
                {#if section.title}<div class="text-label-md font-normal text-muted">{course.title}</div>{/if}
                <div class="text-label-md font-normal text-muted">{formatUnits(course.units)} units</div>
              </td>
              <td class="whitespace-nowrap">
                <div>{sectionLabel(section)}</div>
                {#if miniName(section.mini)}<div class="text-label-md font-normal text-muted">{miniName(section.mini)}</div>{/if}
              </td>
              <td class="tabular whitespace-nowrap">
                {#each section.meetings as meeting, index (index)}<div>{meets(meeting)}</div>{/each}
              </td>
              <td class="whitespace-nowrap">
                {#each section.meetings as meeting, index (index)}<div>{formatLocation(meeting)}</div>{/each}
              </td>
              <td>
                {#if others.length > 0}
                  <ul>
                    {#each others as name (name)}
                      <li><a href={partnerHref(name)}>{name}</a></li>
                    {/each}
                  </ul>
                {:else}
                  <span class="text-muted">None</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section aria-labelledby="timetable-heading" class="flex flex-col gap-2">
  <h2 id="timetable-heading" class="text-heading-5 text-strong">Weekly timetable</h2>
  {#if scheduled === 0}
    <p class="text-body-2 text-muted">None of these sections has a scheduled meeting time yet.</p>
  {:else}
    <p class="text-body-2 text-muted">Select a class to open the course.</p>
    <div class="rounded-card border border-pressed bg-surface p-2 sm:p-3">
      <WeekGrid
        {blocks}
        {tba}
        hourHeight={44}
        label="{inst.name}'s classes in {term.meta.name}"
        tbaDescription=""
      />
    </div>
  {/if}
</section>

{#if partners.length > 0}
  <section aria-labelledby="partners-heading" class="flex flex-col gap-3">
    <h2 id="partners-heading" class="text-heading-5 text-strong">Teaches with</h2>
    <ul class="grid gap-x-6 {partners.length > 1 ? 'sm:grid-cols-2' : ''}">
      {#each partners as partner (partner.name)}
        <li class="flex min-h-11 items-center justify-between gap-3 border-b border-line py-1.5">
          <a
            href={partnerHref(partner.name)}
            class="truncate text-body-1 font-medium text-ink hover:text-accent-ink hover:underline">{partner.name}</a
          >
          <span class="flex shrink-0 gap-2">
            {#each partner.courseIds as id (id)}
              {@const course = term.courseById.get(id)}
              {#if course}
                <a href={coursePath(course.id, termId)} class="text-label-md text-muted hover:text-accent-ink">{course.code}</a>
              {/if}
            {/each}
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

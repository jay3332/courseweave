<!--
  Schedule generator (Courseweave's ScheduleGenerator): every conflict-free arrangement of the schedule's sections,
  ranked by the student's preferences (start and end times, days off, gaps, lunch, fewer days on campus). Courses
  can be left out or locked to their current sections. The chosen option replaces the schedule's sections or is
  saved as a new schedule.
-->
<script lang="ts">
  import { ChevronLeft, ChevronRight, Lock, LockOpen } from "@lucide/svelte";
  import { coursePreview } from "$lib/components/course/preview";
  import WeekGrid from "$lib/components/calendar/WeekGrid.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import ToggleChips from "$lib/components/ui/ToggleChips.svelte";
  import { courseColorStyle } from "$lib/core/colors";
  import type { Term } from "$lib/core/data";
  import {
    DEFAULT_LUNCH,
    DEFAULT_PREFERENCES,
    generateSchedules,
    type Choice,
    type GeneratedSchedule,
    type Preferences,
  } from "$lib/core/generator";
  import { meetingSummary } from "$lib/core/ics";
  import { partBlocks, partLabel, sectionCounts } from "$lib/core/planner/format";
  import { allSelections, resolveSelection, selectionParts } from "$lib/core/sections";
  import type { ResolvedEntry, ScheduleView } from "$lib/core/state/schedule-view";
  import type { SectionChoice } from "$lib/core/state/store";
  import { DAY_SHORT, formatTime } from "$lib/core/time";
  import type { Day, Section } from "$lib/core/types";

  let {
    open = $bindable(false),
    view,
    term,
    name,
    onapply,
    onsaveasnew,
  }: {
    open?: boolean;
    view: ScheduleView;
    term: Term;
    /** The schedule's name, for the new schedule's. */
    name: string;
    onapply: (sections: Record<string, SectionChoice>) => void;
    onsaveasnew: (name: string, sections: Record<string, SectionChoice>) => void;
  } = $props();

  const START_OPTIONS = [480, 510, 540, 570, 600, 630, 660, 720];
  const END_OPTIONS = [14, 15, 16, 17, 18, 19, 20, 21].map((h) => h * 60);
  const WEEKDAYS: Day[] = [0, 1, 2, 3, 4];

  // Preferences outlive the dialog so reopening keeps them.
  let prefs = $state<Preferences>({ ...DEFAULT_PREFERENCES });
  let excluded = $state<string[]>([]);
  let locked = $state<string[]>([]);
  let index = $state(0);

  $effect(() => {
    if (open) {
      excluded = view.entries.filter((e) => e.entry.hidden).map((e) => e.course.id);
      locked = [];
      index = 0;
    }
  });

  const included = $derived(view.entries.filter((e) => !excluded.includes(e.course.id)));
  const outcome = $derived(
    generateSchedules(
      included.map((e) => {
        const all = allSelections(e.course);
        const options =
          locked.includes(e.course.id) && e.section !== null
            ? all.filter((o) => o.section === e.section && (e.child === null || o.child === e.child))
            : all;
        return {
          courseId: e.course.id,
          options,
          preferred: e.section === null ? null : { section: e.section.name, child: e.child?.name ?? null },
        };
      }),
      prefs,
      { minis: term.meta.minis.map((m) => m.number) },
    ),
  );
  const current = $derived(Math.min(index, Math.max(0, outcome.results.length - 1)));
  const result = $derived(outcome.results[current] ?? null);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function choiceLabel(choice: { section: Section | null; child: Section | null }): string {
    if (choice.section === null) return "No section";
    return choice.child ? `${partLabel(choice.section)}, ${partLabel(choice.child)}` : partLabel(choice.section);
  }

  function duration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function tags(r: GeneratedSchedule): { text: string; bad: boolean }[] {
    const b = r.breakdown;
    const out = [
      { text: `${b.daysOnCampus} ${b.daysOnCampus === 1 ? "day" : "days"} on campus`, bad: false },
      { text: b.gapMinutes > 0 ? `${duration(b.gapMinutes)} between classes` : "No gaps", bad: false },
    ];
    if (prefs.earliestStart !== null)
      out.push(
        b.earlyClasses > 0
          ? { text: `${b.earlyClasses} before ${formatTime(prefs.earliestStart)}`, bad: true }
          : { text: `Nothing before ${formatTime(prefs.earliestStart)}`, bad: false },
      );
    if (prefs.latestEnd !== null)
      out.push(
        b.lateClasses > 0
          ? { text: `${b.lateClasses} after ${formatTime(prefs.latestEnd)}`, bad: true }
          : { text: `Done by ${formatTime(prefs.latestEnd)}`, bad: false },
      );
    for (const d of prefs.daysOff)
      out.push(
        b.daysOffUsed.includes(d)
          ? { text: `Class on ${DAY_SHORT[d]}`, bad: true }
          : { text: `${DAY_SHORT[d]} free`, bad: false },
      );
    if (prefs.lunch !== null)
      out.push(
        b.lunchBlockedDays > 0
          ? { text: `No lunch break ${b.lunchBlockedDays} ${b.lunchBlockedDays === 1 ? "day" : "days"}`, bad: true }
          : { text: "Lunch break daily", bad: false },
      );
    // Times not announced yet: the arrangement can't be checked for conflicts with them.
    if (b.unscheduledSections > 0)
      out.push({
        text: `${b.unscheduledSections} ${b.unscheduledSections === 1 ? "section" : "sections"} without times`,
        bad: true,
      });
    return out;
  }

  const rows = $derived(
    result === null
      ? []
      : included.map((e) => {
          const pick: Choice | undefined = result.sections[e.course.id];
          const chosen =
            pick === undefined
              ? { section: null, child: null, needsChild: false }
              : resolveSelection(e.course, pick.section, pick.child);
          return { e, chosen };
        }),
  );
  const blocks = $derived(
    rows.flatMap(({ e, chosen }) => selectionParts(chosen).flatMap((p) => partBlocks(e.course, p, e.entry.color))),
  );

  function code(id: string): string {
    return view.entries.find((e) => e.course.id === id)?.course.code ?? id;
  }

  function timeOptions(list: number[]) {
    return [{ value: "", label: "Any time" }, ...list.map((m) => ({ value: String(m), label: formatTime(m) }))];
  }

  function lockLabel(e: ResolvedEntry, isLocked: boolean): string {
    const choices = allSelections(e.course).length;
    if (choices <= 1) return "Only one option";
    if (e.section === null) return "Choose a section on your schedule to keep it";
    return isLocked ? `Let the generator change ${e.course.code}'s sections` : `Keep ${e.course.code} in ${choiceLabel(e)}`;
  }
</script>

<!-- In the dialog's footer, so they stay in view below the option's calendar and course list. -->
{#snippet actions()}
  {#if result}
    <Button
      onclick={() => {
        onsaveasnew(`${name} (option ${current + 1})`, result.sections);
        open = false;
      }}>Save as new schedule</Button
    >
    <Button
      variant="primary"
      onclick={() => {
        onapply(result.sections);
        open = false;
      }}>Apply to this schedule</Button
    >
  {/if}
{/snippet}

<Dialog
  bind:open
  title="Generate schedules"
  size="lg"
  class="sm:max-w-[min(1080px,calc(100vw-2rem))]"
  footer={view.entries.length > 0 && result ? actions : undefined}
>
  {#if view.entries.length === 0}
    <p class="py-6 text-center text-body-2 text-ink">
      Your schedule has no courses yet. Add the courses you want to take, then come back to see every arrangement of
      their sections that fits together.
    </p>
  {:else}
    <div class="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside class="flex flex-col gap-6">
        <section aria-labelledby="gen-courses">
          <h3 id="gen-courses" class="mb-1 text-heading-6 text-strong">Courses</h3>
          <ul class="flex flex-col">
            {#each view.entries as e (e.course.id)}
              {@const isIncluded = !excluded.includes(e.course.id)}
              {@const isLocked = locked.includes(e.course.id)}
              {@const canLock = e.section !== null && allSelections(e.course).length > 1}
              <li class="flex items-center gap-1 {isIncluded ? '' : 'opacity-60'}" style={courseColorStyle(e.entry.color)}>
                <Checkbox
                  checked={isIncluded}
                  aria-label="Include {e.course.code}"
                  onchange={() => (excluded = toggle(excluded, e.course.id))}
                />
                <span aria-hidden="true" class="course-swatch h-4 w-1 shrink-0 rounded-full"></span>
                <span class="min-w-0 flex-1 pl-1">
                  <span class="tabular block text-label-lg text-strong">{e.course.code}</span>
                  <span class="block truncate text-label-md font-normal text-muted">
                    {isLocked && e.section ? `Keeping ${choiceLabel(e)}` : sectionCounts(e.course)}
                  </span>
                </span>
                <IconButton
                  label={lockLabel(e, isLocked)}
                  icon={isLocked ? Lock : LockOpen}
                  pressed={isLocked}
                  disabled={!canLock || !isIncluded}
                  onclick={() => (locked = toggle(locked, e.course.id))}
                />
              </li>
            {/each}
          </ul>
        </section>

        <section aria-labelledby="gen-prefs" class="flex flex-col gap-4">
          <h3 id="gen-prefs" class="text-heading-6 text-strong">Preferences</h3>
          <div class="flex flex-col gap-3">
            <Select
              label="Start no earlier than"
              hideLabel={false}
              value={prefs.earliestStart === null ? "" : String(prefs.earliestStart)}
              options={timeOptions(START_OPTIONS)}
              onchange={(event) => {
                const v = event.currentTarget.value;
                prefs = { ...prefs, earliestStart: v === "" ? null : Number(v) };
              }}
            />
            <Select
              label="End no later than"
              hideLabel={false}
              value={prefs.latestEnd === null ? "" : String(prefs.latestEnd)}
              options={timeOptions(END_OPTIONS)}
              onchange={(event) => {
                const v = event.currentTarget.value;
                prefs = { ...prefs, latestEnd: v === "" ? null : Number(v) };
              }}
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <p class="text-label-lg text-ink">Days I'd rather keep free</p>
            <ToggleChips
              stretch
              label="Days I'd rather keep free"
              options={WEEKDAYS.map((d) => ({ value: String(d), label: DAY_SHORT[d] }))}
              bind:value={
                () => prefs.daysOff.map(String),
                (v) => (prefs = { ...prefs, daysOff: v.map((x) => Number(x) as Day).toSorted() })
              }
            />
          </div>
          <fieldset class="flex flex-col">
            <legend class="mb-1 text-label-lg text-ink">Prefer</legend>
            <Checkbox
              checked={prefs.minimizeGaps}
              label="Fewer gaps"
              description="Rank back-to-back classes higher"
              onchange={(event) =>
                (prefs = { ...prefs, minimizeGaps: (event.currentTarget as HTMLInputElement).checked })}
              class="-ml-2"
            />
            <Checkbox
              checked={prefs.lunch !== null}
              label="Time for lunch"
              description="{DEFAULT_LUNCH.minutes} free minutes, {formatTime(DEFAULT_LUNCH.start)} to {formatTime(
                DEFAULT_LUNCH.end,
              )}"
              onchange={(event) =>
                (prefs = {
                  ...prefs,
                  lunch: (event.currentTarget as HTMLInputElement).checked ? DEFAULT_LUNCH : null,
                })}
              class="-ml-2"
            />
            <Checkbox
              checked={prefs.fewerDays}
              label="Fewer days on campus"
              onchange={(event) => (prefs = { ...prefs, fewerDays: (event.currentTarget as HTMLInputElement).checked })}
              class="-ml-2"
            />
          </fieldset>
        </section>
      </aside>

      <div class="min-w-0">
        {#if included.length === 0}
          <p class="rounded-field bg-surface-2 px-4 py-5 text-body-2 text-ink">
            Include at least one course to generate schedules.
          </p>
        {:else if outcome.results.length === 0}
          <div class="rounded-field bg-surface-2 px-4 py-5 text-body-2 text-ink" role="status">
            <p class="font-semibold text-strong">No arrangement of these sections avoids conflicts.</p>
            {#if outcome.blockingPairs.length > 0}
              <ul class="mt-2 flex flex-col gap-1">
                {#each outcome.blockingPairs as [a, b] (`${a}-${b}`)}
                  <li>{code(a)} and {code(b)} overlap in every section you allowed.</li>
                {/each}
              </ul>
            {/if}
            <p class="mt-2">
              {included.some((e) => locked.includes(e.course.id))
                ? "Unlock a course or leave one out to find more options."
                : "Leave a course out to see what fits with the rest."}
            </p>
          </div>
        {:else}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p class="text-body-2 text-ink">
              <span class="font-semibold text-strong">{outcome.found.toLocaleString("en-US")}</span>
              {outcome.found === 1 ? "arrangement fits" : "arrangements fit"}, best match first{outcome.found >
              outcome.results.length
                ? ` (showing the top ${outcome.results.length.toLocaleString("en-US")})`
                : ""}.
            </p>
            <div class="ml-auto flex items-center gap-1">
              <IconButton label="Previous option" icon={ChevronLeft} disabled={current === 0} onclick={() => (index = current - 1)} />
              <span class="tabular min-w-28 text-center text-label-md text-ink" aria-live="polite">
                Option {current + 1} of {outcome.results.length.toLocaleString("en-US")}
              </span>
              <IconButton
                label="Next option"
                icon={ChevronRight}
                disabled={current >= outcome.results.length - 1}
                onclick={() => (index = current + 1)}
              />
            </div>
          </div>
          {#if outcome.truncated}
            <p class="mt-1 text-label-md text-warn">
              Stopped after checking {outcome.found.toLocaleString("en-US")} combinations, so a better one may exist. Lock
              a course to narrow the search.
            </p>
          {/if}

          {#if result}
            <div class="mt-3 flex flex-wrap gap-1.5">
              {#each tags(result) as tag (tag.text)}
                <Chip tone={tag.bad ? "warn" : "soft"}>{tag.text}</Chip>
              {/each}
            </div>
            <div class="mt-3 rounded-field border border-line p-1.5">
              <WeekGrid {blocks} compact view="week" label="Option {current + 1}" />
            </div>
            <ul class="mt-3 divide-y divide-line rounded-field border border-line">
              {#each rows as { e, chosen } (e.course.id)}
                {@const changed =
                  e.section?.name !== chosen.section?.name || (e.child?.name ?? null) !== (chosen.child?.name ?? null)}
                {@const alternatives = result.alternatives[e.course.id]}
                <li class="flex items-start gap-3 px-3 py-2" style={courseColorStyle(e.entry.color)}>
                  <span aria-hidden="true" class="course-swatch mt-1 h-4 w-1 shrink-0 rounded-full"></span>
                  <div class="min-w-0 flex-1 text-body-2">
                    <p class="flex flex-wrap items-baseline gap-x-2">
                      <span {...coursePreview(e.course.id, term.meta.id)} class="tabular font-semibold text-strong">{e.course.code}</span>
                      <span class="font-semibold text-ink">{choiceLabel(chosen)}</span>
                      {#if changed}
                        <Chip size="sm" tone="neutral">{e.section ? `was ${choiceLabel(e)}` : "new pick"}</Chip>
                      {:else}
                        <span class="text-label-md font-normal text-muted">unchanged</span>
                      {/if}
                    </p>
                    {#each selectionParts(chosen) as part (part.name)}
                      <p class="text-ink">
                        {selectionParts(chosen).length > 1 ? `${partLabel(part)}: ` : ""}{meetingSummary(part)}
                      </p>
                    {/each}
                    {#if alternatives}
                      <p class="text-label-md font-normal text-muted">
                        Same times: {alternatives
                          .map((alt) => choiceLabel(resolveSelection(e.course, alt.section, alt.child)))
                          .join("; ")}
                      </p>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}

          {#if outcome.results.length > 1}
            <section aria-labelledby="gen-list" class="mt-6">
              <h3 id="gen-list" class="mb-2 text-heading-6 text-strong">Top matches</h3>
              <ol class="scrollbar-thin max-h-64 divide-y divide-line overflow-y-auto rounded-field border border-line">
                {#each outcome.results.slice(0, 50) as r, i (i)}
                  <li>
                    <button
                      type="button"
                      aria-current={i === current}
                      onclick={() => (index = i)}
                      class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-label-md {i === current
                        ? 'bg-line'
                        : 'hover:bg-hover'}"
                    >
                      <span class="w-16 shrink-0 font-semibold text-strong">Option {i + 1}</span>
                      <span class="flex flex-wrap gap-1.5">
                        {#each tags(r) as tag (tag.text)}
                          <Chip size="sm" tone={tag.bad ? "warn" : "outline"}>{tag.text}</Chip>
                        {/each}
                      </span>
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</Dialog>

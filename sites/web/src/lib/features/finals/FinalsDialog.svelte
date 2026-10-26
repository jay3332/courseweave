<!--
  Final exams for one schedule, opened from the schedules page (`/schedules?term=F26&finals=1`): the exam for each of
  its courses and sections from the registrar's schedule, with warnings and a calendar file; a search of every exam
  in the semester; and the student's SIO calendar import for exams the registrar's file lacks.
-->
<script lang="ts">
  import { CalendarX2 } from "@lucide/svelte";
  import { api } from "$lib/api";
  import type { FinalExam } from "$lib/api/types";
  import Button from "$lib/components/ui/Button.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import SearchInput from "$lib/components/ui/SearchInput.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { catalog, resource, session } from "$lib/data";
  import type { Term } from "$lib/core/data";
  import { coursePath } from "$lib/core/routes";
  import type { ResolvedEntry } from "$lib/core/state/schedule-view";
  import { formatTime } from "$lib/core/time";
  import { examDay, hasRoom } from "./finals";
  import { filterFinals, finalRows, sortFinals } from "./finals-table";
  import MyFinals from "./MyFinals.svelte";
  import SioImport from "./SioImport.svelte";

  let {
    open = $bindable(false),
    term,
    entries,
    scheduleName,
    onclose,
  }: {
    open?: boolean;
    term: Term;
    /** The schedule's courses. */
    entries: readonly ResolvedEntry[];
    scheduleName: string;
    onclose?: () => void;
  } = $props();

  const PAGE = 60;
  const termId = $derived(term.meta.id);
  const registrar = resource(() => (open ? catalog.finals(termId) : null));
  let imported = $state<FinalExam[]>([]);
  let query = $state("");
  let sort = $state<"course" | "date">("course");
  let limit = $state(PAGE);

  $effect(() => {
    const id = termId;
    imported = [];
    if (!open || session.status !== "signed-in") return;
    let live = true;
    api.finals.list(id).then(
      (list) => {
        if (live) imported = list;
      },
      () => {},
    );
    return () => {
      live = false;
    };
  });

  $effect(() => {
    void query;
    void sort;
    limit = PAGE;
  });

  const rows = $derived(
    registrar.value === undefined || registrar.value === null
      ? []
      : finalRows(registrar.value, (id) => term.courseById.get(id)),
  );
  const matches = $derived(sortFinals(filterFinals(rows, query), sort));
</script>

<Dialog
  bind:open
  title="Final exams"
  description="{scheduleName}, {term.meta.name}"
  size="lg"
  class="sm:max-w-[min(960px,calc(100vw-2rem))]"
  {onclose}
>
  <div class="flex flex-col gap-8">
    {#if registrar.status === "loading" && registrar.value === undefined}
      <Skeleton variant="text" lines={4} />
    {:else}
      {#if registrar.status === "error"}
        <p class="rounded-field bg-danger-bg px-3 py-2 text-body-2 text-ink" role="alert">
          Couldn't load the registrar's final exam schedule. {registrar.error} Check your connection and try again.
        </p>
      {:else if registrar.value === null}
        <div class="flex items-start gap-3 rounded-field bg-warn-bg px-4 py-3 text-body-2 text-ink" role="status">
          <CalendarX2 aria-hidden="true" class="mt-0.5 size-5 shrink-0 text-warn" />
          <p>
            <strong class="font-semibold">Not published yet.</strong> The registrar hasn't published the
            {term.meta.name} final exam schedule. If SIO already shows your exams, import your SIO calendar below.
          </p>
        </div>
      {/if}

      <section aria-labelledby="finals-mine" class="flex flex-col gap-3">
        <h3 id="finals-mine" class="text-heading-6 text-strong">This schedule</h3>
        <MyFinals
          {entries}
          registrar={registrar.value ?? null}
          sio={imported}
          {termId}
          termName={term.meta.name}
          {scheduleName}
        />
      </section>

      {#if rows.length > 0}
        <section aria-labelledby="finals-all" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <h3 id="finals-all" class="text-heading-6 text-strong">Look up any course</h3>
            <Select
              bind:value={sort}
              label="Sort"
              variant="compact"
              options={[
                { value: "course", label: "Sort by course" },
                { value: "date", label: "Sort by date" },
              ]}
            />
          </div>
          <SearchInput
            bind:value={query}
            variant="field"
            label="Search final exams"
            placeholder="Course number, name, instructor or room"
          />
          <p class="text-label-md font-normal text-muted" aria-live="polite">
            {matches.length.toLocaleString("en-US")}
            {matches.length === 1 ? "exam" : "exams"}{query.trim() === "" ? ` in ${term.meta.name}` : " match"}
          </p>
          <div class="data-table-scroll overflow-hidden rounded-card border border-pressed bg-surface">
            <table class="data-table-outline">
              <caption class="sr-only">{term.meta.name} final exam schedule</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Day</th>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {#each matches.slice(0, limit) as row (`${row.exam.courseId}-${row.exam.section}`)}
                  <tr>
                    <td>
                      <a href={coursePath(row.exam.code, termId)} class="tabular whitespace-nowrap"
                        >{row.exam.code}{row.exam.section ? ` ${row.exam.section}` : ""}</a
                      >
                      <span class="block max-w-56 truncate text-label-md font-normal text-muted" title={row.courseTitle}
                        >{row.courseTitle}</span
                      >
                    </td>
                    <td class="whitespace-nowrap">{examDay(row.exam.date)}</td>
                    <td class="tabular whitespace-nowrap">{formatTime(row.exam.start)}</td>
                    <td class="tabular whitespace-nowrap">{formatTime(row.exam.end)}</td>
                    <td class="min-w-36 {hasRoom(row.exam) ? '' : 'text-muted'}">
                      {row.exam.mode === "Remote" || row.exam.mode === "Cancelled"
                        ? row.exam.mode
                        : (row.exam.location ?? "To be announced")}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if matches.length === 0}
              <p class="px-6 py-6 text-center text-body-2 text-muted">No final exams match your search.</p>
            {/if}
          </div>
          {#if matches.length > limit}
            <Button class="self-center" onclick={() => (limit += PAGE * 4)}>
              Show more ({(matches.length - limit).toLocaleString("en-US")} left)
            </Button>
          {/if}
        </section>
      {/if}

      <section aria-labelledby="finals-sio" class="flex flex-col gap-3 border-t border-line pt-6">
        <div>
          <h3 id="finals-sio" class="text-heading-6 text-strong">Exams from your SIO calendar</h3>
          <p class="mt-1 text-body-2 text-muted">
            For exams the registrar's schedule doesn't list. Imported exams fill in courses above that have none.
          </p>
        </div>
        <SioImport {termId} termName={term.meta.name} {imported} onchange={(list) => (imported = list)} />
      </section>
    {/if}
  </div>
</Dialog>

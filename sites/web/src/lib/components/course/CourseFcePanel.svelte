<script lang="ts">
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import {
    courseIsMini,
    expectedHours,
    FCE_HOURS_HELP,
    fceByTerm,
    formatHours,
    formatRating,
    termName,
    WORKLOAD_TONE_LABEL,
    workloadRatio,
    workloadTone,
  } from "$lib/core/fce";
  import type { Course } from "$lib/core/types";
  import { courseFce, fceSummary } from "./data.svelte";
  import FceHistory from "./FceHistory.svelte";
  import LineChart from "./LineChart.svelte";
  import MemberSignIn from "./MemberSignIn.svelte";
  import WorkloadMeter, { TONE_TEXT } from "./WorkloadMeter.svelte";

  let {
    courseId,
    units,
    course = null,
    current = [],
    currentLabel,
    wide = false,
    headingLevel = 2,
  }: {
    courseId: string;
    units: number | null;
    /** The semester's course, when it's offered: its sections decide whether it runs as a mini. */
    course?: Course | null;
    /** Instructors teaching it in the semester shown, marked in the history. */
    current?: readonly string[];
    currentLabel?: string;
    /** History by instructor and by semester side by side instead of behind a switch. */
    wide?: boolean;
    headingLevel?: 2 | 3;
  } = $props();

  const summaryData = $derived(fceSummary());
  const rowsData = $derived(courseFce(courseId));
  const summary = $derived(summaryData.value?.courses.get(courseId));
  const rows = $derived(rowsData.value ?? []);
  const locked = $derived(summaryData.status === "signin" || summaryData.status === "forbidden");

  const mini = $derived(courseIsMini(course, summary));
  const expected = $derived(expectedHours(units, mini));
  const tone = $derived(summary ? workloadTone(workloadRatio(summary.hours, units, mini)) : null);

  const terms = $derived(fceByTerm(rows).toReversed());
  const showTrends = $derived(terms.filter((t) => t.responses > 0).length >= 2);
  const refs = $derived(terms.map((t) => expectedHours(units, t.miniShare >= 0.5)));
  const constant = $derived(refs.every((r) => r === refs[0]));
  const anyMini = $derived(refs.some((r) => r !== null && r !== units));
  const hoursTop = $derived.by(() => {
    const max = Math.max(...refs.map((r) => r ?? 0), ...terms.map((t) => t.hours ?? 0));
    return Math.max(6, Math.ceil((max + 1) / 3) * 3);
  });
  const reference = $derived.by(() => {
    const first = refs[0];
    if (!units || first === null || first === undefined) return null;
    return { value: constant ? first : refs, label: `${constant ? first : (refs.at(-1) ?? first)}h` };
  });
  const meta = $derived(
    summary
      ? `Last ${summary.terms} ${summary.terms === 1 ? "semester" : "semesters"} with responses, through ${termName(summary.last)}; ${summary.responses.toLocaleString("en-US")} responses`
      : null,
  );
  const heading = $derived(headingLevel === 2 ? "h2" : "h3");
  const roundTo = (value: number | null, digits: number): number | null =>
    value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
</script>

<section aria-label="Course evaluations" class="min-w-0">
  <svelte:element this={heading} id="course-fces" class="text-heading-4 text-strong">Course evaluations</svelte:element>
  {#if meta}<p class="mt-0.5 mb-3 text-label-md text-muted">{meta}</p>{:else}<div class="mb-3"></div>{/if}

  {#if locked}
    <MemberSignIn reason={summaryData.status === "forbidden" ? "forbidden" : "signin"} />
  {:else if summaryData.status === "error" || rowsData.status === "error"}
    <p class="text-body-2 text-danger">Course evaluations didn't load. Reload the page to try again.</p>
  {:else if summaryData.status === "loading" || rowsData.status === "loading"}
    <p class="flex items-center gap-2 text-body-2 text-muted" aria-live="polite">
      <Spinner size="sm" decorative /> Loading course evaluations
    </p>
  {:else if summaryData.value === null}
    <p class="text-body-2 text-ink">This catalog has no course evaluations.</p>
  {:else if rows.length === 0 || !summary}
    <p class="text-body-2 text-ink">
      No FCEs for this course number yet. New courses and courses whose instructors opted out have none.
    </p>
  {:else}
    <dl class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div class="rounded-card border border-pressed bg-surface px-4 py-3" title={FCE_HOURS_HELP}>
        <dt class="text-label-md text-muted">Hours a week</dt>
        <dd class="mt-0.5">
          <span class="tabular text-heading-3 text-strong">{formatHours(summary.hours)}</span>
          {#if units !== null}
            <span class="ml-1 text-label-md text-muted">for {mini ? `a ${units}-unit mini` : `${units} units`}</span>
          {/if}
          <WorkloadMeter hours={summary.hours} {units} {mini} class="mt-2" />
        </dd>
      </div>
      <div class="rounded-card border border-pressed bg-surface px-4 py-3" title="Overall course rating, 1 to 5">
        <dt class="text-label-md text-muted">Course rating</dt>
        <dd class="mt-0.5">
          <span class="tabular text-heading-3 text-strong">{formatRating(summary.courseRate)}</span>
          <span class="ml-1 text-label-md text-muted">of 5</span>
        </dd>
      </div>
      <div class="rounded-card border border-pressed bg-surface px-4 py-3" title="Overall teaching rating, 1 to 5">
        <dt class="text-label-md text-muted">Teaching rating</dt>
        <dd class="mt-0.5">
          <span class="tabular text-heading-3 text-strong">{formatRating(summary.teachingRate)}</span>
          <span class="ml-1 text-label-md text-muted">of 5</span>
        </dd>
      </div>
    </dl>
    {#if tone}
      <p class="mt-2 text-body-2 {TONE_TEXT[tone]}">
        {WORKLOAD_TONE_LABEL[tone]}
        <span class="text-muted">
          (about {formatHours(summary.hours)} hours a week against the {expected} hours its units suggest{mini
            ? `, since a ${units}-unit mini packs a full ${units} units into half a semester`
            : ""}{summary.hoursDelta !== null && Math.abs(summary.hoursDelta) >= 1
            ? `; ${summary.hoursDelta > 0 ? "up" : "down"} ${Math.abs(summary.hoursDelta).toFixed(1)} from the semesters before`
            : ""})
        </span>
      </p>
    {/if}

    {#if showTrends}
      <div class="mt-5 grid gap-5 sm:grid-cols-2">
        <figure class="min-w-0">
          <figcaption
            class="mb-1 text-label-lg text-ink"
            title="{FCE_HOURS_HELP} The dashed line marks the hours its units suggest{anyMini
              ? '; it doubles in semesters the course ran as a mini'
              : ''}."
          >
            Hours a week by semester
          </figcaption>
          <LineChart
            label="FCE hours per week by semester"
            domain={[0, hoursTop]}
            format={(v) => v.toFixed(Number.isInteger(v) ? 0 : 1)}
            reference={reference ?? undefined}
            points={terms.map((t) => ({
              label: t.term,
              title: termName(t.term),
              value: roundTo(t.hours, 1),
              sub: `${t.responses} responses`,
            }))}
          />
        </figure>
        <figure class="min-w-0">
          <figcaption class="mb-1 text-label-lg text-ink">Course rating by semester</figcaption>
          <LineChart
            label="FCE overall course rating by semester"
            domain={[1, 5]}
            format={(v) => v.toFixed(Number.isInteger(v) ? 0 : 2)}
            points={terms.map((t) => ({
              label: t.term,
              title: termName(t.term),
              value: roundTo(t.courseRate, 2),
              sub: `${t.responses} responses`,
            }))}
          />
        </figure>
      </div>
    {/if}

    {#if wide}
      <div class="grid min-w-0 gap-x-6 xl:grid-cols-2">
        <FceHistory {rows} {current} {units} {currentLabel} fixedMode="instructor" />
        <FceHistory {rows} {current} {units} {currentLabel} fixedMode="term" />
      </div>
    {:else}
      <FceHistory {rows} {current} {units} {currentLabel} />
    {/if}
  {/if}
</section>

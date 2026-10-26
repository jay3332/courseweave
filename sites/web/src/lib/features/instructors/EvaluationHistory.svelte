<script lang="ts">
  import LineChart from "$lib/components/course/LineChart.svelte";
  import { recentTeachingRate } from "$lib/components/instructor/instructor-fce";
  import StatBox from "$lib/components/ui/StatBox.svelte";
  import { FCE_HOURS_HELP, formatHours, formatRating, termName, type InstructorFce } from "$lib/core/fce";
  import { codeOf } from "$lib/core/requisite-format";
  import { coursePath } from "$lib/core/routes";

  // Courseweave's InstructorFce: the whole evaluation history at a glance, as a trend and per course.
  const RECENT = 4;

  let {
    fce,
    title,
    term,
  }: {
    fce: InstructorFce;
    /** A course's title, when the catalog knows it. */
    title: (courseId: string) => string | undefined;
    /** The semester course links open in. */
    term: string | null;
  } = $props();

  const responses = $derived(fce.terms.reduce((sum, t) => sum + t.responses, 0));
  const first = $derived(fce.terms[0]?.term);
  const recent = $derived(recentTeachingRate(fce, RECENT));
</script>

<section aria-labelledby="history-fce-heading" class="flex flex-col gap-4">
  <div>
    <h2 id="history-fce-heading" class="text-heading-5 text-strong">Evaluation history</h2>
    <p class="mt-1 text-body-2 text-muted">
      {fce.terms.length}
      {fce.terms.length === 1 ? "semester" : "semesters"} with responses{first ? ` since ${termName(first)}` : ""},
      {responses.toLocaleString("en-US")} responses in all.
    </p>
  </div>
  <!-- With a chart, the stats stack in a column beside it; without one they sit side by side. -->
  <div class="grid gap-4 {fce.terms.length >= 2 ? 'md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]' : ''}">
    <div
      class="grid grid-cols-2 gap-2 self-start sm:gap-3 {fce.terms.length >= 2
        ? 'md:grid-cols-1'
        : 'sm:max-w-xl'}"
    >
      <div
        title="Overall teaching rating over the last {RECENT} semesters with responses, weighted by responses"
        class="grid"
      >
        <StatBox label="Recent teaching rating" value={formatRating(recent)} unit="of 5" />
      </div>
      <StatBox label="Courses evaluated" value={fce.courses.length} />
    </div>
    {#if fce.terms.length >= 2}
      <figure class="min-w-0 rounded-card border border-pressed bg-surface px-3 pt-2 pb-1">
        <figcaption class="mb-1 text-label-md text-ink">Teaching rating by semester</figcaption>
        <LineChart
          label="{fce.name}'s overall teaching rating by semester"
          domain={[1, 5]}
          height={150}
          format={(value) => value.toFixed(Number.isInteger(value) ? 0 : 2)}
          points={fce.terms.map((t) => ({
            label: t.term,
            title: termName(t.term),
            value: t.teachingRate === null ? null : Math.round(t.teachingRate * 100) / 100,
            sub: `${t.responses} responses`,
          }))}
        />
      </figure>
    {/if}
  </div>

  <div class="data-table-scroll rounded-card border border-pressed bg-surface">
    <table class="data-table-outline data-table-card">
      <caption class="sr-only">Course evaluations for {fce.name}, by course</caption>
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col" class="max-sm:hidden">Taught</th>
          <th scope="col" class="text-right" title="Overall teaching rating">Teaching</th>
          <th scope="col" class="text-right" title="Overall course rating">Course</th>
          <th scope="col" class="text-right" title={FCE_HOURS_HELP}>Hrs/wk</th>
        </tr>
      </thead>
      <tbody class="tabular">
        {#each fce.courses as course (course.courseId)}
          {@const name = title(course.courseId)}
          <tr class="align-top">
            <td>
              <a href={coursePath(course.courseId, term)}>{codeOf(course.courseId)}</a>
              {#if name}<div class="max-w-[10rem] truncate sm:max-w-[16rem] text-label-md font-normal text-muted">{name}</div>{/if}
              <div class="text-label-md font-normal text-muted sm:hidden">
                {course.terms}
                {course.terms === 1 ? "semester" : "semesters"}, last {course.last}
              </div>
            </td>
            <td class="whitespace-nowrap max-sm:hidden" title="{termName(course.first)} to {termName(course.last)}">
              {course.terms}
              {course.terms === 1 ? "semester" : "semesters"}, last {termName(course.last)}
            </td>
            <td class="text-right">{formatRating(course.teachingRate)}</td>
            <td class="text-right">{formatRating(course.courseRate)}</td>
            <td class="text-right">{formatHours(course.hours)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

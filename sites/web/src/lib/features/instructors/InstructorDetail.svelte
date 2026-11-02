<script lang="ts">
  import { goto } from "$app/navigation";
  import { SearchX } from "@lucide/svelte";
  import Title from "$lib/components/shell/Title.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import { fceSample } from "$lib/components/course/fce-sample";
  import FceTable from "$lib/components/course/FceTable.svelte";
  import { departmentName } from "$lib/core/departments";
  import { FCE_HOURS_HELP, formatHours, formatRating } from "$lib/core/fce";
  import type { AllInstructor } from "$lib/core/instructors/allInstructors";
  import { instructorPath } from "$lib/core/routes";
  import { ALL_SEMESTERS } from "$lib/state/term-scope";
  import { semesterOptions } from "$lib/state";
  import EvaluationHistory from "./EvaluationHistory.svelte";
  import { useInstructorsScope } from "./scope.svelte";
  import TeachingHistory from "./TeachingHistory.svelte";
  import TeachingSections from "./TeachingSections.svelte";

  // `/instructors/<slug>`: the instructor's card (their course evaluations, laid out as on a course's page, and
  // evaluations by section), then Courseweave's teaching table or teaching history and evaluation history.
  const scope = useInstructorsScope();
  const inst = $derived(scope.selected);
  const fce = $derived(scope.fce);
  const tableRows = $derived.by(() => {
    if (!scope.everySemester) return scope.windowed;
    const chosen = new Set(scope.courses);
    return (fce.value?.rows ?? []).filter((row) => chosen.size === 0 || chosen.has(row.courseId));
  });

  // The three averages, in the course page's boxes.
  const figures = $derived([
    { label: "Hours a week", value: formatHours(scope.stats?.hours), unit: "", help: FCE_HOURS_HELP },
    {
      label: "Teaching rating",
      value: formatRating(scope.stats?.teachingRate),
      unit: "of 5",
      help: "Overall teaching rating, 1 to 5",
    },
    {
      label: "Course rating",
      value: formatRating(scope.stats?.courseRate),
      unit: "of 5",
      help: "Overall course rating, 1 to 5",
    },
  ]);
  const covered = $derived.by(() => {
    const stats = scope.stats;
    if (!stats || stats.terms.length === 0) return "No responses in the chosen semesters";
    const courses = scope.courses.length;
    return `${fceSample(stats.responses, stats.terms.length)}${courses > 0 ? `, ${courses} ${courses === 1 ? "course" : "courses"}` : ""}`;
  });

  function setTerm(next: string): void {
    const url = new URL(location.href);
    url.searchParams.set("term", next);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<Title value={inst?.name ?? "Instructor"} />

{#if !scope.signedIn}
  <!-- The layout asks the visitor to sign in. -->
{:else if !scope.detailReady}
  <div aria-busy="true" class="flex flex-col gap-4">
    <span class="sr-only" aria-live="polite">Loading the instructor</span>
    <Skeleton class="h-72 w-full rounded-card" />
    <Skeleton class="h-40 w-full rounded-card" />
  </div>
{:else if inst === undefined}
  {@const slug = scope.slug ?? ""}
  <Card padding="lg">
    <EmptyState
      icon={SearchX}
      headingLevel={1}
      title="No instructor at this link"
      description={scope.allMode
        ? `Nobody named "${slug.replaceAll("-", " ")}" teaches in any semester here or appears in course evaluations.`
        : `Nobody named "${slug.replaceAll("-", " ")}" teaches in ${scope.scopeName}. They may teach in another semester.`}
    >
      <div class="flex flex-wrap justify-center gap-2">
        {#if !scope.allMode}<Button href={instructorPath(slug, ALL_SEMESTERS)}>Look in all semesters</Button>{/if}
        <Button variant="secondary" href={scope.listHref}>Browse instructors</Button>
      </div>
    </EmptyState>
  </Card>
{:else}
  <div class="flex flex-col gap-10">
    <Card as="article" padding="none" class="p-5 sm:p-6" aria-labelledby="instructor-name">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h1 id="instructor-name" class="text-heading-3 text-strong sm:text-[32px] sm:leading-10">{inst.name}</h1>
          {#if inst.depts.length > 0}
            <p class="mt-1 text-body-1 text-muted">{inst.depts.map((code) => departmentName(code)).join(", ")}</p>
          {/if}
        </div>
        {#if scope.terms.value && !scope.split}
          <Select
            label="Semester"
            variant="compact"
            options={semesterOptions(scope.terms.value)}
            value={scope.allMode ? ALL_SEMESTERS : (scope.termId ?? "")}
            onchange={(event) => setTerm(event.currentTarget.value)}
            class="w-full sm:w-44"
          />
        {/if}
      </div>

      <section aria-labelledby="instructor-fces" class="mt-6">
        <h2 id="instructor-fces" class="text-heading-4 text-strong">Course evaluations</h2>
        {#if fce.status === "error"}
          <p class="mt-2 text-body-2 text-danger" role="alert">
            Course evaluations didn't load. Check your connection and reload the page.
          </p>
        {:else if fce.value === null}
          <p class="mt-2 text-body-2 text-ink">
            No course evaluations match {inst.name}. New instructors, and anyone whose name is spelled differently in
            FCEs, have none.
          </p>
        {:else}
          <p class="mt-0.5 mb-3 text-label-md text-muted">
            {#if fce.value === undefined}Loading course evaluations{:else}{covered}{/if}
          </p>
          <dl class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {#each figures as figure (figure.label)}
              <div class="rounded-card border border-pressed bg-surface px-4 py-3" title={figure.help}>
                <dt class="text-label-md text-muted">{figure.label}</dt>
                <dd class="mt-0.5">
                  {#if fce.value === undefined}
                    <Skeleton class="my-1.5 h-6 w-16" />
                  {:else}
                    <span class="tabular text-heading-3 text-strong">{figure.value}</span>
                    {#if figure.unit && figure.value !== formatRating(null)}
                      <span class="ml-1 text-label-md text-muted">{figure.unit}</span>
                    {/if}
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>

          <div class="mt-6 mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-heading-6 text-strong">Evaluations by section</h3>
            <Switch label="Every semester" bind:checked={scope.everySemester} disabled={fce.value === undefined} />
          </div>
          {#if fce.value === undefined}
            <Skeleton class="h-40 w-full rounded-card" />
          {:else}
            <FceTable
              showCourse
              showInstructor={false}
              rows={tableRows}
              caption="Course evaluations for {inst.name}"
              empty={scope.everySemester
                ? "No evaluations for these courses"
                : "No evaluations in the chosen semesters and seasons. Turn on Every semester to see them all."}
            />
          {/if}
        {/if}
      </section>
    </Card>

    {#if scope.allMode}
      <TeachingHistory inst={inst as AllInstructor} lookup={scope.lookup.value} />
    {:else if scope.term.value}
      <TeachingSections {inst} term={scope.term.value} />
    {/if}

    {#if fce.value}
      <EvaluationHistory
        fce={fce.value.summary}
        title={(id) => scope.titleOf(id)}
        term={scope.allMode ? null : scope.termId}
      />
    {/if}
  </div>
{/if}

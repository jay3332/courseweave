<script lang="ts">
  import { ChevronDown, ExternalLink, GitFork } from "@lucide/svelte";
  import CourseChipList from "$lib/components/course/CourseChipList.svelte";
  import { catalogIndex, courseDetails } from "$lib/components/course/data.svelte";
  import { getCourseHref } from "$lib/components/course/links";
  import { termRequisites } from "$lib/components/course/requisite-context.svelte";
  import RequisiteExpression from "$lib/components/course/RequisiteExpression.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import type { CatalogDetails } from "$lib/core/catalog-types";
  import { offeredText } from "$lib/core/catalog/format";
  import { requisitesPath } from "./paths";

  let {
    courseId,
    termId,
  }: {
    courseId: string;
    /** The semester requisites are checked for; null shows plain chips. */
    termId: string | null;
  } = $props();

  type ProfileKey = keyof NonNullable<CatalogDetails["profile"]>;
  const PROFILE_FIELDS: { key: ProfileKey; label: string }[] = [
    { key: "keyTopics", label: "Key topics" },
    { key: "goals", label: "Learning goals" },
    { key: "assessment", label: "Assessment" },
    { key: "resources", label: "Resources" },
    { key: "background", label: "Expected background" },
    { key: "relevance", label: "Who it's for" },
  ];
  const LONG = 480;

  const index = $derived(catalogIndex());
  const details = $derived(courseDetails(courseId));
  const entry = $derived(index.value?.courses[courseId]);
  const d = $derived(details.value ?? null);
  const requisites = $derived(termId === null ? null : termRequisites(termId));
  // Only colour chips once there's something to check against.
  const checking = $derived(requisites?.ctx !== null && (requisites?.ctx?.credits.size ?? 0) > 0);
  const profile = $derived(d?.profile ? PROFILE_FIELDS.filter((f) => d.profile?.[f.key]) : []);
  const offered = $derived(entry ? offeredText(entry) : null);
  const titleOf = (id: string): string | undefined => index.value?.courses[id]?.title;
  const courseHref = getCourseHref();
  const hrefOf = (id: string): string => courseHref(id, termId);
  let full = $state(false);
</script>

{#snippet row(label: string)}
  <dt class="pt-0.5 text-label-lg text-muted">{label}</dt>
{/snippet}

<section aria-labelledby="course-about" class="flex min-w-0 flex-col gap-4">
  <h2 id="course-about" class="text-heading-4 text-strong">About</h2>

  {#if index.status === "loading" || details.status === "loading"}
    <Skeleton variant="text" lines={4} />
  {:else}
    {#if d?.description}
      <div>
        <p
          id="course-description"
          class="max-w-[72ch] text-body-1 text-ink {d.description.length > LONG && !full ? 'line-clamp-6' : ''}"
        >
          {d.description}
        </p>
        {#if d.description.length > LONG}
          <button
            type="button"
            aria-expanded={full}
            aria-controls="course-description"
            onclick={() => (full = !full)}
            class="mt-1 min-h-10 text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
          >
            {full ? "Show less" : "Show full description"}
          </button>
        {/if}
      </div>
    {:else}
      <p class="text-body-2 text-muted">No catalog description for this course.</p>
    {/if}

    {#if entry}
      <dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-body-2 text-ink sm:grid-cols-[9rem_minmax(0,1fr)]">
        {@render row("Prerequisites")}
        <dd class="min-w-0">
          {#if entry.prereqs}
            <RequisiteExpression
              req={entry.prereqs}
              status={checking ? (requisites?.prereqStatus ?? undefined) : undefined}
              title={titleOf}
              href={hrefOf}
            />
          {:else}
            <p class="pt-0.5">None listed</p>
          {/if}
          {#if entry.prereqText}
            <p class="mt-1 text-label-md text-muted">Schedule of Classes: {entry.prereqText}</p>
          {/if}
          <!-- The requisite explorer's graph: the whole chain, with the student's standing on each course. -->
          <a
            href={requisitesPath(courseId, termId, "graph")}
            class="mt-1 flex min-h-10 w-fit items-center gap-1.5 text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
          >
            <GitFork aria-hidden="true" class="size-4" />Prerequisite tree and what it unlocks
          </a>
        </dd>
        {#if entry.coreqs.length > 0}
          {@render row("Corequisites")}
          <dd class="flex min-w-0 flex-col gap-1">
            <span class="text-label-md text-muted">
              {entry.coreqs.length > 1 ? "One of these, before or in the same semester" : "Before or in the same semester"}
            </span>
            <CourseChipList
              ids={entry.coreqs}
              status={checking ? (requisites?.coreqStatus ?? undefined) : undefined}
              title={titleOf}
              href={hrefOf}
              joinWord={entry.coreqs.length > 1 ? "or" : undefined}
            />
          </dd>
        {/if}
        {#if entry.antireqs.length > 0}
          {@render row("Not with")}
          <dd class="flex min-w-0 flex-col gap-1">
            <span class="text-label-md text-muted">You can't also get credit for</span>
            <CourseChipList ids={entry.antireqs} title={titleOf} href={hrefOf} />
          </dd>
        {/if}
        {#if entry.equivalents.length > 0}
          {@render row("Equivalent to")}
          <dd class="min-w-0"><CourseChipList ids={entry.equivalents} title={titleOf} href={hrefOf} /></dd>
        {/if}
        {@render row("Grading")}
        <dd>
          {#if entry.passFail}
            Pass/fail only.
            <span class="text-muted">Its units count toward your unit total but not your QPA.</span>
          {:else}
            Letter grade (factorable units)
          {/if}
        </dd>
        {#if entry.unitsMax !== undefined}
          {@render row("Units")}
          <dd>Variable, {entry.units ?? 0}&ndash;{entry.unitsMax}</dd>
        {/if}
        {#if offered}
          {@render row("Usually offered")}
          <dd>{offered.replace(/^Usually /u, "").replace(/^./u, (c) => c.toUpperCase())}</dd>
        {/if}
        {#if d?.permissionRequired}
          {@render row("Enrollment")}
          <dd>Special permission required</dd>
        {/if}
        {#if entry.repeatable}
          {@render row("Repeatable")}
          <dd>Can be taken more than once for credit</dd>
        {/if}
      </dl>
    {:else}
      <p class="text-body-2 text-muted">The catalog has no requisite or grading information for this course.</p>
    {/if}

    {#if d?.notes}
      <p class="rounded-card border border-line bg-surface-2 px-3 py-2 text-body-2 text-ink">{d.notes}</p>
    {/if}

    {#if profile.length > 0}
      <details class="group rounded-card border border-pressed bg-surface">
        <summary
          class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-card px-4 text-label-lg text-ink select-none group-open:rounded-b-none hover:bg-hover [&::-webkit-details-marker]:hidden"
        >
          Course profile
          <ChevronDown
            aria-hidden="true"
            class="size-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <dl class="flex flex-col gap-3 border-t border-line px-4 py-3 text-body-2">
          {#each profile as f (f.key)}
            <div>
              <dt class="text-label-md text-muted">{f.label}</dt>
              <dd class="mt-0.5 whitespace-pre-line text-ink">{d?.profile?.[f.key]}</dd>
            </div>
          {/each}
        </dl>
      </details>
    {/if}

    {#if d?.website}
      <a
        href={d.website}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-10 items-center gap-1.5 self-start text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
      >
        <ExternalLink aria-hidden="true" class="size-4" />Course website<span class="sr-only"> (opens in a new tab)</span>
      </a>
    {/if}
  {/if}
</section>

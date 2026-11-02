<script lang="ts">
  import { ChevronLeft } from "@lucide/svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import CourseFcePanel from "$lib/components/course/CourseFcePanel.svelte";
  import { catalogIndex, courseDetails, offerings, termData } from "$lib/components/course/data.svelte";
  import RequiresAndUnlocks from "$lib/components/course/RequiresAndUnlocks.svelte";
  import SaveButton from "$lib/components/course/SaveButton.svelte";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { buildUnlocks } from "$lib/core/catalog";
  import { departmentName } from "$lib/core/departments";
  import { catalogTitle } from "$lib/core/explorer/unoffered";
  import { nearestTerm } from "$lib/core/offerings";
  import { codeOf } from "$lib/core/requisite-format";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath, coursesPath } from "$lib/core/routes";
  import { catalog, resource } from "$lib/data";
  import { device, isAllSemesters, originBack, resolveTerm } from "$lib/state";
  import CatalogFacts from "./CatalogFacts.svelte";
  import CountsToward from "./CountsToward.svelte";
  import CourseActions from "./CourseActions.svelte";
  import CourseAbout from "./CourseAbout.svelte";
  import CourseFacts from "./CourseFacts.svelte";
  import CourseHead from "./CourseHead.svelte";
  import CourseSections from "./CourseSections.svelte";
  import CourseSyllabi from "./CourseSyllabi.svelte";
  import { CourseSchedule } from "./course-schedule.svelte";
  import { termOrder } from "$lib/core/fce-names";
  import NotOfferedHere from "./NotOfferedHere.svelte";
  import OfferingHistory from "./OfferingHistory.svelte";
  import { requisitesPath } from "./paths";
  import ScheduleCalendar from "./ScheduleCalendar.svelte";
  import SectionJumps from "./SectionJumps.svelte";

  let {
    courseId,
    requestedTerm,
  }: {
    /** Five-digit id; "" when the address isn't a course number. */
    courseId: string;
    /** The `term` query parameter, if any. */
    requestedTerm: string | null;
  } = $props();

  const code = $derived(courseId === "" ? "" : codeOf(courseId));
  const terms = resource(() => catalog.terms());
  const all = $derived(isAllSemesters(requestedTerm));
  // The semester underneath: the one asked for, else the last one visited, else the newest.
  const resolved = $derived(terms.value ? resolveTerm(requestedTerm, terms.value, device.lastTerm) : null);
  const explicit = $derived(requestedTerm !== null && requestedTerm === resolved);
  const offeringsData = $derived(offerings());
  const offered = $derived(offeringsData.value?.byId.get(courseId)?.terms ?? []);

  /**
   * What to show: a semester's sections, or the all-semesters view. Without a `term`, a course the remembered
   * semester doesn't offer opens in the nearest semester that does, and one no semester offers in the catalog view.
   */
  const view = $derived.by((): { kind: "loading" } | { kind: "all" } | { kind: "term"; termId: string } => {
    if (resolved === null) return { kind: terms.status === "loading" ? "loading" : "all" };
    if (all) return { kind: "all" };
    if (explicit) return { kind: "term", termId: resolved };
    if (offeringsData.status === "loading") return { kind: "loading" };
    if (offeringsData.value === null || offeringsData.value === undefined || offered.includes(resolved))
      return { kind: "term", termId: resolved };
    if (offered.length === 0) return { kind: "all" };
    return { kind: "term", termId: nearestTerm(offered, resolved) ?? resolved };
  });
  const termId = $derived(view.kind === "term" ? view.termId : null);
  const term = $derived(termId === null ? null : termData(termId));
  const course = $derived(term?.value?.courseById.get(courseId) ?? null);
  const index = $derived(catalogIndex());
  const entry = $derived(index.value?.courses[courseId]);
  const offering = $derived(offeringsData.value?.byId.get(courseId));
  const details = $derived(courseDetails(courseId));
  const title = $derived(course?.title ?? offering?.title ?? catalogTitle(entry?.title));
  const units = $derived(course ? course.units : entry?.unitsMax === undefined ? (entry?.units ?? null) : null);
  // The semester requisites and requirements are checked for: the one shown, or the one underneath.
  const checkTerm = $derived(termId ?? resolved);
  // Loaded here, before the sections that check requisites against it ask for it.
  const checkLoad = $derived(checkTerm === null ? null : termData(checkTerm));

  const sched = new CourseSchedule(() => (course && term?.value ? { course, term: term.value } : null));
  // Wide screens keep the calendar in view beside the sections; narrower ones show it after them.
  const wide = new MediaQuery("(min-width: 1024px)");

  // Back returns to the page the course was opened from (the degree plan, a schedule, the course list as it was, an
  // instructor or the profile); otherwise to the semester's course list.
  const origin = originBack();
  const back = $derived.by(() => {
    if (origin !== null) return origin;
    return { href: coursesPath(termId ?? resolved), label: "All courses" };
  });

  const unlocks = $derived(index.value ? (buildUnlocks(index.value).get(courseId) ?? []) : []);
  const departments = $derived(term?.value?.departments ?? []);
  const titleOf = (id: string): string | undefined =>
    term?.value?.courseById.get(id)?.title ?? index.value?.courses[id]?.title;
  const chipHref = (id: string): string => coursePath(id, termId !== null && term?.value?.courseById.has(id) ? termId : null);
  const offeredHere = (id: string): boolean => term?.value?.courseById.has(id) ?? false;

  // The semesters offering it, plus the one asked for when it doesn't, newest first.
  const termOptions = $derived([
    ...[...offered, ...(termId !== null && !offered.includes(termId) ? [termId] : [])]
      .toSorted((a, b) => termOrder(b) - termOrder(a))
      .map((t) => ({ value: t, label: termLabel(t) })),
    { value: "all", label: "All semesters" },
  ]);
  const nextTerm = $derived(resolved === null ? undefined : nearestTerm(offered, resolved));

  const hasTermSelect = $derived(courseId !== "" && (offered.length > 0 || termId !== null));
  /** Which of the page's states shows. */
  const stage = $derived.by((): "invalid" | "loading" | "error" | "not-offered" | "missing" | "ready" => {
    if (courseId === "") return "invalid";
    if (
      view.kind === "loading" ||
      term?.status === "loading" ||
      checkLoad?.status === "loading" ||
      (view.kind === "all" && (index.status === "loading" || offeringsData.status === "loading"))
    )
      return "loading";
    if (term?.status === "error") return "error";
    if (view.kind === "term" && !course) return "not-offered";
    if (view.kind === "all" && !title) return "missing";
    return "ready";
  });

  /** A white section card on the page background. */
  const card = "min-w-0 rounded-card border border-pressed bg-surface p-5 sm:p-6";

  // "Jump to" under the header: the sections this view shows, in page order.
  const jumps = $derived([
    ...(course ? [{ id: "course-sections", label: "Sections" }] : []),
    { id: "course-about", label: "About" },
    { id: "course-counts", label: "Counts toward" },
    ...(course ? [{ id: "course-offered", label: "Offered" }] : []),
    { id: "course-fces", label: "Course evaluations" },
    { id: "course-syllabi", label: "Past syllabi" },
    { id: "course-requisites", label: "Prerequisites" },
  ]);
</script>

{#snippet termSelect(variant: "field" | "compact", className = "")}
  <Select
    {variant}
    label="Semester"
    class={className}
    options={termOptions}
    value={view.kind === "all" ? "all" : (termId ?? "")}
    onchange={(event) => {
      const next = event.currentTarget.value;
      void goto(coursePath(courseId, next), { noScroll: true });
    }}
  />
{/snippet}

<CourseHead code={code || "Course"} {title} description={details.value?.description} />

<PageContainer width="wide">
  <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
    <a
      href={back.href}
      class="-ml-1 inline-flex min-h-10 items-center gap-1 rounded-full pr-2 text-label-lg text-muted hover:text-ink"
    >
      <ChevronLeft aria-hidden="true" class="size-5" />{back.label}
    </a>
    <!-- With the course shown, the select heads its actions card instead. -->
    {#if hasTermSelect && (stage === "not-offered" || stage === "error")}
      {@render termSelect("compact", "ml-auto w-44")}
    {/if}
  </div>

  {#if stage === "invalid"}
    <EmptyState
      title="That isn't a course number"
      description="Course numbers look like 15-122. Search for the course on the courses page."
    >
      <Button variant="primary" href={coursesPath(resolved)}>Search courses</Button>
    </EmptyState>
  {:else if stage === "loading"}
    <div class="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span class="sr-only">Loading {code}</span>
      <Skeleton class="h-14 w-40" />
      <Skeleton class="h-8 w-2/3" />
      <Skeleton variant="text" lines={4} />
    </div>
  {:else if stage === "error"}
    <EmptyState title="This semester didn't load" description="Check your connection, then reload the page.">
      <Button onclick={() => location.reload()}>Reload</Button>
    </EmptyState>
  {:else if stage === "not-offered" && termId !== null}
    <NotOfferedHere {courseId} {termId} terms={terms.value ?? []} showBack={false} />
  {:else if stage === "missing"}
    <EmptyState
      title="No course {code}"
      description="It isn't in the course catalog or any semester this site has. Check the number and try again."
    >
      <Button variant="primary" href={coursesPath(resolved)}>Search courses</Button>
    </EmptyState>
  {:else}
    <article class="flex flex-col gap-8">
      <!--
        Wide screens: the title and its facts on the left, the actions card beside them at the top, in the same column
        as the calendar below. Narrower: the card comes between the title and the facts. The facts row is the
        flexible one, so opening the requisite details grows it rather than pushing the facts off the title.
      -->
      <header
        class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:grid-rows-[auto_1fr] lg:gap-x-8"
      >
        <div class="min-w-0 lg:col-start-1 lg:row-start-1">
          <div class="flex items-center gap-2 sm:gap-3">
            <p class="min-w-0 text-[44px] tabular leading-none font-semibold tracking-tight text-strong sm:text-[64px]">
              {code}
            </p>
            <SaveButton {courseId} />
          </div>
          <h1 class="mt-2 max-w-[32ch] text-heading-3 text-strong sm:text-[32px] sm:leading-10">{title}</h1>
          <p class="mt-1 text-body-1 text-muted">
            {#if course && term?.value}{departmentName(course.dept)} &middot; {term.value.meta.name}{:else}All semesters{/if}
          </p>
        </div>
        <CourseActions
          {sched}
          {courseId}
          checkTermId={checkTerm}
          nextTerm={course ? undefined : nextTerm}
          class="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          {#snippet select()}
            {#if hasTermSelect}{@render termSelect("field")}{/if}
          {/snippet}
        </CourseActions>
        <div class="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-start">
          {#if course && term?.value}
            <CourseFacts {course} term={term.value} />
          {:else}
            <CatalogFacts {courseId} terms={terms.value ?? []} />
          {/if}
          <SectionJumps sections={jumps} class="mt-5" />
        </div>
      </header>

      <div class="grid gap-x-8 gap-y-8 {course ? 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]' : ''}">
        <div class="flex min-w-0 flex-col gap-8">
          {#if course && term?.value}
            <!-- Narrow screens: the calendar comes first, so a tapped section's preview is near. -->
            {#if !wide.current}<ScheduleCalendar {sched} />{/if}
            <CourseSections {course} {sched} meta={term.value.meta} />
          {/if}
          <div class={card}><CourseAbout {courseId} termId={checkTerm} /></div>
          <div class={card}><CountsToward {courseId} termId={checkTerm} /></div>
          {#if course}
            <div class={card}><OfferingHistory {courseId} currentTerm={termId} terms={terms.value ?? []} /></div>
          {/if}
        </div>
        {#if course && wide.current}
          <aside class="min-w-0" aria-label="Your schedule">
            <ScheduleCalendar {sched} hourHeight={32} class="sticky top-[calc(var(--header-h)+1rem)]" />
          </aside>
        {/if}
      </div>

      <div class={card}>
        <CourseFcePanel
          {courseId}
          {units}
          {course}
          current={course?.instructors ?? []}
          currentLabel={term?.value ? `Teaching in ${term.value.meta.name}` : undefined}
          wide
        />
      </div>

      <div class={card}><CourseSyllabi {courseId} {code} /></div>

      <section aria-labelledby="course-requisites" class="scroll-mt-24">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="course-requisites" class="text-heading-4 text-strong">Prerequisites and what it unlocks</h2>
          <a
            href={requisitesPath(courseId, termId ?? resolved)}
            class="inline-flex min-h-10 items-center text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
          >
            Explore the whole chain
          </a>
        </div>
        {#if index.status === "loading"}
          <Skeleton class="h-40" />
        {:else if index.status === "error"}
          <p class="text-body-2 text-danger">The course catalog didn't load. Reload the page to try again.</p>
        {:else if index.value}
          <RequiresAndUnlocks
            id={courseId}
            index={index.value}
            {unlocks}
            href={chipHref}
            title={titleOf}
            offered={termId === null ? undefined : offeredHere}
            termName={term?.value?.meta.name}
            {departments}
            headingLevel={3}
          />
        {/if}
      </section>
    </article>
  {/if}
</PageContainer>

<style>
  /* "Jump to" lands each section with its heading below the sticky site header. */
  article :global(h2[id^="course-"]) {
    scroll-margin-top: calc(var(--header-h) + 1rem);
  }
</style>

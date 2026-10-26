<script lang="ts">
  import { ArrowLeft, Maximize2, X } from "@lucide/svelte";
  import CourseFcePanel from "$lib/components/course/CourseFcePanel.svelte";
  import { catalogIndex, offerings, termData } from "$lib/components/course/data.svelte";
  import SaveButton from "$lib/components/course/SaveButton.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { parseCourseCode } from "$lib/core/data";
  import { catalogTitle } from "$lib/core/explorer/unoffered";
  import { nearestTerm } from "$lib/core/offerings";
  import { codeOf } from "$lib/core/requisite-format";
  import { coursePath } from "$lib/core/routes";
  import { catalog, resource } from "$lib/data";
  import CatalogFacts from "./CatalogFacts.svelte";
  import CountsToward from "./CountsToward.svelte";
  import CourseActions from "./CourseActions.svelte";
  import CourseAbout from "./CourseAbout.svelte";
  import CourseFacts from "./CourseFacts.svelte";
  import CourseSections from "./CourseSections.svelte";
  import CourseSyllabi from "./CourseSyllabi.svelte";
  import { CourseSchedule } from "./course-schedule.svelte";
  import { defaultCourseHref, setCourseHref, type CourseHref } from "$lib/components/course/links";
  import NotOfferedHere from "./NotOfferedHere.svelte";
  import ScheduleCalendar from "./ScheduleCalendar.svelte";

  let {
    code,
    termId,
    contextTermId,
    closeHref,
    courseHref,
  }: {
    /** A course code ("15-122") or id ("15122"). */
    code: string;
    /** The semester; null is the all-semesters view (no sections). */
    termId: string | null;
    /** A real semester for requisite checks and requirement links; equals `termId` when that's set. */
    contextTermId: string;
    /** Back to the list, with its filters. */
    closeHref: string;
    /** Where course links inside the panel go (cross-listings, requisite chips); defaults to course pages. */
    courseHref?: CourseHref;
  } = $props();

  // Courseweave's course detail panel, for the Courses page: the full page's sections stacked to fit a side panel
  // or a phone. The Courses page owns the head tags.
  setCourseHref((courseId, term) => (courseHref ?? defaultCourseHref)(courseId, term));

  const courseId = $derived(parseCourseCode(code));
  const display = $derived(/^\d{5}$/u.test(courseId) ? codeOf(courseId) : code);
  const terms = resource(() => catalog.terms());
  const term = $derived(termId === null ? null : termData(termId));
  // The semester requisites are checked for, loaded here before the sections that read it.
  const contextLoad = $derived(termData(termId ?? contextTermId));
  const course = $derived(term?.value?.courseById.get(courseId) ?? null);
  const index = $derived(catalogIndex());
  const offeringsData = $derived(offerings());
  const offering = $derived(offeringsData.value?.byId.get(courseId));
  const title = $derived(course?.title ?? offering?.title ?? catalogTitle(index.value?.courses[courseId]?.title));
  const units = $derived.by(() => {
    if (course) return course.units;
    const entry = index.value?.courses[courseId];
    return entry?.unitsMax === undefined ? (entry?.units ?? null) : null;
  });
  const next = $derived(nearestTerm(offering?.terms ?? [], contextTermId));
  const loading = $derived(
    (term !== null && term.status === "loading") ||
      contextLoad.status === "loading" ||
      (termId === null && (index.status === "loading" || offeringsData.status === "loading")),
  );

  const sched = new CourseSchedule(() => (course && term?.value ? { course, term: term.value } : null));
  const fullHref = $derived(coursePath(display, termId ?? "all"));
  const isId = $derived(/^\d{5}$/u.test(courseId));

  // The bar sticks to the top of the panel where the panel scrolls on its own (beside the list), and under the site
  // header where it scrolls with the page (in place of the list). It holds the star, and shows the code once the big
  // one has scrolled under it; scroll events don't bubble, but they can be caught on the way down from any scroller.
  let article = $state<HTMLElement>();
  let bar = $state<HTMLElement>();
  let head = $state<HTMLElement | null>(null);
  let ownScroll = $state(true);
  let condensed = $state(false);
  $effect(() => {
    const parent = article?.parentElement;
    const barEl = bar;
    const headEl = head;
    if (!parent || !barEl) return;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      ownScroll = /auto|scroll/u.test(getComputedStyle(parent).overflowY);
      condensed = headEl !== null && headEl.getBoundingClientRect().bottom <= barEl.getBoundingClientRect().bottom;
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(check);
    };
    check();
    // The panel moves between beside and in place of the list with the window and the rail.
    const resize = new ResizeObserver(schedule);
    resize.observe(parent);
    addEventListener("scroll", schedule, { capture: true, passive: true });
    return () => {
      resize.disconnect();
      removeEventListener("scroll", schedule, { capture: true });
      cancelAnimationFrame(frame);
    };
  });
</script>

<!--
  Rounded and clipped to the panel's inner corners, so neither its background nor the sticky bar paints over the
  panel's rounded border (clip, not hidden, so the bar still sticks while the page scrolls).
-->
<article
  bind:this={article}
  class="flex min-h-full flex-col overflow-clip rounded-[calc(var(--radius-card)-1px)] bg-surface"
  aria-label="{display} details"
>
  <div
    bind:this={bar}
    class="sticky z-20 flex h-14 {ownScroll ? 'top-0' : 'top-[var(--header-h)]'} shrink-0 items-center gap-2 border-b border-line bg-surface px-4"
  >
    <a
      href={closeHref}
      class="-ml-1 inline-flex min-h-10 items-center gap-1.5 rounded-full pr-2 text-label-lg text-ink hover:text-strong md:hidden"
    >
      <ArrowLeft aria-hidden="true" class="size-5" />All courses
    </a>
    {#if isId}<SaveButton {courseId} size="sm" class="md:-ml-1.5" />{/if}
    <!-- The code comes up here once the big one has scrolled under the bar. -->
    <span
      aria-hidden="true"
      class="hidden text-label-lg text-strong tabular transition-opacity duration-150 motion-reduce:transition-none md:inline {condensed
        ? 'opacity-100'
        : 'opacity-0'}">{display}</span
    >
    <div class="ml-auto flex items-center gap-1">
      <Button size="sm" variant="ghost" icon={Maximize2} href={fullHref} title="Open the full course page">
        Expand
      </Button>
      <span class="hidden md:contents">
        <IconButton href={closeHref} label="Close course details" icon={X} size="sm" />
      </span>
    </div>
  </div>

  <div class="flex flex-col gap-8 px-4 pt-5 pb-10 sm:px-5">
    {#if !isId}
      <p class="text-body-2 text-ink">"{code}" isn't a course number. Course numbers look like 15-122.</p>
    {:else if loading}
      <div class="flex flex-col gap-3" aria-busy="true">
        <span class="sr-only" aria-live="polite">Loading {display}</span>
        <Skeleton class="h-11 w-32" />
        <Skeleton class="h-7 w-3/4" />
        <Skeleton variant="text" lines={4} />
      </div>
    {:else if term !== null && term.status === "error"}
      <p class="text-body-2 text-danger">This semester didn't load. Check your connection, then reload the page.</p>
    {:else if termId !== null && !course}
      <NotOfferedHere
        {courseId}
        {termId}
        terms={terms.value ?? []}
        backHref={closeHref}
        allHref={(courseHref ?? defaultCourseHref)(courseId, null)}
        compact
      />
    {:else if termId === null && !title}
      <div>
        <h2 class="text-heading-4 text-strong">No course {display}</h2>
        <p class="mt-2 text-body-2 text-ink">
          It isn't in the course catalog or any semester this site has. Check the number and try again.
        </p>
      </div>
    {:else}
      <!-- As on the full page: the code with its star, the title, the actions card, then the facts. -->
      <header class="flex flex-col gap-4">
        <div>
          <div bind:this={head}>
            <p class="min-w-0 text-[40px] tabular leading-none font-semibold tracking-tight text-strong">{display}</p>
          </div>
          <h2 class="mt-1.5 text-heading-4 text-strong">{title}</h2>
        </div>
        <CourseActions {sched} {courseId} checkTermId={termId ?? contextTermId} nextTerm={course ? undefined : next} />
        {#if course && term?.value}
          <CourseFacts {course} term={term.value} layout="list" />
        {:else}
          <CatalogFacts {courseId} terms={terms.value ?? []} layout="list" />
        {/if}
      </header>

      <CourseAbout {courseId} termId={termId ?? contextTermId} />
      <CountsToward {courseId} termId={termId ?? contextTermId} />

      {#if course && term?.value}
        <ScheduleCalendar {sched} headingId="panel-calendar" />
        <CourseSections {course} {sched} meta={term.value.meta} />
      {/if}

      <CourseFcePanel
        {courseId}
        {units}
        {course}
        current={course?.instructors ?? []}
        currentLabel={term?.value ? `Teaching in ${term.value.meta.name}` : undefined}
      />
      <CourseSyllabi {courseId} code={display} />
    {/if}
  </div>
</article>

<script lang="ts">
  import type { Snippet } from "svelte";
  import CourseCard from "$lib/components/course/CourseCard.svelte";
  import CourseList from "$lib/components/course/CourseList.svelte";
  import CourseRow from "$lib/components/course/CourseRow.svelte";
  import HoursScatter from "$lib/components/course/HoursScatter.svelte";
  import type { ListView } from "$lib/components/ui/ViewToggle.svelte";
  import type { FceSummary } from "$lib/core/fce";
  import type { Course } from "$lib/core/types";

  let {
    results,
    resetKey,
    view,
    chart = false,
    fce = null,
    highlight = new Set<string>(),
    termId,
    contextTermId = null,
    offeredOf,
    hrefFor,
    keepList = true,
    selectedId = null,
    active = -1,
    limit = $bindable(0),
    footer,
  }: {
    results: readonly Course[];
    /** Changes when the search, filters or sort change: paging starts over. */
    resetKey: string;
    view: ListView;
    /** The FCE hours chart instead of cards or rows. */
    chart?: boolean;
    fce?: Map<string, FceSummary> | null;
    /** Courses marked on the chart, such as the ones in the student's schedule. */
    highlight?: ReadonlySet<string>;
    /** The semester shown; null in the all-semesters view. */
    termId: string | null;
    /** All-semesters view: the semester cards check requisites in when no semester offers the course. */
    contextTermId?: string | null;
    /** All-semesters view: the semesters offering a course, newest first. */
    offeredOf?: (courseId: string) => readonly string[];
    hrefFor: (course: Course) => string;
    /** Courses open in the detail panel beside the list, so opening one keeps the list's scroll and focus. */
    keepList?: boolean;
    /** The course open in the detail panel. */
    selectedId?: string | null;
    /** Highlighted by keyboard navigation from the search field. */
    active?: number;
    /** How many results are rendered; more load as the end of the list scrolls into view. */
    limit?: number;
    /** Shown once every result is (courses from other semesters). */
    footer?: Snippet;
  } = $props();

  // Cards are heavier than rows, so they come in smaller pages.
  const pageSize = $derived(view === "cards" ? 20 : 100);
  $effect.pre(() => {
    void resetKey;
    limit = view === "cards" ? 20 : 100;
  });
  const shown = $derived(results.slice(0, limit));

  /** Loads the next page when the end of the list scrolls near. */
  function loadMore(node: HTMLElement): () => void {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) limit += pageSize;
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }

  const cardTerm = (course: Course): string =>
    termId ?? offeredOf?.(course.id)[0] ?? contextTermId ?? "";
</script>

<!-- Opening a course in the panel keeps the list where it is; the full page starts at its top. -->
<div data-sveltekit-noscroll={keepList ? "" : "off"} data-sveltekit-keepfocus={keepList ? "" : "off"}>
  {#if chart && fce}
    <HoursScatter courses={results} {fce} {highlight} {hrefFor} fill />
  {:else if view === "cards"}
    <ol class="flex flex-col gap-6" aria-label="Courses">
      {#each shown as course, index (course.id)}
        <li
          id="result-{course.id}"
          class="scroll-mt-40 rounded-card {index === active || course.id === selectedId
            ? 'outline-2 outline-offset-2 outline-accent'
            : ''}"
        >
          {#if cardTerm(course) === ""}
            <CourseRow {course} termId={null} offered={[]} href={hrefFor(course)} />
          {:else}
            <CourseCard
              {course}
              termId={cardTerm(course)}
              offered={termId === null ? (offeredOf?.(course.id) ?? []) : undefined}
              href={hrefFor(course)}
            />
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <CourseList label="Courses" allSemesters={termId === null}>
      {#each shown as course, index (course.id)}
        <div id="result-{course.id}" class="scroll-mt-40">
          <CourseRow
            {course}
            {termId}
            offered={termId === null ? (offeredOf?.(course.id) ?? []) : undefined}
            href={hrefFor(course)}
            active={index === active}
            selected={course.id === selectedId}
          />
        </div>
      {/each}
    </CourseList>
  {/if}

  {#if !chart && limit < results.length}
    <p {@attach loadMore} class="py-6 text-center text-body-2 text-muted" aria-live="polite">
      Showing {limit.toLocaleString("en-US")} of {results.length.toLocaleString("en-US")}
    </p>
  {:else}
    {@render footer?.()}
  {/if}
</div>

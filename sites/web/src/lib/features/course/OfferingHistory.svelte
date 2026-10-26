<script lang="ts">
  import { catalogIndex, offerings } from "$lib/components/course/data.svelte";
  import { getCourseHref } from "$lib/components/course/links";
  import Chip from "$lib/components/ui/Chip.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { offeredText } from "$lib/core/catalog/format";
  import { termLabel } from "$lib/core/requisites";
  import type { TermIndexEntry } from "$lib/core/types";

  let {
    courseId,
    currentTerm,
    terms,
  }: {
    courseId: string;
    /** The semester shown, marked in the list; null in the all-semesters view. */
    currentTerm: string | null;
    /** Every built semester, newest first, for the span of semesters this site has. */
    terms: readonly TermIndexEntry[];
  } = $props();

  const courseHref = getCourseHref();
  const all = $derived(offerings());
  const index = $derived(catalogIndex());
  const offered = $derived(all.value?.byId.get(courseId)?.terms ?? []);
  const pattern = $derived.by(() => {
    const entry = index.value?.courses[courseId];
    return entry ? offeredText(entry) : null;
  });
  const span = $derived.by(() => {
    if (terms.length === 0) return null;
    const oldest = terms.at(-1);
    const newest = terms[0];
    return oldest && newest ? `${oldest.name} to ${newest.name}` : null;
  });
</script>

<section aria-labelledby="course-offered" class="min-w-0">
  <h2 id="course-offered" class="mb-2 text-heading-4 text-strong">Offered</h2>
  {#if all.status === "loading"}
    <Skeleton class="h-8 w-64" />
  {:else}
    {#if offered.length > 0}
      <ul class="flex flex-wrap gap-2" aria-label="Semesters offering it">
        {#each offered as t (t)}
          <li>
            {#if t === currentTerm}
              <Chip tone="strong" shape="pill" size="lg">
                {termLabel(t)}<span class="sr-only"> (shown)</span>
              </Chip>
            {:else}
              <Chip tone="outline" shape="pill" size="lg" href={courseHref(courseId, t)}>
                {termLabel(t)}
              </Chip>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-body-2 text-ink">
        Not offered in any semester this site has{span ? ` (${span})` : ""}.
      </p>
    {/if}
    {#if pattern}<p class="mt-2 text-body-2 text-muted">{pattern}, according to the course catalog.</p>{/if}
  {/if}
</section>

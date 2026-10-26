<script lang="ts">
  import { ArrowRight } from "@lucide/svelte";
  import StatBox from "$lib/components/ui/StatBox.svelte";
  import type { AllInstructor, CourseLookup } from "$lib/core/instructors/allInstructors";
  import { codeOf } from "$lib/core/requisite-format";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath, instructorPath } from "$lib/core/routes";

  // Courseweave's AllInstructorDetail: what they teach in each built semester, each linking to that semester's view.
  let { inst, lookup }: { inst: AllInstructor; lookup: CourseLookup | undefined } = $props();
</script>

<section aria-labelledby="history-heading" class="flex flex-col gap-4">
  <h2 id="history-heading" class="text-heading-5 text-strong">Teaching by semester</h2>
  {#if inst.terms.length > 0}
    <div class="grid grid-cols-3 gap-2 sm:gap-3">
      <StatBox label="Semesters" value={inst.terms.length} />
      <StatBox label="Courses" value={inst.courseIds.length} />
      <StatBox label="Sections" value={inst.sectionCount} />
    </div>
    <ul class="divide-y divide-line rounded-card border border-pressed bg-surface">
      {#each inst.terms as t (t.term)}
        <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-5">
          <div class="flex items-baseline justify-between gap-3 sm:w-48 sm:shrink-0 sm:flex-col sm:gap-0.5">
            <span class="text-heading-6 text-ink">{termLabel(t.term)}</span>
            <a
              href={instructorPath(inst.slug, t.term)}
              class="inline-flex min-h-8 items-center gap-1 text-label-md text-accent-ink hover:underline"
            >
              {t.sections}
              {t.sections === 1 ? "section" : "sections"}, times and rooms
              <ArrowRight aria-hidden="true" class="size-3.5" />
            </a>
          </div>
          <ul class="flex min-w-0 flex-1 flex-col gap-1">
            {#each t.courses as id (id)}
              <li class="flex min-w-0 items-baseline gap-2 text-body-2">
                <a href={coursePath(id, t.term)} class="shrink-0 font-medium text-ink hover:text-accent-ink hover:underline"
                  >{codeOf(id)}</a
                >
                <span class="truncate text-muted">{lookup?.title(id) ?? ""}</span>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-body-2 text-muted">
      Not teaching in any semester in this catalog. Their course evaluations are above.
    </p>
  {/if}
</section>

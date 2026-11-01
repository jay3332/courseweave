<script lang="ts">
  import MemberSignIn from "$lib/components/course/MemberSignIn.svelte";
  import { catalogIndex } from "$lib/components/course/data.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { entryYearOf } from "$lib/core/degree/hooks";
  import { requirementsForCourse, type CourseRequirementMatch } from "$lib/core/requirement-match";
  import { planPath, requirementCoursesPath } from "$lib/core/routes";
  import { catalog, resource } from "$lib/data";
  import { plans } from "$lib/state";

  let {
    courseId,
    termId,
  }: {
    courseId: string;
    /** The semester the course would be taken in, so requirement windows apply; null ignores them. */
    termId: string | null;
  } = $props();

  const plan = $derived(plans.active);
  const programs = $derived(plan?.programs ?? []);
  const versions = resource(() =>
    plan && programs.length > 0 ? catalog.auditVersions(programs, entryYearOf(plan.startTerm)) : null,
  );
  const index = $derived(catalogIndex());
  const matches = $derived.by((): CourseRequirementMatch[] | null => {
    if (versions.status !== "ready" || versions.value === undefined || index.status === "loading") return null;
    return requirementsForCourse(versions.value.values(), courseId, index.value ?? null, {
      term: termId,
      programIds: programs.map((p) => p.catalogId),
    });
  });
  // Group by program, keeping the plan's order.
  const groups = $derived.by(() => {
    const map = new Map<number, { program: string; items: CourseRequirementMatch[] }>();
    for (const m of matches ?? []) {
      const group = map.get(m.auditId) ?? { program: m.programName, items: [] };
      group.items.push(m);
      map.set(m.auditId, group);
    }
    return [...map.entries()];
  });

  function filterHref(m: CourseRequirementMatch): string {
    return requirementCoursesPath({ auditId: m.auditId, nodeId: m.filterNodeId }, termId);
  }
</script>

<section aria-labelledby="course-counts" class="min-w-0">
  <h2 id="course-counts" class="mb-2 text-heading-4 text-strong">Counts toward</h2>
  {#if !plan || programs.length === 0}
    <p class="text-body-2 text-ink">
      <a href={planPath()} class="text-label-lg text-accent-ink underline underline-offset-2">
        {plan ? "Pick your major in your degree plan" : "Start a degree plan"}
      </a>
      to see which requirements this course can count toward.
    </p>
  {:else if versions.status === "signin" || versions.status === "forbidden"}
    <MemberSignIn subject="which of your degree requirements it counts toward" reason={versions.status} />
  {:else if versions.status === "error"}
    <p class="text-body-2 text-danger">Your programs' requirements didn't load. Reload the page to try again.</p>
  {:else if matches === null}
    <p class="flex items-center gap-2 text-body-2 text-muted" aria-live="polite">
      <Spinner size="sm" decorative /> Checking your programs' requirements
    </p>
  {:else if matches.length === 0}
    <p class="text-body-2 text-ink">
      No specific requirement in {plan.name}'s programs. It can still count toward your unit total as a free elective.
    </p>
  {:else}
    <div class="flex flex-col gap-3">
      {#each groups as [auditId, group] (auditId)}
        <div>
          <p class="mb-1 text-label-md text-muted">{group.program}</p>
          <ul class="flex flex-col">
            {#each group.items as m (m.nodeId)}
              <li>
                <a
                  href={filterHref(m)}
                  title="Show courses that count toward this, fewest FCE hours first"
                  class="group -mx-2 flex min-h-10 items-baseline gap-2 rounded-tag px-2 py-2 hover:bg-hover sm:min-h-0 sm:py-1"
                >
                  <span class="min-w-0 flex-1 text-body-2">
                    {#if m.path.length > 0}<span class="text-muted">{m.path.join(" \u203a ")} &rsaquo; </span>{/if}
                    <span class="text-ink underline decoration-line-strong underline-offset-2 group-hover:text-accent-ink"
                      >{m.name}</span
                    >
                  </span>
                  {#if m.target}<span class="shrink-0 text-label-md text-muted">{m.target}</span>{/if}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
</section>

<script lang="ts">
  // The requirement audit: per program, overall progress and the requirement tree with what's left, then the
  // plan's free electives. Courseweave's features/degree/audit/AuditPanel.tsx.
  import { ListChecks } from "@lucide/svelte";
  import { fmt } from "$lib/core/degree/audit/format";
  import { isGeneralCredit } from "$lib/core/plan";
  import type { AuditInput } from "$lib/core/plan-types";
  import type { AuditData } from "$lib/core/programs";
  import { codeOf } from "$lib/core/requisite-format";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import ProgramAudit from "./ProgramAudit.svelte";
  import type { TreeContext } from "./tree";

  let {
    input,
    data,
    base,
    flat = false,
  }: {
    input: AuditInput;
    /** Null only while no program is chosen. */
    data: AuditData | null;
    /** Lookups and actions for the tree (without the requirement lookup, which each program adds). */
    base: Omit<TreeContext, "node" | "auditId" | "catalog" | "inPlan">;
    /** In the rail: no cards; programs are divided by rules like the rail's groups, and what's checked with a program
     *  is set in by a rule on its left. */
    flat?: boolean;
  } = $props();

  const result = $derived(data?.result ?? { programs: [], unassigned: [] });
  const inPlan = $derived(new Set(input.courses.map((c) => c.courseId)));
  const selected = $derived(result.programs.filter((p) => p.attachedTo === undefined));
  const shared = $derived({ ...base, catalog: data?.catalog ?? null, inPlan });
  const freeUnits = $derived(
    input.courses
      .filter((c) => result.unassigned.includes(c.courseId))
      .reduce((n, c) => n + c.units, 0),
  );
  const courseOf = (id: string) => input.courses.find((c) => c.courseId === id);
  const CARD = "rounded-card border border-pressed bg-surface p-4";
  const SECTION = "flex flex-col gap-4 border-line not-first:border-t not-first:pt-5";
  const card = $derived(flat ? "" : CARD);
  const attached = $derived(flat ? "border-l border-line pl-3" : CARD);
</script>

{#if input.programs.length === 0 || data === null}
  <EmptyState
    size="sm"
    icon={ListChecks}
    headingLevel={3}
    title="Pick a major to check requirements"
    description="The audit shows which requirements your courses cover and suggests courses for the rest."
  />
{:else}
  <!-- Each program is a card, like the semesters; what's checked with it (gen eds, concentrations) follows in
       cards of its own. -->
  <div class="flex flex-col {flat ? 'gap-5' : 'gap-4'}">
    {#each selected as p (p.auditId)}
      <section aria-label={p.programName ?? p.name} class={flat ? SECTION : "flex flex-col gap-4"}>
        <div class={card}>
          <ProgramAudit program={p} version={data.versions.get(p.auditId)} base={shared} />
        </div>
        {#each result.programs.filter((a) => a.attachedTo === p.catalogId) as a (a.auditId)}
          <div class={attached}>
            <p class="mb-1.5 text-label-md font-normal text-muted">Required with {p.programName ?? p.name}</p>
            <ProgramAudit program={a} version={data.versions.get(a.auditId)} base={shared} nested />
          </div>
        {/each}
      </section>
    {/each}

    {#if result.unassigned.length > 0}
      <section aria-labelledby="audit-free" class={flat ? "border-t border-line pt-5" : CARD}>
        <h3 id="audit-free" class="text-label-lg text-strong">Free electives</h3>
        <p class="mt-0.5 text-label-md font-normal text-muted">
          {fmt(freeUnits)} units that don't count toward a specific requirement. They still count toward your degree's
          unit total.
        </p>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          {#each result.unassigned as id (id)}
            {@const c = courseOf(id)}
            <li>
              {#if isGeneralCredit(id)}
                <span
                  class="inline-flex min-h-10 items-center rounded-tag border border-dashed border-line-strong px-2 text-label-md text-ink md:min-h-7"
                >
                  {c?.source ?? "Transfer credit"}, {fmt(c?.units ?? 0)} units
                </span>
              {:else}
                {@const title = data.catalog?.courses[id]?.title}
                <a
                  href={base.href(id, c?.term)}
                  aria-label={title ? `${codeOf(id)} ${title}` : codeOf(id)}
                  class="tabular inline-flex min-h-10 items-center rounded-tag border border-pressed px-2 text-label-md font-semibold text-strong hover:border-line-strong md:min-h-7"
                >
                  {codeOf(id)}
                </a>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}

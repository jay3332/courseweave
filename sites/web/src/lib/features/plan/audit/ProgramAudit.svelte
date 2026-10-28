<script lang="ts">
  // One program's audit: its name and state, areas done, unit progress, and the requirement tree.
  import { displayState, fmt } from "$lib/core/degree/audit/format";
  import type { ProgramVersion, ReqNode } from "$lib/core/degree-types";
  import type { ProgramAuditResult } from "$lib/core/plan-types";
  import ProgressBar from "./ProgressBar.svelte";
  import RequirementList from "./RequirementList.svelte";
  import StateBadge from "./StateBadge.svelte";
  import type { TreeContext } from "./tree";

  let {
    program,
    version,
    base,
    nested = false,
  }: {
    program: ProgramAuditResult;
    version: ProgramVersion | undefined;
    /** Everything but the requirement lookup and the version, which are this program's. */
    base: Omit<TreeContext, "node" | "auditId">;
    nested?: boolean;
  } = $props();

  function indexNodes(root: ReqNode | undefined): Map<number, ReqNode> {
    const out = new Map<number, ReqNode>();
    const walk = (n: ReqNode): void => {
      out.set(n.id, n);
      for (const c of n.children) walk(c);
    };
    if (root) walk(root);
    return out;
  }

  const nodes = $derived(indexNodes(version?.root));
  const ctx = $derived<TreeContext>({ ...base, auditId: program.auditId, node: (id) => nodes.get(id) ?? null });
  const areas = $derived(program.root.children.filter((c) => c.skipped !== true && c.manual !== true));
  const areasDone = $derived(areas.filter((c) => c.state === "complete").length);
  const areasPlanned = $derived(areas.filter((c) => c.state === "complete-with-plan").length);
  const state = $derived(displayState({ state: program.state }));
  const name = $derived(program.programName ?? program.name);
</script>

<div class="flex flex-col gap-3">
  <header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      {#if nested}
        <h4 class="text-label-lg text-strong">{name}</h4>
      {:else}
        <h3 class="text-heading-6 text-strong">{name}</h3>
      {/if}
      <StateBadge {state} />
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-label-md text-muted">
      {#if program.versionName}<span>{program.versionName} requirements</span>{/if}
      {#if areas.length > 0}
        <span>
          {areasDone} of {areas.length} areas done{areasPlanned > 0 ? `, ${areasPlanned} more planned` : ""}
        </span>
      {/if}
      {#if program.manualCount}
        <span>
          {program.manualCount}
          {program.manualCount === 1 ? "item needs" : "items need"} an advisor's check
        </span>
      {/if}
    </div>
    {#if program.totalUnits}
      {@const t = program.totalUnits}
      <div class="flex max-w-[520px] flex-wrap items-center gap-x-2 gap-y-1">
        <ProgressBar have={t.have} planned={t.planned} need={t.need} label="Degree units" class="h-2 min-w-24 flex-1" />
        <span class="tabular shrink-0 text-label-md text-ink">
          {fmt(t.have)}{t.planned ? ` + ${fmt(t.planned)} planned` : ""} of {fmt(t.need)} units
        </span>
      </div>
    {/if}
  </header>
  {#if version}
    <RequirementList
      results={program.root.children.length > 0 ? program.root.children : [program.root]}
      {ctx}
      depth={0}
    />
  {:else}
    <p class="text-body-2 text-muted">Requirements for this program version couldn't be loaded.</p>
  {/if}
</div>

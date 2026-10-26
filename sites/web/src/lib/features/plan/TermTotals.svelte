<script lang="ts">
  // A semester's footer: factorable and pass/fail units and FCE hours a week (at the busier half when minis run). A
  // number past its guidance turns the warning color with an icon, and says why on hover.
  import { TriangleAlert } from "@lucide/svelte";
  import { HEAVY_UNITS, type LoadFlags, type TermTotals } from "$lib/core/plan";

  let { totals, flags }: { totals: TermTotals; flags: LoadFlags } = $props();

  const fceTitle = $derived(
    (totals.peakHalf
      ? `Busier half of the term (${totals.peakHalf} half): ${Math.round(totals.peakHours)} FCE hours a week, against ${Math.round(totals.otherHalfHours)} in the other half. Full-semester courses count in both halves; minis only in theirs, at their in-session hours. Units there suggest about ${Math.round(totals.peakExpected)} hours a week (mini units count double). Which half a mini runs in is estimated from past FCEs.`
      : `FCE hours a week for the ${totals.fceUnits} units with evaluations.`) +
      (totals.missingFce > 0
        ? ` ${totals.missingFce} course${totals.missingFce === 1 ? " has" : "s have"} no FCEs.`
        : ""),
  );
  const overTitle = `Exceeds ${HEAVY_UNITS} factorable units`;
</script>

<footer class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line px-4 py-2 text-label-md font-normal text-ink">
  <span
    class={flags.overUnits ? "inline-flex items-center gap-1 self-center text-warn" : ""}
    title={flags.overUnits ? overTitle : "Factorable units count toward your QPA"}
  >
    {#if flags.overUnits}<TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />{/if}
    <!-- One flex item with its word, so the number is a space from it rather than the warning row's gap. -->
    <span><span class="tabular font-semibold {flags.overUnits ? '' : 'text-strong'}">{totals.factorable}</span> factorable</span>
    {#if flags.overUnits}<span class="sr-only">, {overTitle.toLowerCase()}</span>{/if}
  </span>
  {#if totals.nonFactorable > 0}
    <span title="Pass/fail units count toward graduation but not your QPA">
      <span class="tabular font-semibold text-strong">{totals.nonFactorable}</span> pass/fail
    </span>
  {/if}
  {#if totals.fceUnits > 0}
    <span
      class="ml-auto {flags.heavyHours ? 'inline-flex items-center gap-1 self-center text-warn' : ''}"
      title={flags.heavyHours ? `${flags.heavyHours}. ${fceTitle}` : fceTitle}
    >
      {#if flags.heavyHours}<TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />{/if}
      <span
        ><span class="tabular font-semibold {flags.heavyHours ? '' : 'text-strong'}">{Math.round(totals.peakHours)}</span>
        FCE hrs/wk{totals.peakHalf ? " at peak" : ""}</span
      >
      <span class="sr-only">. {flags.heavyHours ? `${flags.heavyHours}. ` : ""}{fceTitle}</span>
    </span>
  {/if}
</footer>

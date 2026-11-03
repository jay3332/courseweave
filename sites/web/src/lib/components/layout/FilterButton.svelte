<script lang="ts">
  import { ListFilter } from "@lucide/svelte";
  import { getRail } from "./rail-context";

  let { class: className = "" }: { class?: string } = $props();
  const rail = getRail();
  const Icon = $derived(rail?.icon ?? ListFilter);
</script>

{#if rail?.asSheet}
  <button
    type="button"
    aria-haspopup="dialog"
    aria-label={rail.count > 0 && rail.buttonLabel === undefined ? `${rail.label}, ${rail.count} active` : undefined}
    onclick={() => rail.open()}
    class="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full text-label-md whitespace-nowrap transition-colors {rail.count > 0
      ? 'bg-strong px-3 text-surface'
      : '-ml-3 px-3 text-strong hover:bg-hover'} {className}"
  >
    <Icon aria-hidden="true" class="size-[18px]" />
    {#if rail.buttonLabel !== undefined}
      {rail.buttonLabel}
    {:else}
      {rail.label}
      {#if rail.count > 0}
        <span aria-hidden="true" class="tabular">{rail.count}</span>
      {/if}
    {/if}
  </button>
{/if}

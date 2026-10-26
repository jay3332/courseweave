<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    value,
    unit,
    label,
    variant = "outline",
    class: className = "",
    children,
  }: {
    /** The figure, such as 15.19. Ignored when `children` is given. */
    value?: string | number;
    /** Smaller text after the value, such as "hrs/wk". */
    unit?: string;
    /** What the figure is, such as "Workload". */
    label: string;
    /** outline: a small card (instructor pages); plain: white box inside a well (course card FCEs). */
    variant?: "outline" | "plain";
    class?: string;
    /** Custom value line, such as a StarRating. */
    children?: Snippet;
  } = $props();
</script>

<div
  class="flex min-w-0 flex-col justify-center bg-surface {variant === 'outline'
    ? 'rounded-card border border-pressed px-4 py-2.5'
    : 'rounded-tag px-3 py-1.5'} {className}"
>
  <div class="flex items-baseline gap-1 text-ink">
    {#if children}
      {@render children()}
    {:else}
      <span class="tabular text-[20px] leading-7">{value}</span>
      {#if unit}<span class="text-body-1">{unit}</span>{/if}
    {/if}
  </div>
  <div class="text-body-2 text-muted">{label}</div>
</div>

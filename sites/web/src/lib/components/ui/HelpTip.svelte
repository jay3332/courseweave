<script lang="ts">
  // A (?) that shows a short hint on hover or focus, for how-to text most people don't need on screen. A tap focuses
  // it, which shows the hint on touch too.
  import { CircleHelp } from "@lucide/svelte";
  import Tooltip from "./Tooltip.svelte";
  import type { IconComponent } from "./types";

  let {
    text,
    label = "Help",
    icon: Icon = CircleHelp,
    class: className = "",
  }: { text: string; label?: string; icon?: IconComponent; class?: string } = $props();
</script>

<Tooltip {text} delay={150}>
  {#snippet trigger(props)}
    <button
      type="button"
      {...props}
      aria-label={label}
      onclick={(event) => event.currentTarget.focus()}
      class="inline-grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-10 {className}"
    >
      <Icon aria-hidden="true" class="size-4" />
    </button>
  {/snippet}
</Tooltip>

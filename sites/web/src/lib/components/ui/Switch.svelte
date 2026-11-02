<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import type { IconComponent } from "./types";

  type Props = Omit<HTMLButtonAttributes, "class" | "role" | "onchange"> & {
    checked?: boolean;
    /** Accessible name; shown next to the switch unless `hideLabel`. */
    label: string;
    hideLabel?: boolean;
    labelPosition?: "start" | "end";
    /** Icon drawn inside the thumb (the theme switch's sun and moon). */
    icon?: IconComponent;
    /** accent fills the track when on; neutral keeps the outlined track (Figma theme switch). */
    tone?: "accent" | "neutral";
    onchange?: (checked: boolean) => void;
    class?: string;
  };

  let {
    checked = $bindable(false),
    label,
    hideLabel = false,
    labelPosition = "start",
    icon: Icon,
    tone = "accent",
    onchange,
    disabled = false,
    class: className = "",
    ...rest
  }: Props = $props();

  function toggle(): void {
    checked = !checked;
    onchange?.(checked);
  }

  const filled = $derived(checked && tone === "accent");
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={hideLabel ? label : undefined}
  {disabled}
  onclick={toggle}
  class="group inline-flex items-center gap-3 rounded-full text-left text-label-lg text-ink disabled:opacity-50 {hideLabel
    ? ''
    : '-mx-1.5 px-1.5'} {className}"
  {...rest}
>
  <!-- A label that wraps (in a narrow rail) lines up on the left, as text does, not centered as in a button. -->
  {#if !hideLabel && labelPosition === "start"}<span>{label}</span>{/if}
  <span
    class="relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full border transition-colors {filled
      ? 'border-accent bg-accent'
      : 'border-muted bg-transparent group-hover:bg-hover'}"
  >
    <span
      class="absolute top-[2px] left-[2px] grid size-[18px] place-items-center rounded-full transition-transform duration-200 {filled
        ? 'bg-on-accent text-accent'
        : 'bg-muted text-surface'} {checked ? 'translate-x-[18px]' : ''}"
    >
      {#if Icon}<Icon aria-hidden="true" class="size-3" strokeWidth={2.25} />{/if}
    </span>
  </span>
  {#if !hideLabel && labelPosition === "end"}<span>{label}</span>{/if}
</button>

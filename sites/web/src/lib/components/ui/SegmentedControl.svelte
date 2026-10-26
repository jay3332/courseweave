<script lang="ts" module>
  import type { IconComponent } from "./types";

  export interface Segment {
    value: string;
    label: string;
    icon?: IconComponent;
    /** Show only the icon; the label stays as the accessible name. */
    iconOnly?: boolean;
  }
</script>

<script lang="ts">
  let {
    options,
    value = $bindable(),
    label,
    size = "md",
    full = false,
    onchange,
    class: className = "",
  }: {
    options: readonly Segment[];
    value?: string;
    /** Accessible name for the group. */
    label: string;
    /**
     * The whole control's height, as the buttons beside it: sm 40px on phones and 36px from 1024px (the toolbars'
     * buttons and compact selects), md 40px.
     */
    size?: "sm" | "md";
    /** Fill the container's width, the segments sharing it equally (filters in a rail). */
    full?: boolean;
    onchange?: (value: string) => void;
    class?: string;
  } = $props();

  let group = $state<HTMLElement>();
  const selected = $derived(value ?? options.at(0)?.value);

  function choose(index: number): void {
    const option = options[((index % options.length) + options.length) % options.length];
    if (option === undefined) return;
    value = option.value;
    onchange?.(option.value);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[options.indexOf(option)]?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    const current = options.findIndex((option) => option.value === selected);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") choose(current + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") choose(current - 1);
    else return;
    event.preventDefault();
  }
</script>

<div
  bind:this={group}
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  {onkeydown}
  class="{full ? 'flex w-full' : 'inline-flex shrink-0'} {size === 'sm'
    ? 'h-10 lg:h-9'
    : 'h-10'} items-stretch gap-0.5 rounded-full border border-line-strong bg-surface p-0.5 {className}"
>
  {#each options as option, index (option.value)}
    {@const isSelected = option.value === selected}
    <!-- The focus ring sits inside the segment rather than over the group's border. -->
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={option.iconOnly === true ? option.label : undefined}
      title={option.iconOnly === true ? option.label : undefined}
      tabindex={isSelected ? 0 : -1}
      onclick={() => choose(index)}
      class="inline-flex items-center justify-center gap-1.5 rounded-full transition-colors focus-visible:-outline-offset-2 {full
        ? 'flex-1 whitespace-nowrap'
        : ''} {size === 'sm'
        ? 'min-w-9 px-2.5 text-label-md lg:min-w-8 [&_svg]:size-4'
        : 'px-3 text-label-md [&_svg]:size-4'} {isSelected
        ? 'bg-line text-strong'
        : 'text-muted hover:bg-hover hover:text-ink'}"
    >
      {#if option.icon}<option.icon aria-hidden="true" />{/if}
      {#if option.iconOnly !== true}{option.label}{/if}
    </button>
  {/each}
</div>

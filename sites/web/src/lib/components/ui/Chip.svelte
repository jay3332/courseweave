<script lang="ts" module>
  export type ChipTone = "outline" | "soft" | "neutral" | "ok" | "warn" | "accent" | "strong";
  export type ChipSize = "xs" | "sm" | "md" | "lg";
</script>

<script lang="ts">
  import { X } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import type { IconComponent } from "./types";

  let {
    tone = "outline",
    size = "md",
    shape = "tag",
    icon: Icon,
    label,
    href,
    onremove,
    removeLabel,
    onclick,
    pressed,
    title,
    attrs = {},
    class: className = "",
    children,
  }: {
    /**
     * outline: bordered (filter chips, course codes); soft: page-colored fill (Figma "SCS Dept" tag);
     * neutral: line fill (reservation tags); ok / warn: requisite states; accent: filled brand pill;
     * strong: inverted (active "Filter 3" pill).
     */
    tone?: ChipTone;
    /**
     * xs: 20px, 10px text (phone tags); sm: 20px, 12px text; md: 25px (the Figma default); lg: 32px, 40px on phones
     * (pills to tap, such as the semesters offering a course). Pick a size rather than setting a height with `class`:
     * the two heights' order in the stylesheet, not in the class list, decides which one applies.
     */
    size?: ChipSize;
    shape?: "tag" | "pill";
    icon?: IconComponent;
    /** Text content; also used to name the remove button. Use `children` for richer content. */
    label?: string;
    /** Render as a link. External links open in a new tab. */
    href?: string;
    /** Makes the chip a removable filter chip: the whole chip is a button that removes it. */
    onremove?: () => void;
    /** Accessible name for the remove button. Defaults to "Remove {label}". */
    removeLabel?: string;
    /** Makes the chip a button (with `pressed` for toggles). */
    onclick?: (event: MouseEvent) => void;
    pressed?: boolean;
    title?: string;
    /** Extra attributes for the chip's element, such as a course preview (`coursePreview()`). */
    attrs?: Record<string, string>;
    class?: string;
    children?: Snippet;
  } = $props();

  const tones: Record<ChipTone, string> = {
    outline: "border border-pressed bg-transparent text-strong",
    soft: "border border-transparent bg-paper text-strong",
    neutral: "border border-transparent bg-line text-ink",
    ok: "border border-transparent bg-ok-bg text-ink",
    warn: "border border-transparent bg-warn-bg text-ink",
    accent: "border border-transparent bg-accent text-on-accent",
    strong: "border border-transparent bg-strong text-surface",
  };
  const sizes: Record<ChipSize, string> = {
    xs: "h-5 gap-1 px-1.5 text-label-sm [&_svg]:size-3",
    sm: "h-5 gap-1 px-1.5 text-label-md [&_svg]:size-3",
    md: "h-[25px] gap-1 px-2 text-label-md [&_svg]:size-4",
    lg: "h-10 gap-1 px-3 text-label-md sm:h-8 [&_svg]:size-4",
  };
  const interactive = $derived(
    href !== undefined || onremove !== undefined || onclick !== undefined,
  );
  const classes = $derived(
    [
      "inline-flex max-w-full shrink-0 items-center whitespace-nowrap transition-colors",
      shape === "pill" ? "rounded-full" : "rounded-tag",
      // Pressed replaces the tone, the way a pressed ToggleChips pill looks: appending a fill to a tone that sets its
      // own leaves which one shows to the stylesheet's order.
      pressed === true ? "border border-line-strong bg-line text-strong" : tones[tone],
      sizes[size],
      interactive ? "hover:brightness-[0.97] hover:border-line-strong" : "",
      className,
    ].join(" "),
  );
  const external = $derived(href !== undefined && /^https?:/u.test(href));
</script>

{#snippet body()}
  {#if Icon}<Icon aria-hidden="true" />{/if}
  <span class="truncate">
    {#if children}{@render children()}{:else}{label}{/if}
  </span>
{/snippet}

{#if onremove}
  <button
    {...attrs}
    type="button"
    class={classes}
    aria-label={removeLabel ?? (label === undefined ? "Remove filter" : `Remove ${label}`)}
    {title}
    onclick={onremove}
  >
    {@render body()}
    <X aria-hidden="true" />
  </button>
{:else if href !== undefined}
  <a
    {...attrs}
    {href}
    class={classes}
    {title}
    target={external ? "_blank" : undefined}
    rel={external ? "noopener noreferrer" : undefined}
  >
    {@render body()}
    {#if external}<span class="sr-only">(opens in a new tab)</span>{/if}
  </a>
{:else if onclick}
  <button {...attrs} type="button" class={classes} {title} aria-pressed={pressed} {onclick}>
    {@render body()}
  </button>
{:else}
  <span {...attrs} class={classes} {title}>{@render body()}</span>
{/if}

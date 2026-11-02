<script lang="ts">
  // The theme and the light or dark choice, for the header's Appearance popover, the phone menu and Profile ›
  // Settings. Each theme is a radio drawn as a small preview in its own colors: page, card, a line of text and the
  // accent. Both choices are this device's.
  import SegmentedControl from "../ui/SegmentedControl.svelte";
  import { skin } from "./skin.svelte";
  import { SKINS } from "./skins";
  import { theme, type ThemePreference } from "./theme.svelte";

  let {
    columns = 2,
    compact = false,
  }: {
    columns?: 2 | 3;
    /** The phone menu: three to a row with their names only, so the account stays near the navigation. */
    compact?: boolean;
  } = $props();

  const id = $props.id();
  const MODES = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Device" },
  ];
  const forced = $derived(skin.current.modes === "both" ? null : skin.current.modes);
</script>

<div class="flex flex-col gap-4">
  <fieldset class="min-w-0">
    <legend class="mb-2 text-label-lg text-strong">Theme</legend>
    <div class="grid gap-2 {compact ? 'grid-cols-3' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}">
      {#each SKINS as s (s.id)}
        {@const look = (theme.darkFor(s.id) ? s.swatch.dark : s.swatch.light) ?? s.swatch.dark ?? s.swatch.light}
        {@const chosen = skin.id === s.id}
        <label
          class="flex cursor-pointer flex-col gap-1.5 rounded-field border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent {chosen
            ? 'border-accent bg-selected'
            : 'border-line hover:border-line-strong hover:bg-hover'}"
        >
          <input
            type="radio"
            name="{id}-skin"
            value={s.id}
            checked={chosen}
            onchange={() => skin.set(s.id)}
            class="sr-only"
          />
          {#if look}
            <!-- The theme in its own colors: the page, a card on it with a line of text, and the accent. -->
            <span
              aria-hidden="true"
              class="flex items-center rounded-[6px] border border-black/10 {compact ? 'h-7 p-1' : 'h-9 p-1.5'}"
              style:background={look[0]}
            >
              <span class="flex h-full flex-1 items-center gap-1.5 rounded-[4px] px-1.5" style:background={look[1]}>
                <span class="h-1.5 w-7 rounded-full opacity-80" style:background={look[3]}></span>
                <span class="ml-auto size-3 rounded-full" style:background={look[2]}></span>
              </span>
            </span>
          {/if}
          <span class="text-label-lg text-strong">{s.name}</span>
          <span class={compact ? "sr-only" : "text-label-md font-normal text-muted"}>{s.blurb}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="flex flex-col gap-1.5">
    <span id="{id}-mode" class="text-label-lg text-strong">Mode</span>
    <SegmentedControl
      options={MODES}
      label="Mode"
      full
      value={theme.preference}
      onchange={(value) => theme.set(value as ThemePreference)}
    />
    {#if forced}
      <p class="text-label-md font-normal text-muted">
        {skin.current.name} is always {forced}. Mode applies to the other themes.
      </p>
    {/if}
  </div>
</div>

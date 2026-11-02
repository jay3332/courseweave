<script lang="ts">
  // The header's Appearance button: a popover with the theme and the light or dark choice (AppearanceOptions). It
  // takes the place of the dark theme switch, which is its Mode setting now.
  import { Palette } from "@lucide/svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Popover from "../ui/Popover.svelte";
  import AppearanceOptions from "./AppearanceOptions.svelte";

  let open = $state(false);
</script>

<Popover bind:open label="Appearance" placement="bottom-end" class="w-[22rem] max-w-[calc(100vw-1rem)] p-3">
  {#snippet trigger(props)}
    <IconButton {...props} label="Appearance" tooltip icon={Palette} variant="outline" />
  {/snippet}
  {#snippet children()}
    <AppearanceOptions />
  {/snippet}
</Popover>

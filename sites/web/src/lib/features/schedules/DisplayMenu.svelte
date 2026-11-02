<!--
  What calendar blocks show besides the course code (the Figma's "Show" dropdown; Courseweave's DisplayMenu), and how
  the course list picks sections (dropdowns, or compact letters to hover through), behind a settings button at the end
  of the toolbar. Both are the student's preferences, so every calendar and schedule on the site follows them.
-->
<script lang="ts">
  import { Settings2 } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Popover from "$lib/components/ui/Popover.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import type { CalendarDisplay } from "$lib/core/state/store";
  import { preferences } from "$lib/state";

  let open = $state(false);
  const display = $derived(preferences.calendarDisplay);

  const OPTIONS: { key: keyof CalendarDisplay; label: string; hint: string }[] = [
    { key: "section", label: "Section", hint: "Lec 1, Rec A or Sec A next to the course number" },
    { key: "title", label: "Course name", hint: "Under the course number, when there is space" },
    { key: "time", label: "Meeting time", hint: "When the class is tall enough" },
    { key: "location", label: "Room", hint: "Building and room, when there is space" },
  ];
  const PICKERS = [
    { value: "dropdown", label: "Dropdowns" },
    { value: "compact", label: "Compact" },
  ];
</script>

<Popover bind:open label="Calendar display" placement="bottom-end" class="w-76 p-2">
  {#snippet trigger(props)}
    <!-- Named like Generate, Finals and Export beside it (an icon on phones, as Export is), and as tall: 40px on
         phones, 36px on desktops. -->
    <Button {...props} icon={Settings2} class="h-10 max-sm:w-10 max-sm:px-0 lg:h-9" title="Calendar display">
      <span class="max-sm:sr-only">Display</span>
    </Button>
  {/snippet}
  {#snippet children()}
    <p class="px-2 pt-1 pb-1 text-label-md font-normal text-muted">
      The course number is always shown. Choose what else each class shows on the calendar.
    </p>
    {#each OPTIONS as option (option.key)}
      <Checkbox
        checked={display[option.key]}
        label={option.label}
        description={option.hint}
        onchange={(event) =>
          preferences.setCalendarDisplay({ [option.key]: (event.currentTarget as HTMLInputElement).checked })}
        class="flex w-full rounded-tag py-1 pr-2 hover:bg-hover"
      />
    {/each}
    <div class="mt-2 border-t border-line px-2 pt-3 pb-1">
      <p class="mb-2 text-label-md font-normal text-muted">Pick sections in the course list with</p>
      <SegmentedControl
        label="Pick sections with"
        options={PICKERS}
        value={preferences.sectionPicker}
        onchange={(value) => preferences.setSectionPicker(value === "compact" ? "compact" : "dropdown")}
        size="sm"
        full
      />
    </div>
  {/snippet}
</Popover>

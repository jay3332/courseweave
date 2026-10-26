<script lang="ts">
  import { ArrowDownUp, ChartScatter } from "@lucide/svelte";
  import PageToolbar from "$lib/components/layout/PageToolbar.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import SearchInput from "$lib/components/ui/SearchInput.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import type { Option } from "$lib/components/ui/types";
  import ViewToggle, { type ListView } from "$lib/components/ui/ViewToggle.svelte";
  import type { FilterChip } from "./chips";
  import type { ExplorerUrl } from "./url-state.svelte";

  let {
    url,
    count,
    chipList,
    onreset,
    termOptions,
    termValue,
    onterm,
    sortOptions,
    sortValue,
    onsort,
    fceAvailable = false,
    chart = false,
    onchart,
    view = $bindable(),
    searchRef = $bindable(),
    allSemesters = false,
  }: {
    url: ExplorerUrl;
    /** "3,085 results"; omitted while loading. */
    count?: string;
    chipList: readonly FilterChip[];
    /** Clears the filters; shown at phone widths. */
    onreset?: () => void;
    termOptions: readonly Option[];
    termValue: string;
    onterm: (term: string) => void;
    sortOptions: readonly Option[];
    sortValue: string;
    onsort: (sort: string) => void;
    /** FCEs loaded: offer the hours chart. */
    fceAvailable?: boolean;
    chart?: boolean;
    onchart: (on: boolean) => void;
    view: ListView;
    searchRef?: HTMLInputElement;
    allSemesters?: boolean;
  } = $props();
</script>

<PageToolbar title="Search" hideTitle="desktop" {count} {onreset} actionsLayout="row">
  {#snippet search()}
    <SearchInput
      bind:value={url.searchText}
      bind:ref={searchRef}
      label="Search courses"
      placeholder={allSemesters
        ? "Search courses by ID, name or keyword..."
        : "Search courses by ID, description, name or keyword..."}
      aria-controls="course-results"
      aria-keyshortcuts="/"
    />
  {/snippet}
  {#snippet chips()}
    {#each chipList as chip (chip.key)}
      <Chip label={chip.label} onremove={() => url.update(chip.next)} />
    {/each}
  {/snippet}
  {#snippet actions()}
    <Select
      variant="compact"
      label="Semester"
      options={termOptions}
      bind:value={() => termValue, onterm}
      class="min-w-0 flex-1 sm:w-[9.75rem] sm:flex-none"
    />
    <Select
      variant="compact"
      label="Sort by"
      options={sortOptions}
      bind:value={() => sortValue, onsort}
      class="w-[11.5rem] max-sm:hidden"
    />
    <!-- Phones: an icon that opens the list of sorts, so long names aren't cut off. -->
    <Select
      label="Sort by"
      options={sortOptions}
      bind:value={() => sortValue, onsort}
      placement="bottom-end"
      class="shrink-0 sm:hidden"
    >
      {#snippet trigger(props, current)}
        <button
          {...props}
          title="Sort by: {current}"
          class="grid size-10 place-items-center rounded-full border border-line-strong text-ink transition-colors hover:bg-hover aria-expanded:bg-hover"
        >
          <ArrowDownUp aria-hidden="true" class="size-5" />
          <span class="sr-only">{current}</span>
        </button>
      {/snippet}
    </Select>
    {#if fceAvailable}
      <IconButton
        label={chart ? "Show courses as cards or a list" : "Chart FCE hours against units"}
        icon={ChartScatter}
        size="md"
        variant="outline"
        pressed={chart}
        onclick={() => onchart(!chart)}
        class="max-sm:hidden lg:size-9"
      />
    {/if}
    <ViewToggle
      pageKey="courses"
      bind:value={
        () => view,
        (next) => {
          view = next;
          if (chart) onchart(false);
        }
      }
    />
  {/snippet}
</PageToolbar>

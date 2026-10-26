<script lang="ts">
  // The plan page's band above the semesters (decision 44): the plan's name as the page title (click to rename), a
  // switcher beside it listing the student's plans and "New plan", and the plan's options (rename, duplicate, send to
  // and import from Stellic, delete). On phones, where the rail with the
  // programs and numbers is a sheet, the button that opens it and the plan's progress in a line.
  // Courseweave's features/degree/PlanHeader.tsx.
  import { Check, ChevronDown, Copy, FileUp, LayoutGrid, Pencil, Plus, Send, Table2, Trash2 } from "@lucide/svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import FilterButton from "$lib/components/layout/FilterButton.svelte";
  import { getRail } from "$lib/components/layout/rail-context";
  import SendToStellicDialog from "$lib/components/stellic/SendToStellicDialog.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import { planPath } from "$lib/core/routes";
  import SioImportButton from "$lib/features/record/SioImportButton.svelte";
  import { plans, preferences } from "$lib/state";
  import { planPage } from "./context";
  import DegreeProgressBar from "./DegreeProgressBar.svelte";
  import MenuItem from "./MenuItem.svelte";
  import { planNumbers } from "./numbers";
  import OptionsMenu from "./OptionsMenu.svelte";

  const page = planPage();
  /** The layout switch shows only its icons below wide desktops. */
  const roomy = new MediaQuery("(min-width: 1280px)");
  const rail = getRail();
  const plan = $derived(page.plan);
  const progress = $derived(rail?.asSheet === true ? planNumbers(page).progress : null);

  let renaming = $state(false);
  let name = $state("");
  let nameInput = $state<HTMLInputElement>();
  let confirmDelete = $state(false);
  let sending = $state(false);
  let importer = $state<SioImportButton>();

  function startRename(): void {
    name = plan.name;
    renaming = true;
    void tick().then(() => {
      nameInput?.focus();
      nameInput?.select();
    });
  }

  function finishRename(save: boolean): void {
    if (!renaming) return;
    const next = name.trim();
    if (save && next !== "" && next !== plan.name) plans.renamePlan(plan.id, next);
    renaming = false;
  }

  function go(id: string): void {
    plans.setActivePlan(id);
    void goto(planPath(id), { keepFocus: true, noScroll: true });
  }

  function newPlan(): void {
    go(plans.createPlan({ startTerm: plan.startTerm, programs: plan.programs.map((p) => Object.assign({}, p)) }));
  }
</script>

<!-- The plan's name as the title and its switcher, with the semester layout and the plan's options on the right. -->
<div class="flex items-center justify-between gap-3">
  <div class="flex min-w-0 flex-1 items-center gap-1">
    {#if renaming}
      <input
        bind:this={nameInput}
        bind:value={name}
        aria-label="Plan name"
        maxlength={120}
        onblur={() => finishRename(true)}
        onkeydown={(event) => {
          if (event.key === "Enter") finishRename(true);
          if (event.key === "Escape") {
            event.preventDefault();
            finishRename(false);
          }
        }}
        class="focus-field -ml-2 h-10 w-full max-w-md min-w-0 rounded-field border border-line-strong bg-surface px-2 text-heading-4 text-strong"
      />
    {:else}
      <h1 class="-ml-2 min-w-0">
        <button
          type="button"
          title="Rename plan"
          aria-label="{plan.name}, rename"
          onclick={startRename}
          class="flex max-w-full min-w-0 items-center rounded-field px-2 py-0.5 text-left hover:bg-hover"
        >
          <span class="truncate text-heading-4 text-strong">{plan.name}</span>
        </button>
      </h1>
    {/if}
    <OptionsMenu label="Switch plan" icon={ChevronDown} placement="bottom-start" size="md">
      {#snippet children(close)}
        <p class="px-3.5 pt-1 pb-1 text-label-md text-muted">Your plans</p>
        {#each plans.list as p (p.id)}
          <button
            type="button"
            aria-current={p.id === plan.id ? "true" : undefined}
            onclick={() => {
              close();
              if (p.id !== plan.id) go(p.id);
            }}
            class="flex min-h-10 w-full items-center gap-3 px-3.5 py-1.5 text-left text-body-2 text-ink outline-none hover:bg-paper focus-visible:bg-paper md:min-h-9"
          >
            <Check aria-hidden="true" class="size-4 shrink-0 text-accent-ink {p.id === plan.id ? '' : 'invisible'}" />
            <span class="truncate {p.id === plan.id ? 'font-semibold' : ''}">{p.name}</span>
          </button>
        {/each}
        <div role="separator" class="my-1.5 h-px bg-line"></div>
        <MenuItem icon={Plus} onclick={() => { close(); newPlan(); }}>New plan</MenuItem>
      {/snippet}
    </OptionsMenu>
  </div>
  <div class="flex shrink-0 items-center gap-2">
  <SegmentedControl
    label="Semester layout"
    size="sm"
    value={page.layout}
    onchange={(v) => preferences.setPlanLayout(v === "table" ? "table" : "cards")}
    options={[
      { value: "cards", label: "Cards", icon: LayoutGrid, iconOnly: !roomy.current },
      { value: "table", label: "Detailed", icon: Table2, iconOnly: !roomy.current },
    ]}
  />
  <!-- As tall as the layout switch: 40px, 36px from 1024px. -->
  <OptionsMenu label="Plan options" variant="outline" size="md" class="lg:size-9">
    {#snippet children(close)}
      <MenuItem icon={Pencil} onclick={() => { close(); startRename(); }}>Rename</MenuItem>
      <MenuItem icon={Copy} onclick={() => { close(); go(plans.duplicatePlan(plan.id)); }}>Duplicate</MenuItem>
      <MenuItem icon={Send} onclick={() => { close(); sending = true; }}>Send to Stellic</MenuItem>
      <MenuItem icon={FileUp} onclick={() => { close(); importer?.choose(); }}>Import from Stellic</MenuItem>
      <div role="separator" class="my-1.5 h-px bg-line"></div>
      <MenuItem icon={Trash2} danger onclick={() => { close(); confirmDelete = true; }}>Delete plan</MenuItem>
    {/snippet}
  </OptionsMenu>
  </div>
</div>
{#if rail?.asSheet}
  <div class="mt-3 flex flex-col gap-3">
    <FilterButton class="self-start" />
    {#if progress}<DegreeProgressBar {progress} compact />{/if}
  </div>
{/if}

<SioImportButton
  bind:this={importer}
  hidden
  onplancreated={go}
  onimported={(message) => {
    if (message) toast(message, { kind: "success" });
  }}
/>

<Dialog bind:open={confirmDelete} title="Delete plan" size="sm">
  <p class="text-body-2 text-ink">Delete {plan.name}? Your academic record isn't affected.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button
      variant="danger"
      icon={Trash2}
      onclick={() => {
        const removed = plan.name;
        plans.deletePlan(plan.id);
        confirmDelete = false;
        toast(`Deleted ${removed}.`);
        void goto(planPath(plans.activeId));
      }}
    >
      Delete plan
    </Button>
  {/snippet}
</Dialog>

<SendToStellicDialog
  bind:open={sending}
  mode="plan"
  initialId={plan.id}
  courseTitle={(id) => page.lookup(id).title ?? page.lookup(id).code}
/>

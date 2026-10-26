<script lang="ts">
  // Courses from other schools that CMU accepted, against a CMU equivalent or as general elective units.
  // Courseweave's TransferSection (features/record/TransferSection.tsx).
  import { Plus, Trash2 } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import TextInput from "$lib/components/ui/TextInput.svelte";
  import type { Option } from "$lib/components/ui/types";
  import { transferEntry, unitsError } from "$lib/core/record/forms";
  import { coursePath } from "$lib/core/routes";
  import { termLabel } from "$lib/core/requisites";
  import { record } from "$lib/state";
  import CoursePicker from "./CoursePicker.svelte";
  import type { RecordData } from "./record-data.svelte";
  import RecordSection from "./RecordSection.svelte";

  let { data }: { data: RecordData } = $props();

  let general = $state(false);
  let courseId = $state<string | null>(null);
  let label = $state("");
  let units = $state("");
  let institution = $state("");
  let termCode = $state("");
  let added = $state<string | null>(null);

  const transfers = $derived(record.entries.filter((e) => e.source === "transfer"));
  const draft = $derived(transferEntry({ general, courseId, label, units, institution, term: termCode }));
  const unitsMessage = $derived(unitsError(units));
  const termOptions = $derived<Option[]>([
    { value: "", label: "Before CMU" },
    ...data.termChoices(record.profile.entryTerm).map((t) => ({ value: t, label: termLabel(t) })),
  ]);

  function add(): void {
    if (draft === null) return;
    record.addEntry(draft);
    added = draft.courseId === null ? `Added ${draft.label ?? "transfer credit"}.` : `Added ${data.lookup(draft.courseId).code}.`;
    courseId = null;
    label = "";
    units = "";
  }
</script>

<RecordSection
  id="record-transfer"
  title="Transfer credit"
>
  <div class="flex flex-col gap-4 rounded-card border border-pressed bg-surface p-5">
    <Checkbox
      bind:checked={general}
      label="No CMU equivalent (general elective units)"
      class="font-normal"
      onchange={() => (added = null)}
    />
    <div class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_96px]">
      {#if general}
        <TextInput label="Description" bind:value={label} hint="For example: Calculus III at Pitt, free elective" />
      {:else}
        <CoursePicker
          label="CMU equivalent"
          bind:value={courseId}
          {data}
          onpick={(id) => {
            added = null;
            units = id === null ? "" : String(data.lookup(id).units ?? "");
          }}
        />
      {/if}
      <TextInput
        label="Units"
        inputmode="decimal"
        bind:value={units}
        placeholder={!general && courseId !== null && data.lookup(courseId).units === null ? "VAR" : ""}
        error={unitsMessage ?? undefined}
      />
    </div>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
      <TextInput label="Institution (optional)" bind:value={institution} />
      <Select label="Semester (optional)" hideLabel={false} options={termOptions} bind:value={termCode} />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="primary" icon={Plus} disabled={draft === null} onclick={add}>Add transfer credit</Button>
      <p class="text-body-2" aria-live="polite">
        {#if added !== null}
          <span class="text-ok">{added}</span>
        {:else if draft === null && unitsMessage === null && general}
          <span class="text-muted">Describe the credit and enter its units.</span>
        {/if}
      </p>
    </div>
  </div>

  {#if transfers.length === 0}
    <p class="rounded-card border border-dashed border-line-strong px-4 py-5 text-body-2 text-muted">
      No transfer credit yet.
    </p>
  {:else}
    <ul class="divide-y divide-line overflow-hidden rounded-card border border-pressed bg-surface">
      {#each transfers as e (e.id)}
        {@const info = e.courseId === null ? null : data.lookup(e.courseId)}
        {@const u = e.units ?? info?.units ?? 0}
        <li class="flex items-start gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <p class="flex min-w-0 items-baseline gap-2">
              {#if info && e.courseId !== null}<a href={coursePath(e.courseId)} class="tabular shrink-0 text-label-lg text-strong hover:text-accent-ink hover:underline">{info.code}</a>{/if}
              <span class="min-w-0 truncate text-body-2 text-ink">{e.label ?? info?.title ?? "Transfer credit"}</span>
            </p>
            <p class="text-body-2 text-muted">
              {[`${u} units`, e.institution, e.term === undefined ? null : termLabel(e.term)]
                .filter((x) => x !== null && x !== undefined && x !== "")
                .join(", ")}
            </p>
          </div>
          <IconButton
            label="Remove {info?.code ?? e.label ?? 'transfer credit'}"
            icon={Trash2}
            onclick={() => record.removeEntry(e.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</RecordSection>

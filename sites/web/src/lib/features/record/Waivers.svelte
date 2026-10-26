<script lang="ts">
  // Placements (counted as taken for prerequisites, no units) and requisite overrides (permission to take a course
  // without its requisites). Courseweave's WaiversSection (features/record/WaiversSection.tsx).
  import { Plus, Trash2 } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import TextInput from "$lib/components/ui/TextInput.svelte";
  import { placementEntry } from "$lib/core/record/forms";
  import { coursePath } from "$lib/core/routes";
  import { record } from "$lib/state";
  import CoursePicker from "./CoursePicker.svelte";
  import type { RecordData } from "./record-data.svelte";
  import RecordSection from "./RecordSection.svelte";

  let { data }: { data: RecordData } = $props();

  type Flag = "prereqs" | "coreqs" | "antireqs";
  const FLAGS: { key: Flag; label: string; plain: string }[] = [
    { key: "prereqs", label: "Prerequisites", plain: "prerequisites" },
    { key: "coreqs", label: "Corequisites", plain: "corequisites" },
    { key: "antireqs", label: "Anti-requisites", plain: "anti-requisites" },
  ];

  let placedId = $state<string | null>(null);
  let placedNote = $state("");
  let overrideId = $state<string | null>(null);
  let flags = $state<Record<Flag, boolean>>({ prereqs: true, coreqs: false, antireqs: false });
  let overrideNote = $state("");

  // Placements that came from an exam are listed with the exam.
  const placements = $derived(record.entries.filter((e) => e.source === "waiver" && e.exam === undefined));
  const overrideList = $derived(
    Object.entries(record.overrides).toSorted((a, b) => a[0].localeCompare(b[0])),
  );
  const placement = $derived(placementEntry(placedId, placedNote));
  const anyFlag = $derived(flags.prereqs || flags.coreqs || flags.antireqs);

  function addPlacement(): void {
    if (placement === null) return;
    record.addEntry(placement);
    placedId = null;
    placedNote = "";
  }

  function addOverride(): void {
    if (overrideId === null || !anyFlag) return;
    const note = overrideNote.trim();
    record.setOverride(overrideId, { ...flags, ...(note === "" ? {} : { note }) });
    overrideId = null;
    overrideNote = "";
  }
</script>

<RecordSection
  id="record-waivers"
  title="Placements and overrides"
>
  <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
    <section aria-labelledby="record-placements" class="flex flex-col gap-4 rounded-card border border-pressed bg-surface p-5">
      <h3 id="record-placements" class="text-heading-6 text-strong">Placed out of a course</h3>
      <CoursePicker label="Course" bind:value={placedId} {data} />
      <TextInput label="Note (optional)" bind:value={placedNote} hint="For example: math placement exam, language placement" />
      <div>
        <Button variant="primary" icon={Plus} disabled={placement === null} onclick={addPlacement}>Add placement</Button>
      </div>
      {#if placements.length === 0}
        <p class="rounded-field border border-dashed border-line-strong px-4 py-4 text-body-2 text-muted">
          No placements yet.
        </p>
      {:else}
        <ul class="divide-y divide-line rounded-field border border-line">
          {#each placements as e (e.id)}
            {@const info = data.lookup(e.courseId ?? "")}
            <li class="flex items-start gap-3 px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="flex min-w-0 items-baseline gap-2">
                  {#if e.courseId === null}
                    <span class="tabular shrink-0 text-label-lg text-strong">{info.code}</span>
                  {:else}
                    <a href={coursePath(e.courseId)} class="tabular shrink-0 text-label-lg text-strong hover:text-accent-ink hover:underline">{info.code}</a>
                  {/if}
                  <span class="min-w-0 truncate text-body-2 text-ink">{info.title ?? ""}</span>
                </p>
                {#if e.note}<p class="text-body-2 text-muted">{e.note}</p>{/if}
              </div>
              <IconButton label="Remove placement for {info.code}" icon={Trash2} onclick={() => record.removeEntry(e.id)} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="record-overrides" class="flex flex-col gap-4 rounded-card border border-pressed bg-surface p-5">
      <h3 id="record-overrides" class="text-heading-6 text-strong">Requisite override</h3>
      <CoursePicker label="Course you have permission to take" bind:value={overrideId} {data} />
      <fieldset class="flex flex-col">
        <legend class="mb-1 text-label-lg text-ink">Waive its</legend>
        {#each FLAGS as flag (flag.key)}
          <Checkbox bind:checked={flags[flag.key]} label={flag.label} class="min-h-10 font-normal" />
        {/each}
      </fieldset>
      <TextInput label="Note (optional)" bind:value={overrideNote} hint="For example: instructor permission, advisor approved" />
      <div>
        <Button variant="primary" icon={Plus} disabled={overrideId === null || !anyFlag} onclick={addOverride}>
          Save override
        </Button>
      </div>
      {#if overrideList.length === 0}
        <p class="rounded-field border border-dashed border-line-strong px-4 py-4 text-body-2 text-muted">
          No overrides yet. You can also waive requisites from a course's requisite details.
        </p>
      {:else}
        <ul class="divide-y divide-line rounded-field border border-line">
          {#each overrideList as [id, o] (id)}
            {@const info = data.lookup(id)}
            {@const waived = FLAGS.filter((f) => o[f.key] === true).map((f) => f.plain)}
            <li class="flex items-start gap-3 px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="flex min-w-0 items-baseline gap-2">
                  <a href={coursePath(id)} class="tabular shrink-0 text-label-lg text-strong hover:underline">{info.code}</a>
                  <span class="min-w-0 truncate text-body-2 text-ink">{info.title ?? ""}</span>
                </p>
                <p class="text-body-2 text-muted">
                  Waives {waived.join(" and ")}{o.note === undefined ? "" : `. ${o.note}`}
                </p>
              </div>
              <IconButton label="Remove override for {info.code}" icon={Trash2} onclick={() => record.setOverride(id, null)} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</RecordSection>

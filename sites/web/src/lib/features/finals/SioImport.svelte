<!--
  The student's own final exams from SIO: download the calendar export from SIO, upload the .ics file here
  (`POST /api/finals/import?term=`), see what was found and remove it. For courses the registrar's file lacks, or
  exams it hasn't scheduled yet. Signed in only.
-->
<script lang="ts">
  import { Download, LogIn, Trash2, Upload } from "@lucide/svelte";
  import { api } from "$lib/api";
  import type { FinalExam } from "$lib/api/types";
  import Button from "$lib/components/ui/Button.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import { session } from "$lib/data";
  import { coursePath } from "$lib/core/routes";
  import { formatTimeRange } from "$lib/core/time";
  import { examDay, fromSio } from "./finals";

  let {
    termId,
    termName,
    imported,
    onchange,
  }: {
    termId: string;
    termName: string;
    /** The current import (empty when there is none). */
    imported: readonly FinalExam[];
    /** The import changed; the new list. */
    onchange: (exams: FinalExam[]) => void;
  } = $props();

  const SIO_EXPORT = "https://s3.andrew.cmu.edu/sio/index.html";
  let input = $state<HTMLInputElement>();
  let busy = $state(false);
  let status = $state("");

  async function upload(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    busy = true;
    status = `Reading ${file.name}`;
    try {
      const exams = await api.finals.importCalendar(termId, file);
      onchange(exams);
      status = `Found ${exams.length} final ${exams.length === 1 ? "exam" : "exams"} for ${termName}.`;
      toast(status, { kind: "success" });
    } catch (error) {
      status = "";
      toast(
        `Couldn't import that calendar. ${error instanceof Error ? error.message : ""} Check that it's the .ics export from SIO for ${termName}.`,
        { kind: "error" },
      );
    } finally {
      busy = false;
      if (input) input.value = "";
    }
  }

  async function remove(): Promise<void> {
    busy = true;
    try {
      await api.finals.clearImport(termId);
      onchange([]);
      status = "Removed your SIO import.";
    } catch (error) {
      toast(`Couldn't remove the import. ${error instanceof Error ? error.message : ""}`, { kind: "error" });
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <ol class="list-inside list-decimal text-body-2 text-ink">
    <li>Download your calendar export from SIO</li>
    <li>Import the .ics file below</li>
  </ol>
  <!-- In the steps' order: SIO's export (a new tab), then the upload. -->
  <div class="flex flex-wrap gap-3">
    <Button size="sm" icon={Download} href={SIO_EXPORT}>Export from SIO</Button>
    {#if session.status === "signed-in"}
      <input
        bind:this={input}
        type="file"
        accept=".ics,text/calendar"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        onchange={upload}
      />
      <Button variant="primary" size="sm" icon={Upload} loading={busy} onclick={() => input?.click()}>
        Upload SIO calendar
      </Button>
    {:else}
      <Button variant="primary" size="sm" icon={LogIn} onclick={() => session.signIn()}>Sign in to upload</Button>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{status}</p>

  {#if imported.length > 0}
    <div class="rounded-card border border-line bg-surface">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <p class="min-w-0 flex-1 text-label-lg text-strong">
          From your SIO calendar: {imported.length} {imported.length === 1 ? "exam" : "exams"}
        </p>
        <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onclick={remove}>Remove</Button>
      </div>
      <ul class="divide-y divide-line">
        {#each imported.map(fromSio) as exam (exam.courseId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-body-2">
            <a href={coursePath(exam.code, termId)} class="tabular code-column font-semibold text-strong hover:underline"
              >{exam.code}</a
            >
            <span class="min-w-0 flex-1 text-ink">{examDay(exam.date)}, {formatTimeRange(exam.start, exam.end)}</span>
            <span class="text-label-md font-normal text-muted">{exam.location ?? "No room listed"}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

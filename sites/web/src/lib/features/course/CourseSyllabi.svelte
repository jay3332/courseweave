<script lang="ts">
  import { Download, ExternalLink, Eye, FileText } from "@lucide/svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { courseSyllabi } from "$lib/components/course/data.svelte";
  import MemberSignIn from "$lib/components/course/MemberSignIn.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
  import { syllabusPath } from "$lib/api";
  import { PREVIEWABLE_TYPES, registryTermLabel, type SyllabusEntry } from "$lib/core/syllabus-files";

  let { courseId, code }: { courseId: string; code: string } = $props();

  /** Semesters shown before "Show all". */
  const FIRST_TERMS = 3;

  const syllabi = $derived(courseSyllabi(courseId));
  // Phones and small tablets open PDFs in the browser's own viewer; a framed PDF there shows one page at best.
  const framed = new MediaQuery("(min-width: 768px) and (pointer: fine)");
  let showAll = $state(false);
  let preview = $state<SyllabusEntry | null>(null);
  let previewOpen = $state(false);

  const entries = $derived(syllabi.value ?? []);
  const terms = $derived.by(() => {
    const out: { term: string; entries: SyllabusEntry[] }[] = [];
    for (const s of entries) {
      const last = out.at(-1);
      if (last?.term === s.term) last.entries.push(s);
      else out.push({ term: s.term, entries: [s] });
    }
    return out;
  });
  const shown = $derived(showAll ? terms : terms.slice(0, FIRST_TERMS));
  const files = $derived(entries.filter((s) => s.key).length);

  const sizeText = (bytes: number): string =>
    bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  const sectionsText = (s: string[] | undefined): string =>
    s === undefined || s.length === 0 ? "All sections" : `${s.length === 1 ? "Section" : "Sections"} ${s.join(", ")}`;

  function open(entry: SyllabusEntry): void {
    preview = entry;
    previewOpen = true;
  }
</script>

<section aria-labelledby="course-syllabi" class="min-w-0">
  <h2 id="course-syllabi" class="text-heading-4 text-strong">Past syllabi</h2>
  {#if syllabi.status === "loading"}
    <Skeleton class="mt-2 h-12" />
  {:else if syllabi.status === "signin" || syllabi.status === "forbidden"}
    <MemberSignIn subject="past syllabi" reason={syllabi.status} class="mt-2" />
  {:else if syllabi.status === "error"}
    <p class="mt-1 text-body-2 text-danger">Past syllabi didn't load. Reload the page to try again.</p>
  {:else if entries.length === 0}
    <p class="mt-1 text-body-2 text-ink">
      None for {code} in CMU's syllabus registry, which goes back to summer 2019.
    </p>
  {:else}
    <p class="mt-0.5 mb-3 text-label-md text-muted">
      {files}
      {files === 1 ? "file" : "files"} from {terms.length}
      {terms.length === 1 ? "semester" : "semesters"}
    </p>
    <ul class="divide-y divide-line overflow-hidden rounded-card border border-pressed bg-surface">
      {#each shown as t (t.term)}
        <li class="px-4 py-3">
          <div class="text-label-lg text-strong">{registryTermLabel(t.term)}</div>
          <ul class="mt-1 flex flex-col gap-1">
            {#each t.entries as s (s.key ?? s.url)}
              <li class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-body-2">
                {#if !s.key}
                  <span class="min-w-0 flex-1 text-ink">
                    {sectionsText(s.sections)}
                    <span class="text-muted">on the course's Canvas site, which usually needs enrollment</span>
                  </span>
                  {#if s.url}
                    <Button size="sm" variant="ghost" icon={ExternalLink} href={s.url}>Canvas</Button>
                  {/if}
                {:else}
                  <span class="flex min-w-0 flex-1 items-center gap-2">
                    <FileText aria-hidden="true" class="size-4 shrink-0 text-muted" />
                    <span class="truncate text-ink">{sectionsText(s.sections)}</span>
                    <span class="tabular shrink-0 text-label-md text-muted uppercase">
                      {s.type}{s.size ? `, ${sizeText(s.size)}` : ""}
                    </span>
                  </span>
                  <span class="flex shrink-0 items-center">
                    {#if PREVIEWABLE_TYPES.has(s.type ?? "")}
                      {#if framed.current}
                        <Button size="sm" variant="ghost" icon={Eye} onclick={() => open(s)}>Preview</Button>
                      {:else}
                        <Button size="sm" variant="ghost" icon={Eye} href={syllabusPath(s.key)} target="_blank"
                          >Open</Button
                        >
                      {/if}
                    {/if}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Download}
                      href={syllabusPath(s.key, true)}
                      download=""
                      aria-label="Download {sectionsText(s.sections).toLowerCase()} syllabus ({s.type})"
                    >
                      Download
                    </Button>
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
    {#if terms.length > FIRST_TERMS}
      <button
        type="button"
        onclick={() => (showAll = !showAll)}
        class="mt-2 min-h-10 text-label-lg text-accent-ink underline-offset-2 hover:underline sm:min-h-8"
      >
        {showAll ? "Show fewer semesters" : `Show all ${terms.length} semesters`}
      </button>
    {/if}
  {/if}
</section>

<Dialog
  bind:open={previewOpen}
  size="lg"
  title={preview ? `${code} syllabus, ${registryTermLabel(preview.term)}` : "Syllabus"}
  onclose={() => (preview = null)}
>
  {#if preview?.key}
    <iframe
      title="{code} syllabus"
      src={syllabusPath(preview.key)}
      class="h-[70vh] w-full rounded-tag border border-line bg-surface-2"
    ></iframe>
  {/if}
  {#snippet footer()}
    {#if preview?.key}
      <Button icon={Download} href={syllabusPath(preview.key, true)} download="">Download</Button>
    {/if}
  {/snippet}
</Dialog>

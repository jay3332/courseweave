<script lang="ts">
  // "Find a course": a search over the whole catalog that opens the course's page, from the header's search button or
  // Ctrl+K (⌘K on a Mac) anywhere. Without it, looking up a course from the degree plan, a schedule or the profile
  // meant leaving for the Courses page, whose filters and semester could hide the course.
  import { Search } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import { findCourses } from "$lib/components/course/course-search";
  import { catalogIndex, offerings } from "$lib/components/course/data.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath } from "$lib/core/routes";
  import type { Course } from "$lib/core/types";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const id = $props.id();
  let query = $state("");
  let active = $state(0);

  // Loaded the first time the dialog opens (the documents are shared with the rest of the site).
  const index = $derived(open ? catalogIndex() : null);
  const offered = $derived(open ? offerings() : null);
  const results = $derived(index?.value ? findCourses(index.value, [], query, 8) : []);
  const typed = $derived(query.trim() !== "");

  /** The newest semester offering it ("Spring 2027"), or null when no built semester does. */
  function lastOffered(courseId: string): string | null {
    const latest = offered?.value?.byId.get(courseId)?.terms[0];
    return latest === undefined ? null : termLabel(latest);
  }

  function choose(course: Course): void {
    open = false;
    void goto(coursePath(course.code));
  }

  function onkeydown(event: KeyboardEvent): void {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") active = (active + 1) % results.length;
    else if (event.key === "ArrowUp") active = (active - 1 + results.length) % results.length;
    else if (event.key === "Enter") {
      const course = results[Math.min(active, results.length - 1)];
      if (course) choose(course);
    } else return;
    event.preventDefault();
  }

  /** Focuses the field once the dialog has opened, also when a shortcut opened it with nothing focused. */
  function focusOnOpen(node: HTMLInputElement): void {
    queueMicrotask(() => node.focus());
  }
</script>

<Dialog
  bind:open
  title="Find a course"
  size="md"
  onclose={() => {
    query = "";
    active = 0;
  }}
>
  <div class="flex flex-col gap-3">
    <label
      class="focus-field flex h-11 items-center gap-2 rounded-field border border-line-strong bg-paper px-3 text-ink"
    >
      <Search aria-hidden="true" class="size-5 shrink-0 text-muted" />
      <span class="sr-only">Course number, title or keyword</span>
      <input
        {@attach focusOnOpen}
        bind:value={query}
        oninput={() => (active = 0)}
        {onkeydown}
        placeholder="Number, title or keyword"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-expanded={typed && results.length > 0}
        aria-controls="{id}-list"
        aria-activedescendant={typed && results.length > 0 ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        class="h-10 min-w-0 flex-1 bg-transparent text-body-1 text-strong outline-none placeholder:text-muted"
      />
    </label>

    {#if index?.status === "loading"}
      <p class="flex items-center gap-2 text-body-2 text-muted" aria-live="polite">
        <Spinner size="sm" decorative /> Loading the course catalog
      </p>
    {:else if index?.status === "error"}
      <p class="text-body-2 text-danger">The course catalog didn't load. Reload the page to try again.</p>
    {:else if !typed}
      <p class="text-body-2 text-muted">Type a course number like 15-122, a title or a keyword. Enter opens the course.</p>
    {:else if results.length === 0}
      <p class="text-body-2 text-muted" aria-live="polite">No course matches "{query.trim()}".</p>
    {/if}

    <ul id="{id}-list" role="listbox" aria-label="Matching courses" class="flex flex-col {results.length ? '' : 'hidden'}">
      {#each results as course, i (course.id)}
        {@const last = lastOffered(course.id)}
        <!-- The field handles the keyboard (aria-activedescendant); clicks are for the mouse. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{id}-{i}"
          role="option"
          aria-selected={i === active}
          onmouseenter={() => (active = i)}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(course)}
          class="flex min-h-12 cursor-pointer flex-col justify-center rounded-field px-3 py-1.5 {i === active
            ? 'bg-paper'
            : ''}"
        >
          <span class="flex min-w-0 items-baseline gap-2">
            <span class="tabular shrink-0 text-label-lg text-strong">{course.code}</span>
            <span class="min-w-0 flex-1 truncate text-body-2 text-ink">{course.title}</span>
            {#if course.units !== null}<span class="tabular shrink-0 text-label-md text-muted">{course.units}u</span>{/if}
          </span>
          <span class="text-label-md font-normal text-muted">
            {last === null ? "Not offered in a recent semester" : `Offered ${last}`}
          </span>
        </li>
      {/each}
    </ul>
  </div>
</Dialog>

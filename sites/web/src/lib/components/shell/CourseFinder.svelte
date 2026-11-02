<script lang="ts">
  // "Find a course": a search over the whole catalog and, signed in, the instructors (finder.ts), from the header's
  // search button or Ctrl+K (Cmd+K on a Mac) anywhere. The field is the dialog's header; matches open the course's or
  // instructor's page. Without it, looking up a course from the degree plan, a schedule or the profile meant leaving
  // for the Courses page, whose filters and semester could hide the course.
  import { Search, X } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import { findCourses } from "$lib/components/course/course-search";
  import { catalogIndex, offerings } from "$lib/components/course/data.svelte";
  import { instructorSearchDocs } from "$lib/components/instructor/data.svelte";
  import { teachingSummary, type ListedInstructor } from "$lib/components/instructor/directory";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import HelpTip from "$lib/components/ui/HelpTip.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath, instructorPath } from "$lib/core/routes";
  import type { Course } from "$lib/core/types";
  import { findInstructors, parseFinderQuery } from "./finder";
  import { getSession } from "./session";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  type Match = { kind: "course"; course: Course } | { kind: "instructor"; inst: ListedInstructor };

  const id = $props.id();
  const session = getSession();
  let query = $state("");
  let active = $state(0);

  const signedIn = $derived(session.status === "signed-in");
  const parsed = $derived(parseFinderQuery(query));
  // Loaded the first time the dialog opens (the documents are shared with the rest of the site); instructors are
  // member data.
  const index = $derived(open ? catalogIndex() : null);
  const offered = $derived(open ? offerings() : null);
  const people = $derived(open && signedIn ? instructorSearchDocs() : null);

  const courses = $derived(
    parsed.instructorsOnly || !index?.value ? [] : findCourses(index.value, [], parsed.text, 6),
  );
  const instructors = $derived(
    people?.value
      ? findInstructors(people.value, parsed.text, parsed.instructorsOnly ? 8 : 3, !parsed.instructorsOnly)
      : [],
  );
  const matches = $derived<Match[]>([
    ...courses.map((course): Match => ({ kind: "course", course })),
    ...instructors.map((inst): Match => ({ kind: "instructor", inst })),
  ]);
  const both = $derived(courses.length > 0 && instructors.length > 0);
  const loading = $derived(
    parsed.instructorsOnly ? people?.status === "loading" : index?.status === "loading",
  );

  const tips = $derived(
    signedIn
      ? "Search courses by number, title or keyword, and instructors by name. Start with @ to search only instructors, also by a course they teach. Up and Down choose, Enter opens."
      : "Search courses by number, title or keyword. Up and Down choose, Enter opens.",
  );

  /** The newest semester offering it ("Spring 2027"), or null when no built semester does. */
  function lastOffered(courseId: string): string | null {
    const latest = offered?.value?.byId.get(courseId)?.terms[0];
    return latest === undefined ? null : termLabel(latest);
  }

  function choose(match: Match): void {
    open = false;
    void goto(match.kind === "course" ? coursePath(match.course.code) : instructorPath(match.inst.slug, "all"));
  }

  function onkeydown(event: KeyboardEvent): void {
    // Closes from the field itself too, not only through the dialog's own Escape.
    if (event.key === "Escape") {
      event.preventDefault();
      open = false;
      return;
    }
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") active = (active + 1) % matches.length;
    else if (event.key === "ArrowUp") active = (active - 1 + matches.length) % matches.length;
    else if (event.key === "Enter") {
      const match = matches[Math.min(active, matches.length - 1)];
      if (match) choose(match);
    } else return;
    event.preventDefault();
  }
</script>

{#snippet option(match: Match, i: number)}
  <!-- The field handles the keyboard (aria-activedescendant); clicks are for the mouse. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <li
    id="{id}-{i}"
    role="option"
    aria-selected={i === active}
    onmouseenter={() => (active = i)}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => choose(match)}
    class="flex min-h-12 cursor-pointer flex-col justify-center rounded-field px-3 py-1.5 {i === active
      ? 'bg-hover'
      : ''}"
  >
    {#if match.kind === "course"}
      {@const last = lastOffered(match.course.id)}
      <span class="flex min-w-0 items-baseline gap-2">
        <span class="tabular shrink-0 text-label-lg text-strong">{match.course.code}</span>
        <span class="min-w-0 flex-1 truncate text-body-2 text-ink">{match.course.title}</span>
        {#if match.course.units !== null}
          <span class="tabular shrink-0 text-label-md text-muted">{match.course.units}u</span>
        {/if}
      </span>
      <span class="text-label-md font-normal text-muted">
        {last === null ? "Not offered in a recent semester" : `Offered ${last}`}
      </span>
    {:else}
      <span class="truncate text-label-lg text-strong">{match.inst.name}</span>
      <span class="truncate text-label-md font-normal text-muted">{teachingSummary(match.inst.terms ?? [])}</span>
    {/if}
  </li>
{/snippet}

{#snippet group(label: string, from: number, items: Match[])}
  <li role="presentation">
    {#if both}<p id="{id}-{label}" class="px-3 pt-2 pb-1 text-label-md text-muted">{label}</p>{/if}
    <ul role="group" aria-labelledby={both ? `${id}-${label}` : undefined} aria-label={both ? undefined : label}>
      {#each items as match, n (match.kind === "course" ? match.course.id : match.inst.slug)}
        {@render option(match, from + n)}
      {/each}
    </ul>
  </li>
{/snippet}

<Dialog
  bind:open
  title={signedIn ? "Find a course or instructor" : "Find a course"}
  size="md"
  bodyClass="p-2"
  class="mt-[12dvh] mb-auto"
  onclose={() => {
    query = "";
    active = 0;
  }}
>
  {#snippet header()}
    <div class="flex items-center gap-2 pr-3 pl-4">
      <Search aria-hidden="true" class="size-5 shrink-0 text-muted" />
      <input
        data-autofocus
        bind:value={query}
        oninput={() => (active = 0)}
        {onkeydown}
        aria-label={signedIn ? "Course or instructor" : "Course number, title or keyword"}
        placeholder={signedIn ? "Search courses and instructors" : "Search courses"}
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls="{id}-list"
        aria-activedescendant={matches.length > 0 ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        class="ml-1 h-14 min-w-0 flex-1 bg-transparent text-body-1 text-strong outline-none placeholder:text-muted"
      />
      <HelpTip text={tips} label="Search tips" />
      <!-- Esc closes it; with a mouse the key is a button, on touch an X. -->
      <button
        type="button"
        aria-label="Close"
        onclick={() => (open = false)}
        class="grid h-6 shrink-0 place-items-center rounded-tag border border-line px-1.5 text-label-sm text-muted transition-colors hover:bg-hover hover:text-ink pointer-coarse:hidden"
      >
        Esc
      </button>
      <IconButton label="Close" icon={X} size="sm" class="pointer-fine:hidden" onclick={() => (open = false)} />
    </div>
  {/snippet}

  {#if loading}
    <p class="flex items-center gap-2 px-3 py-2 text-body-2 text-muted" aria-live="polite">
      <Spinner size="sm" decorative /> Loading
    </p>
  {:else if index?.status === "error" && !parsed.instructorsOnly}
    <p class="px-3 py-2 text-body-2 text-danger">The course catalog didn't load. Reload the page to try again.</p>
  {:else if parsed.instructorsOnly && !signedIn}
    <p class="px-3 py-2 text-body-2 text-muted">Sign in with your CMU account to search instructors.</p>
  {:else if parsed.text === ""}
    <p class="px-3 py-2 text-body-2 text-muted">
      {parsed.instructorsOnly ? "Type an instructor's name." : "Type a course number like 15-122."}
    </p>
  {:else if matches.length === 0}
    <p class="px-3 py-2 text-body-2 text-muted" aria-live="polite">
      No {parsed.instructorsOnly ? "instructor" : signedIn ? "course or instructor" : "course"} matches "{parsed.text}".
    </p>
  {/if}

  <ul id="{id}-list" role="listbox" aria-label="Matches" class="flex flex-col {matches.length ? '' : 'hidden'}">
    {#if courses.length > 0}{@render group("Courses", 0, matches.slice(0, courses.length))}{/if}
    {#if instructors.length > 0}{@render group("Instructors", courses.length, matches.slice(courses.length))}{/if}
  </ul>
</Dialog>

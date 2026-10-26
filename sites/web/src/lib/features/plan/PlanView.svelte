<script lang="ts">
  // A degree plan in the rail layout (decision 44): the rail with the programs, numbers and requisite problems; the
  // record prompt, the plan's title row and the semester grid; and the requirements beside the semesters when the
  // main column has room, or at the end of the rail (its sheet on phones) when it doesn't. Loads what the plan needs and provides it to every part of the
  // page. Courseweave's PlanView in features/degree/PlanPage.tsx.
  import { GraduationCap, Info, LogIn, Maximize2, RotateCw } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import RailGroup from "$lib/components/layout/RailGroup.svelte";
  import HelpTip from "$lib/components/ui/HelpTip.svelte";
  import RailLayout from "$lib/components/layout/RailLayout.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import type { Term } from "$lib/core/data";
  import {
    courseHref,
    currentTerm,
    fceHours,
    planDerived,
    publishedTerms,
    scheduledCourses,
  } from "$lib/core/degree/hooks";
  import { suggestTerm, type Plan } from "$lib/core/plan";
  import { auditData } from "$lib/core/programs";
  import { courseLookup } from "$lib/core/record/hooks";
  import { codeOf } from "$lib/core/requisite-format";
  import { termLabel } from "$lib/core/requisites";
  import { coursePath } from "$lib/core/routes";
  import type { TermIndexEntry } from "$lib/core/types";
  import { catalog, resource, session } from "$lib/data";
  import RecordPrompt from "$lib/features/record/RecordPrompt.svelte";
  import { links, personal, preferences, record, schedules } from "$lib/state";
  import { setPlanPage, type DragItem } from "./context";
  import PlanHeader from "./PlanHeader.svelte";
  import PlanRail from "./PlanRail.svelte";
  import RequirementsPanel from "./RequirementsPanel.svelte";
  import SemesterGrid from "./SemesterGrid.svelte";

  let {
    plan,
    routed,
    terms,
  }: {
    plan: Plan;
    /** The semester being browsed, once loaded. */
    routed: Term | null;
    /** Every built semester. */
    terms: TermIndexEntry[];
  } = $props();

  /** The main column's width (without its padding) from which the requirements get a column of their own beside the
   *  semesters; below it they sit at the end of the rail, so the semesters keep the whole column. */
  const WIDE_MIN = 1120;
  const DRAG_HINT = "Drag a course onto a semester, or use Add.";
  const current = currentTerm();
  const compactQuery = new MediaQuery("(max-width: 767px)");
  const dragQuery = new MediaQuery("(pointer: fine) and (min-width: 768px)");
  // Before the main column is measured, guess from the window: wide enough beside an open rail.
  const wideQuery = new MediaQuery("(min-width: 1680px)");
  let mainWidth = $state(0);
  /** The semesters and the requirements fit side by side in the main column. */
  const wide = $derived(mainWidth > 0 ? mainWidth >= WIDE_MIN : wideQuery.current);

  const index = resource(() => catalog.catalogIndex());
  const offerings = resource(() => catalog.offerings());
  const fce = resource(() => catalog.fceSummary());
  const catalogIndex = $derived(index.value ?? null);
  const published = $derived(publishedTerms(terms));

  // Course ids on each plan semester's published schedule, for offering hints and suggestions.
  const termsKey = $derived(plan.terms.map((t) => t.term).join(","));
  const publishedKey = $derived(terms.map((t) => t.id).join(","));
  const scheduledRes = resource(() => {
    // Reload when the plan's semesters or the built semesters change.
    const ids = termsKey === "" ? [] : termsKey.split(",");
    const built = new Set(publishedKey === "" ? [] : publishedKey.split(","));
    return scheduledCourses(ids, built, (id) => catalog.term(id));
  });
  const scheduled = $derived(scheduledRes.value ?? new Map<string, Set<string>>());

  // The selected programs' requirements: loaded again only when the programs change.
  const programsKey = $derived(JSON.stringify(plan.programs));
  const versions = resource(() =>
    programsKey === "[]" ? null : catalog.auditVersions(untrack(() => plan.programs)),
  );

  const recordLike = $derived({ entries: record.entries, overrides: record.overrides });
  const hours = $derived(fceHours(fce.value));
  const view = $derived(
    planDerived({
      plan,
      schedules: schedules.items,
      record: recordLike,
      catalog: catalogIndex,
      term: routed,
      fceHours: hours,
      current,
    }),
  );
  const data = $derived.by(() => {
    const loaded = versions.value;
    if (view === null || plan.programs.length === 0 || loaded === undefined) return null;
    if (!plan.programs.every((p) => loaded.has(p.auditId))) return null;
    const result = auditData(view.auditInput, loaded, catalogIndex);
    return result.status === "ready" ? result.value : null;
  });
  const auditError = $derived.by(() => {
    if (versions.status === "error") return versions.error;
    const loaded = versions.value;
    if (view === null || loaded === undefined || data !== null) return null;
    const result = auditData(view.auditInput, loaded, catalogIndex);
    return result.status === "error" ? result.error : null;
  });

  const lookup = $derived(courseLookup(routed, catalogIndex));
  const routedHref = $derived(routed === null ? null : courseHref(routed, offerings.value));
  function href(id: string, term: string | null = null): string {
    return routedHref === null ? coursePath(id, term) : routedHref(id, term);
  }

  let openTerms = $state<Record<string, boolean>>({});
  let dragging = $state<DragItem | null>(null);
  let expanded = $state(false);

  function isOpen(term: string): boolean {
    const col = view?.columns.find((c) => c.term === term);
    return openTerms[term] ?? col?.phase !== "past";
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function jumpTo(planCourseId: string, term: string): void {
    openTerms = { ...openTerms, [term]: true };
    const fromDialog = expanded;
    expanded = false;
    // After the semesters render, and after the dialog has closed and handed focus back.
    setTimeout(
      () => {
        const el = document.getElementById(`plan-course-${planCourseId}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus({ preventScroll: true });
        // Flash the row red so it stands out; restart the animation when the same row is jumped to again.
        if (el) {
          el.classList.remove("animate-flash-danger");
          void el.offsetWidth;
          el.classList.add("animate-flash-danger");
          clearTimeout(flashTimer);
          flashTimer = setTimeout(() => el.classList.remove("animate-flash-danger"), 1600);
        }
      },
      fromDialog ? 120 : 30,
    );
  }

  function addSuggested(courseId: string): void {
    if (view === null) return;
    const target = suggestTerm(
      view.resolved,
      courseId,
      view.catalog,
      view.current,
      view.unitsOf,
      (t) => scheduled.get(t),
      undefined,
      recordLike,
    );
    if (target === null) {
      toast("Add a semester to the plan first.", { kind: "error" });
      return;
    }
    const id = links.addToTerm(plan, target, courseId);
    toast(`Added ${codeOf(courseId)} to ${termLabel(target)}.`, { kind: "success" });
    jumpTo(id, target);
  }

  setPlanPage({
    get plan() {
      return plan;
    },
    get derived() {
      // PlanView renders only with a plan, so the derivation always exists here.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      return view!;
    },
    get catalog() {
      return catalogIndex;
    },
    get routed() {
      return routed;
    },
    get record() {
      return recordLike;
    },
    get audit() {
      return data?.result ?? null;
    },
    get scheduled() {
      return scheduled;
    },
    get published() {
      return published;
    },
    get layout() {
      return preferences.planLayout;
    },
    get dragEnabled() {
      return dragQuery.current;
    },
    get compact() {
      return compactQuery.current;
    },
    get dragging() {
      return dragging;
    },
    lookup: (id) => lookup(id),
    href: (id, term) => href(id, term),
    fceHours: (id) => hours(id),
    isOpen,
    toggleTerm: (term) => {
      openTerms = { ...openTerms, [term]: !isOpen(term) };
    },
    jumpTo,
    addSuggested,
    startDrag: (item) => {
      dragging = item;
    },
    endDrag: () => {
      dragging = null;
    },
  });
</script>

<RailLayout
  title="Plan"
  showTitle={false}
  name="plan panel"
  sheetLabel="Programs"
  sheetButtonLabel={wide ? "Programs and progress" : "Programs and requirements"}
  sheetIcon={GraduationCap}
  backLabel="Plan"
  storageKey="plan"
>
  {#snippet rail()}
    <PlanRail />
    <!-- Below the wide layout the requirements live in the rail (and in its sheet on phones). -->
    {#if !wide}
      <RailGroup title="Requirements">
        {#snippet action()}
          <span class="flex items-center gap-1">
            {#if dragQuery.current && plan.programs.length > 0}<HelpTip
                label="Adding courses"
                text={DRAG_HINT}
              />{/if}
            <Button size="sm" variant="ghost" icon={Maximize2} onclick={() => (expanded = true)}>Expand</Button>
          </span>
        {/snippet}
        <RequirementsPanel {data} status={versions.status} error={auditError} drag={dragQuery.current} flat />
      </RailGroup>
    {/if}
  {/snippet}

  <!-- The semesters sit beside the requirements when this column has room for both, whatever the rail does. -->
  <div bind:clientWidth={mainWidth} class="flex flex-col gap-5">
    {#if personal.mode === "draft" && session.status === "signed-out"}
      <div class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-warn-bg px-4 py-3" role="note">
        <Info aria-hidden="true" class="size-5 shrink-0 text-warn" />
        <p class="min-w-0 flex-1 text-body-2 text-ink">
          <strong class="font-semibold">Not saved.</strong> You're signed out, so this plan is kept in this tab only.
          Sign in to save it to your account and to check it against your degree requirements.
        </p>
        <Button size="sm" variant="primary" icon={LogIn} onclick={() => session.signIn()}>Sign in</Button>
      </div>
    {:else if personal.status === "error" || personal.status === "offline"}
      <div class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-danger-bg px-4 py-3" role="alert">
        <p class="min-w-0 flex-1 text-body-2 text-ink">
          {personal.status === "offline"
            ? "You're offline. Your changes are kept here and saved when you're back online."
            : (personal.error ?? "Couldn't save your changes.")}
        </p>
        <Button size="sm" icon={RotateCw} onclick={() => personal.retry()}>Retry</Button>
      </div>
    {/if}
    {#if record.isEmpty}
      <RecordPrompt>
        Your record is empty, so this plan isn't counting past courses or AP, IB or transfer credit toward requirements
        yet.
      </RecordPrompt>
    {/if}

    {#if wide}
      <div
        class="grid items-start gap-6 {preferences.planLayout === 'table'
          ? 'grid-cols-[minmax(0,1fr)_clamp(300px,30%,560px)]'
          : 'grid-cols-[minmax(0,1fr)_clamp(320px,34%,600px)]'}"
      >
        <div class="flex min-w-0 flex-col gap-5">
          <PlanHeader />
          <SemesterGrid />
        </div>
        <!-- The column scrolls, so it reaches 12px left and up into the gap, padded back, to keep the focus rings of
             the rows' chevrons and the Expand button inside its scroll box; and down through the page's bottom
             padding, so at the page's end it meets the footer. Stuck, its scroll box runs from the site header to the
             bottom of the screen, so what scrolls out goes under the header or off the screen (fading at both edges)
             rather than being cut off short of them. -->
        <aside
          aria-labelledby="requirements-heading"
          class="scrollbar-thin sticky top-[var(--header-h)] -mt-3 -mb-5 -ml-3 flex max-h-[calc(100dvh-var(--header-h))] flex-col gap-3 overflow-y-auto overscroll-contain pt-3 pr-1 pb-5 pl-3 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-1rem),transparent)] lg:-mb-8 lg:pb-8"
        >
          <div class="flex items-center gap-2">
            <h2 id="requirements-heading" class="text-heading-5 text-strong">Requirements</h2>
            {#if dragQuery.current && plan.programs.length > 0}<HelpTip label="Adding courses" text={DRAG_HINT} />{/if}
            <Button size="sm" variant="ghost" icon={Maximize2} class="ml-auto" onclick={() => (expanded = true)}>
              Expand
            </Button>
          </div>
          <RequirementsPanel {data} status={versions.status} error={auditError} drag={dragQuery.current} />
        </aside>
      </div>
    {:else}
      <PlanHeader />
      <SemesterGrid />
    {/if}
  </div>
</RailLayout>

<Dialog bind:open={expanded} title="Requirements" size="lg">
  <RequirementsPanel {data} status={versions.status} error={auditError} />
</Dialog>

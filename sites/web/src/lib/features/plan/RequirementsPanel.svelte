<script lang="ts">
  // The requirements column: the audit of the plan against its programs, with courses to add or drag onto a
  // semester. Signed out, degree programs ask to sign in. Courseweave's AuditColumn (features/degree/AuditArea.tsx).
  import type { ResourceStatus } from "$lib/data";
  import { session } from "$lib/data";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import type { AuditData } from "$lib/core/programs";
  import { requirementCoursesPath } from "$lib/core/routes";
  import AuditPanel from "./audit/AuditPanel.svelte";
  import type { TreeContext } from "./audit/tree";
  import { planPage } from "./context";
  import SignInNote from "./SignInNote.svelte";

  let {
    data,
    status,
    error,
    drag = false,
    flat = false,
  }: {
    /** The audit, once every selected program's requirements are loaded. */
    data: AuditData | null;
    /** How loading the requirements went. */
    status: ResourceStatus;
    error: string | null;
    /** Beside the semesters: unplanned courses can be dragged onto one. */
    drag?: boolean;
    /** In the rail: the programs without cards (AuditPanel's `flat`). */
    flat?: boolean;
  } = $props();

  const page = planPage();
  const plan = $derived(page.plan);
  const base = $derived<Omit<TreeContext, "node" | "auditId" | "catalog" | "inPlan">>({
    termName: page.routed?.meta.name ?? "this semester",
    offered: (id) => page.routed?.courseById.has(id) ?? false,
    title: (id) => page.lookup(id).title,
    units: (id) => page.lookup(id).units,
    hours: (id) => page.fceHours(id),
    href: (id, term) => page.href(id, term),
    requirementHref: (auditId, nodeId) => requirementCoursesPath({ auditId, nodeId }, page.routed?.meta.id),
    onAddCourse: (id) => page.addSuggested(id),
    dragCourses: drag,
    onDragStart: (courseId) => page.startDrag({ kind: "add", courseId }),
    onDragEnd: () => page.endDrag(),
  });
</script>

<!-- A named container: requirement rows lay out by the panel's width (the column, the tab or the dialog). -->
<div class="@container/req">
  {#if status === "signin" || status === "forbidden" || (plan.programs.length === 0 && session.status !== "signed-in")}
    <SignInNote title="Sign in to check requirements" forbidden={status === "forbidden"} />
  {:else if plan.programs.length === 0}
    <div class="rounded-card border border-pressed bg-surface">
      <AuditPanel input={page.derived.auditInput} data={null} {base} />
    </div>
  {:else}
    <div aria-live="polite" aria-busy={data === null && status !== "error"}>
      {#if data}
        <AuditPanel input={page.derived.auditInput} {data} {base} {flat} />
      {:else if status === "error"}
        <p role="alert" class="rounded-card border border-danger/35 bg-surface px-4 py-3 text-body-2 text-danger">
          Couldn't load the requirements. {error ?? ""} Reload the page to try again.
        </p>
      {:else}
        <p class="flex items-center gap-2 py-6 text-body-2 text-muted">
          <Spinner size="sm" decorative /> Checking requirements
        </p>
      {/if}
    </div>
  {/if}
</div>

<script lang="ts">
  import { page } from "$app/state";
  import { parseCourseCode } from "$lib/core/data";
  import RequisitesExplorer from "$lib/features/course/RequisitesExplorer.svelte";

  // `/requisites` starts from the gateway courses; `/requisites/15-122` centers on a course.
  const courseId = $derived.by(() => {
    const code = page.params.code;
    if (code === undefined || code === "") return null;
    const digits = parseCourseCode(code);
    return /^\d{5}$/u.test(digits) ? digits : code;
  });
  const requestedTerm = $derived(page.url.searchParams.get("term"));
  // `?view=list` or `?view=graph` opens that view (the course page's "Prerequisite tree" link asks for the graph);
  // otherwise the device's last choice, and the graph on a device that hasn't chosen.
  const requestedView = $derived.by(() => {
    const view = page.url.searchParams.get("view");
    return view === "graph" || view === "list" ? view : null;
  });
</script>

<RequisitesExplorer {courseId} {requestedTerm} {requestedView} />

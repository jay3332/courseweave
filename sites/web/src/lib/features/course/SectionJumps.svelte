<script lang="ts">
  // "Jump to": the course page's sections as links under its header. The page runs six screens or more, with the
  // course evaluations, past syllabi and prerequisites three or more screens down; these put each one click away.
  import Chip from "$lib/components/ui/Chip.svelte";

  let {
    sections,
    class: className = "",
  }: {
    /** The sections the page shows, in page order: the id of each one's heading and a short name. */
    sections: { id: string; label: string }[];
    class?: string;
  } = $props();

  /** What scrolls `element`: its nearest scrolling ancestor, or null when that's the page. */
  function scrollBox(element: HTMLElement): HTMLElement | null {
    for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
      if (/auto|scroll/u.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  }

  // In a panel that scrolls on its own (the course list's), only the panel moves, so the list beside it stays where
  // it was; on the page, the link's own jump does it, with the section in the address. Either way the section's
  // scroll margin keeps its heading clear of what sticks above it.
  function onclick(event: MouseEvent): void {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    const target = link ? document.getElementById(link.hash.slice(1)) : null;
    if (!target) return;
    const box = scrollBox(target);
    if (box === null) return;
    event.preventDefault();
    const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const top = box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top - margin;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    // Where a link's own jump would put the focus, so the keyboard and screen readers continue from the section.
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
</script>

<!-- The links handle the keyboard themselves (Enter clicks them); the nav only adjusts where their clicks scroll. -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<nav aria-label="On this page" class="flex flex-wrap items-center gap-2 {className}" {onclick}>
  <span class="text-label-md text-muted">Jump to</span>
  <ul class="contents">
    {#each sections as section (section.id)}
      <!-- Outlined: the page background is the soft tone's fill, so soft chips read as plain text here. -->
      <li><Chip tone="outline" size="lg" href="#{section.id}">{section.label}</Chip></li>
    {/each}
  </ul>
</nav>

// A sticky column that scrolls on its own, such as the course panel beside the list or the plan's requirements, is as
// tall as the screen allows once it sticks. Until the page scrolls it up to there it starts lower, under a toolbar or a
// banner, so at that height it ran past the bottom of the screen: scrolling inside it stopped short of its end, and as
// its overscroll is contained, the page didn't scroll to show the rest.

/**
 * The attachment for such a column: keeps `--room-below` at the room between its top and the bottom of the screen, for
 * its max height to stay within (`min()` with the height it has once stuck), so its end is always on screen.
 */
export function roomBelow(node: HTMLElement): () => void {
  let frame = 0;
  function measure(): void {
    frame = 0;
    node.style.setProperty(
      "--room-below",
      `${Math.floor(window.innerHeight - node.getBoundingClientRect().top)}px`,
    );
  }
  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(measure);
  }
  measure();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  // Whatever is above it changing height (a banner closing, a toolbar wrapping) moves its top without a scroll.
  const observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}

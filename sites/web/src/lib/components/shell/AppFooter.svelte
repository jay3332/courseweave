<script lang="ts">
  // A personal instance's footer: it says plainly that this isn't ScottyLabs' own site, credits them, and points
  // feedback and the source (GPL-3.0) at this instance's repository.
  import { MessageSquareText } from "@lucide/svelte";
  import Button from "../ui/Button.svelte";

  const FEEDBACK_URL = "https://github.com/jay3332/courseweave/issues";
  const SOURCE_URL = "https://github.com/jay3332/courseweave/tree/scottylabs";
  const UPSTREAM_URL = "https://git.cmu.dev/ScottyLabs/courses";
  const SCOTTYLABS_URL = "https://scottylabs.org";
</script>

<footer class="border-t border-line bg-paper">
  <div
    class="flex min-h-[81px] flex-col items-start gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-[34px] sm:py-4"
  >
    <div class="text-body-2 text-muted">
      <p>
        An unofficial instance of <a href={UPSTREAM_URL} class="hover:text-ink hover:underline">CMU Courses</a> by
        <a href={SCOTTYLABS_URL} class="hover:text-ink hover:underline">ScottyLabs</a>, run by jay3332.
      </p>
      <p>
        Its <a href={SOURCE_URL} class="hover:text-ink hover:underline">source</a> is on GitHub under the GPL.
      </p>
    </div>
    <Button href={FEEDBACK_URL} icon={MessageSquareText} class="shrink-0">Feedback</Button>
  </div>
</footer>

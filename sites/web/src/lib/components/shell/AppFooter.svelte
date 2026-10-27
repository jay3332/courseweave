<script lang="ts">
  // A personal instance's footer: it says plainly that this isn't ScottyLabs' own site, credits them, and points
  // feedback and the source (GPL-3.0) at this instance's repository. It folds to a one-line bar, remembered on the
  // device, for students who'd rather have the room.
  import { ChevronDown, ChevronUp, MessageSquareText } from "@lucide/svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { readLocal, writeLocal } from "../ui/storage";

  const FEEDBACK_URL = "https://github.com/jay3332/courseweave/issues";
  const SOURCE_URL = "https://github.com/jay3332/courseweave";
  const UPSTREAM_URL = "https://git.cmu.dev/ScottyLabs/courses";
  const SCOTTYLABS_URL = "https://scottylabs.org";
  const KEY = "footer-collapsed";

  let collapsed = $state(readLocal(KEY) === "1");

  function toggle(): void {
    collapsed = !collapsed;
    writeLocal(KEY, collapsed ? "1" : null);
  }
</script>

<footer class="border-t border-line bg-paper">
  {#if collapsed}
    <div class="flex h-10 items-center justify-between gap-4 px-4 text-label-md font-normal text-muted sm:px-[34px]">
      <p>
        Unofficial instance of <a href={UPSTREAM_URL} class="hover:text-ink hover:underline">CMU Courses</a> by
        <a href={SCOTTYLABS_URL} class="hover:text-ink hover:underline">ScottyLabs</a>
      </p>
      <IconButton label="Show footer" icon={ChevronUp} size="sm" tooltip onclick={toggle} />
    </div>
  {:else}
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
      <div class="flex shrink-0 items-center gap-2">
        <Button href={FEEDBACK_URL} icon={MessageSquareText}>Feedback</Button>
        <IconButton label="Hide footer" icon={ChevronDown} tooltip onclick={toggle} />
      </div>
    </div>
  {/if}
</footer>

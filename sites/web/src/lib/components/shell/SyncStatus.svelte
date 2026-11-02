<script lang="ts">
  // Whether the student's changes have reached their account, beside Sign out (Courseweave's AccountMenu status):
  // quiet while saved or saving, and a retry when a save failed or the browser is offline.
  import { CircleAlert, CloudCheck, CloudOff, RefreshCw } from "@lucide/svelte";
  import type { ShellSync } from "./session";

  let {
    sync,
    compact = false,
    class: className = "",
  }: {
    sync: ShellSync;
    /** Phones: the icon (and Retry) only; the text stays for screen readers. */
    compact?: boolean;
    class?: string;
  } = $props();

  // A cloud, as Offline's, so "Saved" reads as reaching the account rather than as the saved courses.
  const LOOKS = {
    saved: { text: "Saved", icon: CloudCheck, tone: "text-muted" },
    saving: { text: "Saving\u2026", icon: RefreshCw, tone: "text-muted" },
    offline: { text: "Offline", icon: CloudOff, tone: "text-warn" },
    error: { text: "Not saved", icon: CircleAlert, tone: "text-danger" },
  } as const;
  const look = $derived(LOOKS[sync.status]);
  const problem = $derived(sync.status === "error" || sync.status === "offline");
  const detail = $derived.by(() => {
    if (sync.status === "offline") return "You're offline. Changes stay in this tab and save when you reconnect.";
    if (sync.status === "error") return `Some changes didn't save${sync.error ? `: ${sync.error}` : "."}`;
    return sync.status === "saved" ? "Everything is saved to your account." : "Saving your changes.";
  });
</script>

<div class="flex items-center gap-1.5 text-label-md {look.tone} {className}">
  <span role="status" class="inline-flex items-center gap-1.5" title={detail}>
    <look.icon aria-hidden="true" class="size-4 shrink-0 {sync.status === 'saving' ? 'animate-spin' : ''}" />
    <span class={compact ? "sr-only" : ""}>{look.text}</span>
    <span class="sr-only">{detail}</span>
  </span>
  {#if problem}
    <button
      type="button"
      onclick={() => sync.retry()}
      class="inline-flex min-h-10 items-center rounded-full px-1.5 font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent lg:min-h-8"
    >
      Retry
    </button>
  {/if}
</div>

<script lang="ts">
  import { EyeOff } from "@lucide/svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import { schedulesPath } from "$lib/core/routes";
  import type { Sharing } from "$lib/api";
  import { friendlyError } from "./friends";
  import { friends } from "./instance.svelte";

  // What accepted friends may see (`PUT /api/friends/sharing`). Both start off, and sharing is one-way.
  let { headingLevel = 2 }: { headingLevel?: 2 | 3 } = $props();

  const id = $props.id();
  const sharing = $derived(friends.sharing);
  let saving = $state<keyof Sharing | null>(null);

  async function set(key: keyof Sharing, on: boolean): Promise<void> {
    saving = key;
    try {
      await friends.setSharing({ [key]: on });
      toast(on ? "Friends can see this now." : "Friends no longer see this.", { kind: "success" });
    } catch (error) {
      toast(friendlyError(error, "Your sharing settings didn't save. Try again."), { kind: "error" });
    } finally {
      saving = null;
    }
  }
</script>

<section id="sharing" aria-labelledby="{id}-heading" class="scroll-mt-[calc(var(--header-h)+1rem)]">
  <svelte:element this={`h${headingLevel}`} id="{id}-heading" class="text-heading-6 text-strong">
    What friends can see
  </svelte:element>
  {#if sharing === null}
    <p class="mt-4 text-body-2 text-muted" aria-live="polite">Loading your sharing settings&hellip;</p>
  {:else}
    <ul class="mt-4 flex flex-col divide-y divide-line rounded-card border border-pressed bg-surface">
      <li class="flex items-start justify-between gap-4 p-4">
        <div class="min-w-0">
          <p id="{id}-courses" class="text-label-lg text-ink">Share my courses</p>
          <p id="{id}-courses-help" class="mt-0.5 text-body-2 text-muted">
            Friends see which courses you're taking each semester: courses in progress on your record, and courses in
            schedules you've made visible to friends. They show on friends' course pages and their Friends list.
          </p>
        </div>
        <Switch
          label="Share my courses"
          hideLabel
          checked={sharing.shareCourses}
          disabled={saving !== null}
          aria-describedby="{id}-courses-help"
          onchange={(on) => void set("shareCourses", on)}
        />
      </li>
      <li class="flex items-start justify-between gap-4 p-4">
        <div class="min-w-0">
          <p class="text-label-lg text-ink">Share my schedules</p>
          <p id="{id}-schedules-help" class="mt-0.5 text-body-2 text-muted">
            Friends can open schedules you've marked "Visible to friends", with their sections and meeting times.
            Private schedules stay private. Choose each schedule's visibility on the
            <a href={schedulesPath()} class="text-accent-ink underline underline-offset-2">Schedules</a> page.
          </p>
        </div>
        <Switch
          label="Share my schedules"
          hideLabel
          checked={sharing.shareSchedules}
          disabled={saving !== null}
          aria-describedby="{id}-schedules-help"
          onchange={(on) => void set("shareSchedules", on)}
        />
      </li>
    </ul>
    {#if !sharing.shareCourses && !sharing.shareSchedules}
      <p class="mt-3 flex items-center gap-2 text-label-md font-normal text-muted">
        <EyeOff aria-hidden="true" class="size-4 shrink-0" />Right now friends see only your name and Andrew ID.
      </p>
    {/if}
  {/if}
</section>

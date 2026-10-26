<script lang="ts">
  import { goto } from "$app/navigation";
  import { AlertTriangle, Check, CloudOff, LogIn, LogOut, RefreshCw, Trash2 } from "@lucide/svelte";
  import { getSession } from "$lib/components/shell/session";
  import { theme, type ThemePreference } from "$lib/components/shell/theme.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Dialog from "$lib/components/ui/Dialog.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import { session as account } from "$lib/data";
  import type { CalendarDisplay } from "$lib/core/state/store";
  import { personal, preferences } from "$lib/state";
  import type { SaveStatus } from "$lib/state";
  import { friends } from "$lib/features/friends/instance.svelte";

  // Profile, Settings: the account, appearance, calendar display, what friends see, and the student's data.
  const shell = getSession();
  const signedIn = $derived(shell.status === "signed-in");
  const user = $derived(account.user);

  const themes = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  // Courseweave's calendar display options; every calendar follows them.
  const DISPLAY: { key: keyof CalendarDisplay; label: string; hint: string }[] = [
    { key: "section", label: "Section", hint: "Lec 1, Rec A or Sec A next to the course number" },
    { key: "title", label: "Course name", hint: "Under the course number, when there's space" },
    { key: "time", label: "Meeting time", hint: "When the block is tall enough" },
    { key: "location", label: "Room", hint: "Building and room, when there's space" },
  ];

  const STATUS: Record<SaveStatus, { text: string; icon: typeof Check; tone: string }> = {
    saved: { text: "Everything is saved to your account.", icon: Check, tone: "text-ok" },
    saving: { text: "Saving your changes.", icon: RefreshCw, tone: "text-muted" },
    offline: {
      text: "You're offline. Changes are kept in this tab and saved when you reconnect.",
      icon: CloudOff,
      tone: "text-warn",
    },
    error: { text: "Some changes didn't save.", icon: AlertTriangle, tone: "text-danger" },
  };
  const status = $derived(STATUS[personal.status]);

  $effect(() => {
    if (signedIn && friends.status === "idle") void friends.load();
  });

  let confirming = $state(false);
  let deleting = $state(false);
  let deleteFailed = $state(false);

  async function deleteData(): Promise<void> {
    deleting = true;
    deleteFailed = false;
    const done = await personal.deleteAccount();
    deleting = false;
    if (!done) {
      deleteFailed = true;
      return;
    }
    confirming = false;
    toast("Your data was deleted and you're signed out everywhere.", { kind: "success" });
    void goto("/");
  }

  function onOff(on: boolean | undefined): string {
    return on === true ? "On" : "Off";
  }
</script>

<div class="flex max-w-2xl flex-col gap-10">
  <section aria-labelledby="settings-account">
    <h2 id="settings-account" class="text-heading-6 text-strong">Account</h2>
    {#if signedIn && user}
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-body-2">
        <dt class="text-muted">Name</dt>
        <dd class="text-ink">{user.name}</dd>
        <dt class="text-muted">Andrew ID</dt>
        <dd class="text-ink">{user.andrewId}</dd>
        <dt class="text-muted">Email</dt>
        <dd class="break-all text-ink">{user.email}</dd>
      </dl>
      <p class="mt-3 flex items-start gap-2 text-body-2 text-ink" role="status">
        <status.icon aria-hidden="true" class="mt-0.5 size-4 shrink-0 {status.tone}" />
        <span>
          {status.text}
          {#if personal.status === "error" && personal.error}<span class="text-muted">{personal.error}</span>{/if}
        </span>
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        {#if personal.status === "error" || personal.status === "offline"}
          <Button icon={RefreshCw} onclick={() => personal.retry()}>Try saving again</Button>
        {/if}
        <Button icon={LogOut} onclick={() => shell.signOut()}>Sign out</Button>
      </div>
    {:else if shell.status === "loading"}
      <p class="mt-2 text-body-2 text-muted">Checking your session&hellip;</p>
    {:else}
      <p class="mt-2 text-body-2 text-ink">
        You're not signed in. Sign in with your Andrew ID to see instructors and course evaluations, save your schedules,
        plans and record to your account, and add friends.
      </p>
      <Button variant="primary" icon={LogIn} class="mt-4" onclick={() => shell.signIn()}>Sign in</Button>
    {/if}
  </section>

  <section aria-labelledby="settings-appearance">
    <h2 id="settings-appearance" class="text-heading-6 text-strong">Appearance</h2>
    <p class="mt-1 mb-3 text-body-2 text-muted">Theme for this device.</p>
    <SegmentedControl
      options={themes}
      label="Theme"
      value={theme.preference}
      onchange={(value) => theme.set(value as ThemePreference)}
    />
  </section>

  <section aria-labelledby="settings-calendar">
    <h2 id="settings-calendar" class="text-heading-6 text-strong">Calendar</h2>
    {#if !signedIn}<p class="mt-1 text-body-2 text-muted">Kept in this tab until you sign in.</p>{/if}
    <fieldset class="mt-3">
      <legend class="sr-only">Show on calendar classes</legend>
      <div class="flex flex-col gap-1">
        {#each DISPLAY as option (option.key)}
          <Checkbox
            label={option.label}
            description={option.hint}
            checked={preferences.calendarDisplay[option.key]}
            onchange={(event) => preferences.setCalendarDisplay({ [option.key]: event.currentTarget.checked })}
          />
        {/each}
      </div>
    </fieldset>
    <p class="mt-5 mb-2 text-body-2 text-ink">Pick sections in the schedule's course list with</p>
    <SegmentedControl
      options={[
        { value: "dropdown", label: "Dropdowns" },
        { value: "compact", label: "Compact" },
      ]}
      label="Pick sections with"
      value={preferences.sectionPicker}
      onchange={(value) => preferences.setSectionPicker(value === "compact" ? "compact" : "dropdown")}
    />
  </section>

  {#if signedIn}
    <section aria-labelledby="settings-sharing">
      <h2 id="settings-sharing" class="text-heading-6 text-strong">Friends and sharing</h2>
      <p class="mt-1 text-body-2 text-muted">What your accepted friends can see.</p>
      <dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-body-2 sm:max-w-sm">
        <dt class="text-ink">The courses you're taking</dt>
        <dd class="text-ink">{friends.sharing ? onOff(friends.sharing.shareCourses) : "Loading"}</dd>
        <dt class="text-ink">Schedules you've made visible to friends</dt>
        <dd class="text-ink">{friends.sharing ? onOff(friends.sharing.shareSchedules) : "Loading"}</dd>
      </dl>
      <Button href="/profile/friends#sharing" class="mt-4">Change what friends see</Button>
    </section>
  {/if}

  <section aria-labelledby="settings-data">
    <h2 id="settings-data" class="text-heading-6 text-strong">Your data</h2>
    <div class="mt-2 flex flex-col gap-3 text-body-2 text-ink">
      <p>
        <span class="font-semibold">In your account</span>, on the CMU Courses server run by ScottyLabs: your schedules,
        degree plans, academic record, saved courses, calendar and plan preferences, your friends and what you share
        with them, and your final exam calendar import. Imported SIO and Stellic PDFs are read in your browser; only the
        courses found in them are saved. Your name, Andrew ID and email come from CMU sign-in.
      </p>
      <p>
        <span class="font-semibold">On this device only</span>: the theme, cards or list choices, hidden panels and the
        last semester you visited. Signed out, anything you make is kept in this tab until you sign in or close it.
      </p>
      <p class="text-muted">
        Course listings, instructors and evaluations come from CMU and aren't part of your data.
      </p>
    </div>
    {#if signedIn}
      <Button variant="danger" icon={Trash2} class="mt-4" onclick={() => (confirming = true)}>Delete my data</Button>
    {/if}
  </section>
</div>

<Dialog bind:open={confirming} title="Delete your data?" size="sm" dismissible={!deleting}>
  <p class="text-body-2 text-ink">This permanently deletes, from the server:</p>
  <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-body-2 text-ink">
    <li>your schedules, share links, degree plans, academic record and saved courses</li>
    <li>your preferences and final exam import</li>
    <li>your friendships, requests and invite links; friends stop seeing you at once</li>
  </ul>
  <p class="mt-3 text-body-2 text-ink">
    It also signs you out on every device. It can't be undone. Signing in again later starts a new, empty account.
  </p>
  {#if deleteFailed}
    <p class="mt-3 text-body-2 text-danger" role="alert">
      Your data couldn't be deleted right now. Check your connection and try again.
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" disabled={deleting} onclick={() => (confirming = false)}>Cancel</Button>
    <Button variant="danger" icon={Trash2} loading={deleting} onclick={deleteData}>Delete my data</Button>
  {/snippet}
</Dialog>

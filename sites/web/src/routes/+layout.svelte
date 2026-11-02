<script lang="ts">
  import "./layout.css";
  import type { Snippet } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import { updated } from "$app/state";
  import AppFooter from "$lib/components/shell/AppFooter.svelte";
  import AppHeader from "$lib/components/shell/AppHeader.svelte";
  import PreviewLayer from "$lib/components/preview/PreviewLayer.svelte";
  import { setSession } from "$lib/components/shell/session";
  import { installUpdateReload, session } from "$lib/data";
  import { device, isAllSemesters, personal, trackOrigin } from "$lib/state";
  import { shellSession } from "$lib/state/shell-session";
  import { applySkin, skin } from "$lib/components/shell/skin.svelte";
  import { applyTheme, theme } from "$lib/components/shell/theme.svelte";
  import Toaster from "$lib/components/ui/Toaster.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import HeldDraftsDialog from "$lib/features/profile/HeldDraftsDialog.svelte";
  import RecordOnboarding from "$lib/features/record/RecordOnboarding.svelte";

  let { children }: { children: Snippet } = $props();

  // The shell reads the session through context: the data layer's session, with
  // sign-out saving the student's changes first.
  setSession(shellSession(session, personal));

  $effect(() => {
    applyTheme(theme.dark);
  });
  $effect(() => {
    applySkin(skin.id);
  });

  // A tab opened before a deploy reloads instead of failing to load the new build's pages.
  $effect(() => installUpdateReload());

  // Once a new build is out, offer to reload. Nothing is lost: the student's data is on the server, and changes not
  // saved yet are kept in the tab through a reload. The next link followed loads the new build anyway.
  let updateOffered = false;
  $effect(() => {
    if (!updated.current || updateOffered) return;
    updateOffered = true;
    toast("A new version of CMU Courses is available.", {
      action: { label: "Reload", run: () => location.reload() },
      duration: 0,
    });
  });

  // "Back to plan" and the remembered semester both follow navigation.
  afterNavigate(({ to }) => {
    if (!to) return;
    trackOrigin(to.url.pathname, to.url.search);
    const term = to.url.searchParams.get("term");
    if (term && !isAllSemesters(term)) device.rememberTerm(term);
  });

  // After the sign-in round trip, go back to the page the student signed in from.
  $effect(() => {
    if (session.status !== "signed-in") return;
    const path = session.consumeReturnPath();
    if (path) void goto(path, { replaceState: true });
  });
</script>

<div class="flex min-h-dvh flex-col">
  <a
    href="#main"
    class="sr-only z-50 rounded-full bg-surface px-4 py-2 text-label-lg text-ink shadow-popover focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
  >
    Skip to content
  </a>
  <AppHeader />
  <main id="main" tabindex="-1" class="flex min-w-0 flex-1 flex-col outline-none">
    {@render children()}
  </main>
  <AppFooter />
</div>
<Toaster />
<HeldDraftsDialog />
<RecordOnboarding />
<PreviewLayer />

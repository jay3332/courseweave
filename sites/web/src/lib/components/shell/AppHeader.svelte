<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import logo from "$lib/assets/logo.png";
  import { LogIn, LogOut, Menu, Search } from "@lucide/svelte";
  import Avatar from "../ui/Avatar.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Sheet from "../ui/Sheet.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import CourseFinder from "./CourseFinder.svelte";
  import { NAV_ITEMS, isActive } from "./nav";
  import { getSession } from "./session";
  import SyncStatus from "./SyncStatus.svelte";
  import ThemeSwitch from "./ThemeSwitch.svelte";

  const session = getSession();
  let menuOpen = $state(false);
  let finderOpen = $state(false);

  afterNavigate(() => {
    menuOpen = false;
  });

  // "Find a course" opens with Ctrl+K, or Cmd+K on a Mac, from any page.
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
  const shortcut = mac ? "\u2318K" : "Ctrl K";

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return;
    if (!(mac ? event.metaKey : event.ctrlKey)) return;
    // Not on top of another dialog (Generate schedules, say); the menu sheet makes way for it.
    if (!finderOpen && !menuOpen && document.querySelector("dialog:modal") !== null) return;
    event.preventDefault();
    menuOpen = false;
    finderOpen = true;
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<header
  class="sticky top-0 z-30 bg-surface shadow-header-mobile lg:bg-paper lg:shadow-header"
>
  <!-- Desktop: logo, centered icon-and-label navigation, theme switch and session pill. -->
  <div class="hidden h-[85px] grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 lg:grid">
    <a href="/" class="flex items-center gap-4 justify-self-start rounded-[6px]">
      <img src={logo} alt="" width="36" height="35" class="h-[35px] w-9 rounded-tag" />
      <span class="text-heading-6 text-ink max-xl:sr-only">CMU Courses</span>
    </a>
    <nav aria-label="Main">
      <ul class="flex items-center gap-5 xl:gap-8">
        {#each NAV_ITEMS as item (item.href)}
          {@const active = isActive(item, page.url.pathname)}
          <li>
            <a
              href={item.href}
              aria-current={active ? "page" : undefined}
              class="flex h-10 items-center gap-2 rounded-[6px] text-[15px] leading-6 font-medium transition-colors xl:gap-2.5 xl:text-heading-6 {active
                ? 'text-accent-ink'
                : 'text-muted hover:text-ink'}"
            >
              <item.icon aria-hidden="true" class="size-6" />
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
    <div class="flex items-center gap-4 justify-self-end">
      <!-- Signed in: whether changes have reached the account, a checkmark while all is saved, then the light or dark
           switch and Find a course beside Sign out. -->
      {#if session.status === "signed-in" && session.sync}
        <SyncStatus sync={session.sync} compact={session.sync.status === "saved" || session.sync.status === "saving"} />
      {/if}
      <span class="flex p-1.5"><ThemeSwitch /></span>
      <!-- An icon beside the navigation's labels until there's room to name it and show its shortcut and still keep
           the navigation centered and the site's name on one line. -->
      <button
        type="button"
        onclick={() => (finderOpen = true)}
        aria-haspopup="dialog"
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        title="Find a course ({shortcut})"
        class="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line-strong px-2.5 text-label-lg whitespace-nowrap text-muted transition-colors hover:bg-hover hover:text-ink 2xl:px-3"
      >
        <Search aria-hidden="true" class="size-5 shrink-0" />
        <span class="max-2xl:sr-only">Find a course</span>
        <kbd
          aria-hidden="true"
          class="hidden rounded-tag border border-line px-1.5 font-sans text-label-sm text-muted 2xl:inline">{shortcut}</kbd
        >
      </button>
      {#if session.status === "loading"}
        <Skeleton class="h-10 w-[110px] rounded-full" />
      {:else if session.status === "signed-in"}
        <Button
          icon={LogOut}
          title={session.name ? `Signed in as ${session.name}` : undefined}
          onclick={() => session.signOut()}
        >
          Sign out
        </Button>
      {:else}
        <Button icon={LogIn} onclick={() => session.signIn()}>Sign in</Button>
      {/if}
    </div>
  </div>

  <!-- Phones and tablets: menu button, logo, account. -->
  <div class="grid h-16 grid-cols-[1fr_auto_1fr] items-center px-3 lg:hidden">
    <IconButton
      label="Menu"
      icon={Menu}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      class="justify-self-start"
      onclick={() => (menuOpen = true)}
    />
    <a href="/" aria-label="CMU Courses" class="rounded-[10px]">
      <img src={logo} alt="" width="40" height="40" class="size-10 rounded-[10px]" />
    </a>
    <div class="flex items-center justify-self-end">
      <IconButton
        label="Find a course"
        icon={Search}
        aria-haspopup="dialog"
        class="mr-1"
        onclick={() => (finderOpen = true)}
      />
      {#if session.status === "loading"}
        <Skeleton variant="circle" class="size-[33px]" />
      {:else if session.status === "signed-in"}
        {#if session.sync && session.sync.status !== "saved"}
          <SyncStatus sync={session.sync} compact class="mr-1" />
        {/if}
        <a href="/profile" aria-label="Your profile" class="rounded-full">
          <Avatar name={session.name} size="sm" decorative class="size-[33px]! text-label-md!" />
        </a>
      {:else}
        <Button size="sm" icon={LogIn} onclick={() => session.signIn()}>Sign in</Button>
      {/if}
    </div>
  </div>
</header>

<Sheet bind:open={menuOpen} title="CMU Courses" side="left" class="lg:hidden">
  <nav aria-label="Main" class="px-3 py-3">
    <ul class="flex flex-col gap-1">
      {#each NAV_ITEMS as item (item.href)}
        {@const active = isActive(item, page.url.pathname)}
        <li>
          <a
            href={item.href}
            aria-current={active ? "page" : undefined}
            class="flex items-center gap-3 rounded-[8px] px-3 py-3 text-heading-6 transition-colors {active
              ? 'bg-paper text-accent-ink'
              : 'text-ink hover:bg-hover'}"
          >
            <item.icon aria-hidden="true" class="size-6" />
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="border-t border-line px-6 py-4">
    <ThemeSwitch showLabel class="w-full justify-between" />
  </div>
  <div class="border-t border-line px-6 py-4">
    {#if session.status === "signed-in"}
      <div class="mb-3 flex items-center gap-3">
        <Avatar name={session.name} size="md" decorative />
        <div class="min-w-0">
          <p class="truncate text-heading-6 text-strong">{session.name}</p>
          {#if session.detail}<p class="truncate text-body-2 text-muted">{session.detail}</p>{/if}
        </div>
      </div>
      {#if session.sync}<SyncStatus sync={session.sync} class="mb-3" />{/if}
      <Button icon={LogOut} full onclick={() => session.signOut()}>Sign out</Button>
    {:else if session.status === "signed-out"}
      <Button variant="primary" icon={LogIn} full onclick={() => session.signIn()}>Sign in</Button>
    {/if}
  </div>
</Sheet>

<CourseFinder bind:open={finderOpen} />

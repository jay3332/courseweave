<!--
  Getting a schedule out (Courseweave's ExportMenu): a calendar file for Google, Apple or Outlook calendars, an image
  of the week, the course list as text, a share link, and Stellic or SIO.
-->
<script lang="ts">
  import { CalendarArrowDown, ChevronDown, ClipboardList, Image, Link2, Send, Share } from "@lucide/svelte";
  import { calendarPng } from "$lib/components/calendar/calendar-image";
  import Button from "$lib/components/ui/Button.svelte";
  import { download } from "$lib/components/ui/download";
  import Menu, { type MenuEntry } from "$lib/components/ui/Menu.svelte";
  import { toast } from "$lib/components/ui/toast.svelte";
  import type { Term } from "$lib/core/data";
  import { buildIcs, hasScheduledMeetings } from "$lib/core/ics";
  import { partBlocks } from "$lib/core/planner/format";
  import type { ScheduleView } from "$lib/core/state/schedule-view";
  import type { Schedule } from "$lib/core/state/store";
  import { preferences } from "$lib/state";
  import { courseListText, fileName } from "./planner";

  let {
    schedule,
    view,
    term,
    onshare,
    onsend,
    oncopyfallback,
  }: {
    schedule: Schedule;
    view: ScheduleView;
    term: Term;
    onshare: () => void;
    onsend: () => void;
    /** The clipboard was blocked: show the text to copy by hand. */
    oncopyfallback: (text: string, title: string) => void;
  } = $props();

  const items = $derived(
    view.placed.flatMap((e) => e.parts.map((section) => ({ course: e.course, section }))),
  );
  const canDownload = $derived(hasScheduledMeetings(items));
  const base = $derived(`${fileName(schedule.name)} ${term.meta.id}`);

  function ics(): void {
    const text = buildIcs(items, term.meta, { calendarName: `${schedule.name} (${term.meta.name})` });
    download(new Blob([text], { type: "text/calendar;charset=utf-8" }), `${base}.ics`);
  }

  async function image(): Promise<void> {
    const blocks = view.placed.flatMap((e) =>
      e.parts.flatMap((p) => partBlocks(e.course, p, e.entry.color, { conflict: view.conflicts.has(e.course.id) })),
    );
    const units = view.units;
    try {
      const png = await calendarPng(blocks, {
        title: schedule.name,
        subtitle: `${term.meta.name} \u00B7 ${units.total} units \u00B7 ${view.entries.filter((e) => !e.entry.hidden).length} courses`,
        display: preferences.calendarDisplay,
      });
      download(png, `${base}.png`);
    } catch (error) {
      toast(`Couldn't make the image. ${error instanceof Error ? error.message : ""}`, { kind: "error" });
    }
  }

  async function copyList(): Promise<void> {
    const text = courseListText(view, schedule.name, term.meta.name);
    try {
      await navigator.clipboard.writeText(text);
      toast("Course list copied.", { kind: "success" });
    } catch {
      oncopyfallback(text, "Course list");
    }
  }

  const visible = $derived(view.entries.some((e) => !e.entry.hidden));
  const menuItems = $derived<MenuEntry[]>([
    {
      label: canDownload ? "Download calendar (.ics)" : "Download calendar (pick sections with set times first)",
      icon: CalendarArrowDown,
      disabled: !canDownload,
      onselect: ics,
    },
    { label: "Save as image (.png)", icon: Image, disabled: !visible, onselect: () => void image() },
    { label: "Copy course list", icon: ClipboardList, disabled: !visible, onselect: () => void copyList() },
    "separator",
    { label: "Share link and friends", icon: Link2, onselect: onshare },
    { label: "Send to Stellic or SIO", icon: Send, disabled: view.entries.length === 0, onselect: onsend },
  ]);
</script>

<Menu items={menuItems} label="Export {schedule.name}">
  {#snippet trigger(props)}
    <Button {...props} icon={Share} class="h-10 @max-[44rem]/toolbar:w-10 @max-[44rem]/toolbar:px-0 lg:h-9" title="Export">
      <span class="@max-[44rem]/toolbar:sr-only">Export</span>
      <ChevronDown aria-hidden="true" class="@max-[44rem]/toolbar:hidden" />
    </Button>
  {/snippet}
</Menu>

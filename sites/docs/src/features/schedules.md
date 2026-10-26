# Schedules and finals

The schedule planner is Courseweave's (`src/features/planner`, `src/features/schedule-tools`), on the Figma's
schedule page: the left rail with the course search, the courses and their totals; a band with the schedule tabs and
one toolbar row; and the week calendar.
Personal data goes through the `schedules`, `preferences`, `record`, `plans` and `saved` stores (`$lib/state`); the
pure logic is in `$lib/core` (`state/schedule-view.ts`, `planner/format.ts`, `generator.ts`, `ics.ts`, `share.ts`,
`stellic-export.ts`).

## The week calendar

`WeekGrid` (`lib/components/calendar/`) is the calendar every page uses: the schedules page, the course page and
instructor pages. It takes `CalendarBlock`s (`core/week-grid.ts`, built with `sectionBlocks` in `core/blocks.ts` or
`partBlocks` in `core/planner/format.ts`) and reports clicks and hovers through each block's `onClick`/`onHover` and
the `onblockclick`/`onblockhover` props.

| Prop | Meaning |
| --- | --- |
| `blocks` | What to draw. `variant` solid (in the schedule), preview (hatched), ghost (an outlined alternative); `conflict`, `selected`, `mini` |
| `days`, `minHour`, `maxHour`, `hourHeight` | Defaults: Monday to Friday plus weekend days with a block, 8 AM to 6 PM widened to fit |
| `display` | What blocks show besides the code; defaults to the student's calendar display preferences |
| `view` | `auto` (one day at a time below 640px with a Day/Week switch, remembered on the device), `day` or `week` |
| `tba`, `tbaTitle` | Things without a set time, listed under the grid |
| `compact`, `label`, `empty` | Small previews in dialogs; the accessible name; content over an empty grid |

Overlapping blocks share their column side by side. A visually hidden list repeats the calendar day by day for screen
readers; clickable blocks are buttons named with the course, day, time and room. Course colors are the ten palette
hues in `routes/layout.css` (`--c0` to `--c9`, with dark values), applied with `courseColorStyle()` and the
`course-tint`, `course-swatch` and `hatch` utilities. `calendarPng()` draws a schedule on a canvas for "Save as image".

## The schedules page

`/schedules?term=<id>` shows the semester's schedules as tabs (`ScheduleTabs.svelte`), each with its units in a pill:
switch, create (blank or from a degree plan semester, `core/planner/fromPlan.ts`), rename (the pencil, double-click or
the menu), duplicate, share and delete. A semester without a schedule shows "Schedule 1", created on the first edit,
so visiting creates nothing. `?schedule=<id>` shows a particular one (the profile links to it).

- **Toolbar**: one row under the tabs with Generate, Finals, Export and the calendar display button (a settings icon,
  `DisplayMenu.svelte`, whose popover chooses what blocks show besides the code: section, course name, time and room,
  and how the course list picks sections, dropdowns or compact letters). On screens 80rem and wider the
  session switch (Full semester, Mini 1, Mini 2) sits at the row's start when a placed course runs in a mini;
  narrower screens show it above the calendar. While the rail is a sheet, the row starts with the button that opens
  it ("Courses (6)", or "Add courses" for an empty schedule), the other buttons are icons, and a line under the row
  keeps the total units (in the warning color over 54 factorable), hours a week and conflicts in view
  (`WorkloadTotals.svelte`, `compact`).
- **Rail**: the semester; the courses, headed by their count and totals (`WorkloadTotals.svelte`: units, expected
  hours a week from FCEs when signed in, conflicts, the factorable and pass/fail split with its explanation, and the
  over-54-units warning), the course search that adds to them (`AddCourseSearch.svelte`: arrowing or hovering
  previews a course's sections on the calendar, Enter adds it with sections that fit; the results float in the top
  layer, as wide as the field, with the title on its own line so it stays readable in the narrow rail and the
  sheet), then each course (`CourseEntryRow.svelte`: color, lecture and recitation pickers with times, rooms,
  instructors' FCEs and conflicts, pass/fail, hide, remove, and a handle to drag it up or down the list, the rows it
  passes making room, or to move it a place with the arrow keys); saved courses offered this semester
  with quick add; the requisite check against the record (`ScheduleRequisiteSummary.svelte`, built on
  `core/record/context.ts`); the FCE workload by course and by half of the semester; and a friend's schedule to
  compare. Below the desktop breakpoint the rail is the "Courses" sheet, search and totals included.
- **Picking sections**: with the `sectionPicker` preference set to `dropdown` (the default), a course with a choice
  has a dropdown for its lecture or section and one for its recitation (`SectionPicker.svelte`); each button names
  the chosen section's instructors (a recitation's only when they aren't its lecture's). Set to `compact`
  (`SectionButtons.svelte`), the choices are letters on one line: the recitations when the course has them, each
  lecture's after the last's with a rule between (a recitation stands for its lecture, so choosing one sets both),
  otherwise its lectures or sections. Letters that fit stretch to fill the line; more scroll sideways, the line faded
  at an edge with letters past it, the chosen letter scrolled into view and arrow keys keeping the focused one clear of
  the fades. A conflicting lecture's letters are tinted red, and a letter that conflicts on its own is red with a dot.
  Hovering or focusing a letter previews it on the calendar and in the lines under the letters (times, room,
  instructors and what it would conflict with), which sit below the letters so they never move under the pointer;
  arrows move between letters from one tab stop. A course with a single way to take it shows its sections as text.
- **Calendar**: clicking a course outlines its other lectures (or recitations); clicking an outline switches to it.
  The session switch (see Toolbar) shows one half of the semester when a course runs in a mini. A friend's friends-visible schedule
  (`GET /api/friends/{id}/schedules?term=`) shows as striped blocks with their name.
- **Generator** (`ScheduleGenerator.svelte`): every conflict-free arrangement, ranked by start and end times, days
  off, gaps, lunch and days on campus, with courses left out or locked; apply it or save it as a new schedule.
- **Export** (`ExportMenu.svelte`): a .ics file, a PNG of the week, the course list as text, sharing, and "Send to
  Stellic or SIO" (`components/stellic/SendToStellicDialog.svelte`). That dialog only hands the student a script to run in their own
  signed-in Stellic or SIO tab, which shows what it will add and changes nothing until they confirm; this site never
  talks to Stellic or SIO. It takes `mode="plan"` for a degree plan.
- **Sharing** (`ShareDialog.svelte`, [decision 35](../decisions/0035-share-schedules-by-token-or-by-a-link-that-carries-it.md)):
  who among friends sees the schedule, and a link. `/schedules/shared/<token>` is the read-only view with "Copy to my
  schedules"; `?import=<payload>` links open in `ImportLinkDialog.svelte`.

Signed out, the page works on a draft kept in the tab, with a notice that it isn't saved; rooms, instructors and
hours a week ask the student to sign in (one line under the courses' totals; section rows leave the room out rather
than call it "Room TBA"). While the record is empty, the rail's requisite check asks for the courses taken instead of listing missing prerequisites.

## Final exams

Final exams are a dialog on the schedules page (`features/finals/FinalsDialog.svelte`,
[decision 34](../decisions/0034-show-final-exams-in-a-dialog-on-each-schedule.md)), opened with Finals or
`/schedules?term=<id>&finals=1`; `/finals` redirects there. It shows the schedule's exams matched by section
(`matchFinals` in `finals.ts`), warnings for overlaps, back-to-back exams and three or more within 24 hours, a .ics
download, a search of the semester's whole registrar schedule (`finals-table.ts`), a notice while the registrar
hasn't published it, and the SIO calendar import (`SioImport.svelte`) for exams its file lacks.

## Profile

`/profile/schedules` (`features/profile/SchedulesSection.svelte`) lists every schedule, newest semester first, filtered
by semester, with a `ViewToggle` in the title band (remembered on the device as `profile-schedules`) between two views:

- **Preview** (the default): the schedules grouped under their semesters (an accent calendar badge and the semester's
  name), each a card (`SchedulePreviewCard.svelte`) with the week in miniature over its name and class count ("3
  classes", "No classes yet"). The miniature is `WeekThumbnail` (`components/calendar/`): one SVG for the faint grid of
  day columns and hour rows and a block per meeting in the course's color, with no text, laid out by
  `thumbnailLayout` (`week-thumbnail.ts`) from `core/week-grid.ts`'s days and overlap lanes: Monday to Friday plus a
  weekend day only when something meets on it, and 8 AM to 6 PM widened so the first and last meetings have at least
  half an hour around them. Hidden courses are left out, as are courses without a set time (they still count as
  classes). The blocks come from the semester documents the section already loads (`previewBlocks` in
  `schedule-previews.ts`). One column on phones, two from 640px, three from 1280px.
- **Details**: the Figma's cards with the semester, units, hours a week and courses.

Every card opens the schedule on `/schedules`; a preview card is one link named "Schedule 1, Fall 2026, 3 classes".

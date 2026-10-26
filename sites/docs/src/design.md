# Website design system

The website follows the
[Figma redesign](https://www.figma.com/design/vsvdhGC2QP5fsvG0Pl7W6v/CMUCourses-Redesign--summer-25---Copy-?node-id=502-10393).
Its tokens live in `sites/web/src/routes/layout.css`, its components in `sites/web/src/lib/components`, and every
primitive is on show in both themes at `/dev/ui` in development builds. [Decision 30](decisions/0030-build-ui-primitives-on-native-elements.md)
explains how overlays and form controls are built, and [decision 31](decisions/0031-scroll-the-page-with-a-sticky-rail.md)
how pages scroll.

## Tokens

Colors are Tailwind theme variables, so `bg-surface`, `text-muted` or `border-line` work anywhere. Never hard-code a
color: every token has a dark value.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | `#f0f4f8` | `#0e151c` | Page background, secondary buttons, the desktop header |
| `surface` | `#ffffff` | `#16202a` | Cards, rail, toolbar band, dropdowns |
| `surface-2` | `#f0f4f8` | `#1c2833` | Wells inside cards (FCE aggregate, tables) |
| `ink` | `#4a5662` | `#d3dce5` | Primary text and icons |
| `strong` | `#1e1e1e` | `#f2f5f8` | Page titles, chip text, the inverted "Filter 3" pill |
| `muted` | `#7a8fa3` | `#91a4b7` | Secondary text, department names, inactive navigation |
| `faint` | `#aebdcc` | `#5c6f81` | Disabled text |
| `line` | `#d9e1e7` | `#283541` | Dividers, band borders, selected rows and pills |
| `line-strong` | `#9eb1c2` | `#4b5e70` | Field, pill and search-underline borders |
| `pressed` | `#c7d2dc` | `#33424f` | Card borders (as in the Figma), avatar fill |
| `accent` | `#0e96d1` | `#1b9ad3` | Primary buttons, slider, checked boxes, focus ring |
| `accent-ink` | `#0d89be` | `#5ec2ef` | Accent text: active navigation, links |
| `ok-bg` / `ok` | `#e7f6ec` / `#1b7443` | `#143326` / `#74d39f` | Satisfied requisites |
| `warn-bg` / `warn` | `#fef7e6` / `#8a5b00` | `#3a2f12` / `#eec35f` | Planned or in-progress requisites |
| `danger-bg` / `danger` | `#fdecee` / `#c4314b` | `#3c1c22` / `#ff8d9c` | Errors and destructive actions |
| `hover` / `active` | ink at 7% / 12% | ink at 9% / 15% | Hover and pressed fills that work on any surface |
| `selected` | accent at 9% over surface | accent at 16% over surface | The row a list or panel is showing (the course or instructor open beside the list) |

A list's course-number column uses `code-column` (at least 4em, never wrapped), not a pixel width, so "15-122" fits at
any font size. Copy doesn't explain what a page is for or restate what students know (that FCE hours include class time, that
pass/fail units don't count toward QPA); how-to hints go behind a `HelpTip`. Selection, emphasis and warnings are
fills, icons and text color, never a colored stripe down one side of a card,
row or block: a calendar block is a firmer tint of its course's color with a hairline edge (`course-block`), a selected
row takes `selected`, and a number past its guidance turns `warn` with a warning icon and says why on hover.

Type is Inter, with utilities named after the Figma text styles:

| Class | Size | Use |
| --- | --- | --- |
| `text-heading-3` | 24/32 medium | Page titles |
| `text-heading-4` | 20/28 medium | Profile section titles, the desktop search field |
| `text-heading-5` | 18/26 medium | Rail titles, card titles, dialog titles |
| `text-heading-6` | 16/24 medium | Navigation, small headings |
| `text-body-1` | 16/24 | Body text |
| `text-body-2` | 14/20 | Secondary body text, fields |
| `text-label-lg` | 14/20 semibold | Buttons, rail section labels, checkboxes |
| `text-label-md` | 12/16 medium | Chips, small buttons, counts |
| `text-label-sm` | 10/14 | Phone tags |

Radii are `rounded-tag` (4px: chips, stat boxes), `rounded-field` (10px: fields and selects, and rows that fill
on hover inside a card) and `rounded-card` (10px); buttons and pills are `rounded-full`. Give each element the radius
of its role, and separate things inside a card with spacing, a fill (`bg-surface-2` wells, `bg-paper` soft buttons) or
a hairline `border-line` between rows of data rather than another outlined box. Shadows are `shadow-header`,
`shadow-popover` and `shadow-dialog`. Use `tabular` for numbers that line up.

Dark mode is the `dark` class on `<html>`. An inline script in `app.html` sets it before the first paint from the saved
choice (`cmucourses:theme` in localStorage) or the system setting, and `theme` in
`lib/components/shell/theme.svelte.ts` keeps it in sync afterwards. `.light` and `.dark` also work on any element, so a
subtree can show the other theme.

## Conventions

- Icons are `@lucide/svelte`, sized with classes (`size-5` in buttons, `size-6` in navigation). Decorative icons get
  `aria-hidden="true"`; icon-only buttons use `IconButton`, which requires a `label`.
- Focus: see [Focus](#focus) below. Every control shows one visible focus indicator; don't remove outlines without
  a visible replacement.
- Source files are ASCII: write symbols as icons or HTML entities.
- Course and instructor links preview what they open on hover, focus or a long press (`PreviewLayer` in
  `$lib/components/preview`, decision 41). Mark a code that isn't a link with `coursePreview(id)` from
  `$lib/components/course/preview` and a name with `instructorPreview(name, term)` from
  `$lib/components/instructor/preview`; mark a course's own card or row link `data-course-preview="off"` and an
  instructor's `data-instructor-preview="off"`. Instructor previews show only while someone is signed in.
- Device conveniences (theme, cards or list, a hidden rail) go through `readLocal`/`writeLocal` in
  `lib/components/ui/storage.ts`, which survive blocked storage. Personal data never goes to localStorage
  ([decision 17](decisions/0017-store-personal-data-on-the-server.md)).

## Focus

Keyboard focus (`:focus-visible`) draws a 2px accent ring 2px outside the control, following its radius. It eases in
over 150ms (`animate-focus-ring`; reduced motion makes it instant), and a control that focus scrolls into view keeps
8px of room so the edge of a scroll box doesn't cut the ring off. A pointer click shows no ring, so style focus rings
with `focus-visible:`, never `focus:`. Each control shows one indicator, so some controls use something other than
the ring:

| Control | Focus indicator |
| --- | --- |
| Fields: `TextInput`, `Select`, `Combobox`, `MultiSelect`, the boxed `SearchInput`, inline inputs | `focus-field`: the border eases to accent and thickens to 2px (inside, so nothing shifts or gets clipped); red while invalid. Shown for clicks too, since you type into the field |
| The underline `SearchInput` | A 2px accent rule grows from the center over its line |
| A `Select` drawn as an icon or inline text (its `trigger` snippet) | The ring around that button |
| Full-width rows and list items (profile sections, pick lists), segments of a `SegmentedControl` | The ring drawn inside (`focus-visible:-outline-offset-2`), where a screen edge, a scroll box or the group's border can't cover it |
| `Tabs` | The ring around the tab's label, centered on the text rather than the tall tab |
| Slider thumbs | A ring around the thumb, not the track |
| Menu items and roving list options | The hover fill |

Rings must fit what they surround. Give a scroll box that holds controls at its edge room for the ring (a negative
margin with matching padding, as the plan's requirements column does), give text buttons that keep a 40px tap height
a little padding and `rounded-tag` so the ring isn't a tight box, and don't draw a ring over an element that already
shows focus another way. A dialog that opens on its own, with nothing focused before it, focuses its content rather
than its first control, so no control looks chosen until the person presses Tab.

## Components

Import primitives from `$lib/components/ui`, layouts from `$lib/components/layout` and shell pieces from
`$lib/components/shell`. All take a `class` prop for layout tweaks.

| Component | Key props | Notes |
| --- | --- | --- |
| `Button` | `variant` primary, secondary, outline (default), ghost, danger; `size` sm, md, lg; `icon`, `trailingIcon`, `href`, `loading`, `full` | Pill buttons from the Figma; `href` renders a link, external links open a new tab |
| `IconButton` | `label` (required), `icon`, `size`, `variant` ghost, outline, solid; `pressed`, `href` | |
| `TextInput` | `bind:value`, `label`, `hideLabel`, `hint`, `error`, `icon`, `size` md, sm | |
| `SearchInput` | `bind:value`, `label`, `placeholder`, `variant` underline (page search), field; `onsubmit` | Escape clears; has a clear button |
| `Select` | `bind:value`, `options`, `placeholder`, `label`, `variant` field (rail), compact (toolbar); `onchange`, `placement`, `trigger` | A select-only combobox ([decision 30](decisions/0030-build-ui-primitives-on-native-elements.md#amendment-custom-selects)): the field opens a list in a popover with a check on the chosen option. Compact is 36px, 40px on phones. `trigger` draws it as an icon or inline text |
| `Combobox` | `bind:value` (string or null), `options`, `label`, `placeholder`, `clearable` | Type to filter; for departments |
| `MultiSelect` | `bind:value` (string array), `options`, `label`, `placeholder` | Searchable checklist; for requirements |
| `Checkbox` | `bind:checked`, `indeterminate`, `label`, `description` | |
| `Switch` | `bind:checked`, `label`, `hideLabel`, `icon`, `tone` accent, neutral | |
| `RangeSlider` | `bind:low`, `bind:high`, `min`, `max`, `step`, `label`, `presets` | Two thumbs; presets are the unit pills |
| `ToggleChips` | `bind:value` (array), `options` (with `fullLabel` for a shortened label), `multiple`, `label`, `stretch`, `check` | Pressable pills that stay on one line, such as sessions; `check` marks pressed ones with a check (the plan's concentrations) |
| `Chip` | `tone` outline, soft, neutral, ok, warn, accent, strong; `size` xs, sm, md, lg; `icon`, `href`, `onremove`, `onclick`, `pressed`, `attrs` | `onremove` makes a removable filter chip; `pressed` takes a pressed ToggleChips pill's look in place of the tone; `attrs` adds attributes such as `coursePreview()` |
| `StatusChip` | `status` satisfied, planned, in-progress, unsatisfied | Check, arrow or x on the status colors |
| `CourseChip` | `code`, `title`, `status`, `tone`, `href`, `link` | Links to `/course/[code]`; shows the course preview |
| `Card` | `as`, `href`, `padding` none, sm, md, lg; `interactive` | White card with the Figma border |
| `Dialog` | `bind:open`, `title`, `description`, `size`, `dismissible`, `footer` snippet | Modal; traps focus, Escape, scroll lock, returns focus |
| `Sheet` | `bind:open`, `title`, `side` left, right, bottom; `backLabel` | Full screen on phones; content stays mounted |
| `Popover` | `bind:open`, `trigger` snippet (spread its props on a button), `placement`, `matchWidth` | Closes on outside click and Escape |
| `Menu` | `items` (label, icon, onselect or href, danger), `label`, `trigger` snippet | Arrow keys, Home, End |
| `Tooltip` | `text`, `trigger` snippet | Hover and focus |
| `HelpTip` | `text`, `label` | A (?) with a short how-to hint, for help most people don't need on screen |
| `toast()` | `toast(message, { kind, action, duration })` | Rendered by the root layout's `Toaster` |
| `Tabs` | `tabs`, `bind:value`, `label`, `panel` snippet | |
| `SegmentedControl` | `options` (label, icon, iconOnly), `bind:value`, `label`, `size`, `full` | Radio group; `full` fills the width with equal segments, as rail filters do. `size` sets the whole control's height to match the buttons beside it: `sm` 40px, 36px from 1024px (toolbars); `md` 40px |
| `ViewToggle` | `pageKey`, `bind:value` cards or list; `options` for a page's own views | Remembers the choice per page; read it back with `storedView` (or `storedViewOf` with `options`) |
| `Avatar` | `name`, `src`, `size` xs, sm, md, lg; `tone` | Initials, or a silhouette without a name |
| `AvatarGroup` | `people`, `max`, `size`, `label` | "+N" after `max` |
| `StarRating` | `value`, `max`, `size`, `showValue`, `label` | Partial stars for FCE rates |
| `StatBox` | `value`, `unit`, `label`, `variant` outline, plain; children | The "15.19 hrs/wk Workload" boxes |
| `CopyField` | `value`, `label`, `rows`, `copyLabel`, `variant`, `hint` | A read-only field with a Copy button (share and invite links); `download(blob, name)` in `ui/download.ts` saves a file |
| `DataTable` | `columns`, `rows`, `caption`, `variant` well (FCE), outline (finals); `cell` and `title` snippets | Scrolls horizontally; plain tables can use the `data-table` classes |
| `Spinner`, `Skeleton`, `EmptyState` | `size`; `variant`, `lines`; `title`, `description`, `icon`, actions as children | |

## Layout patterns

The root layout renders the header, `<main>` and the footer around every page; the footer folds to a one-line bar,
remembered on the device. Pages pick one of three patterns.

**Rail layout** (courses, instructors, schedules, plan). A white rail on the left with a title and a Hide
button, and the page on the right: a white toolbar band, then content on the page background. The rail is 340, 380 and
418px wide up to 1440px, then grows with the window to 480px at 1920px and faster beyond, to 672px at 2560px and at
most 760px (`RAIL_WIDTH`, shared with the profile's rail). The rail always keeps room for its scrollbar and its
content reaches under that room (`scrollbar-gutter.ts`), so a rail that scrolls lines up with one that doesn't; the
scrollbar sits over the content's right padding. Below 1024px the rail is a sheet opened from the toolbar's Filter button (`FilterButton`), which shows the
active filter count; `sheetDone` adds a button at the sheet's foot that closes it, such as "Show 85 courses", and
`getRail().close()` closes it from inside, as the plan's requisite list does before jumping to a course.

```svelte
<RailLayout storageKey="courses" filterCount={active} backLabel="Search">
  {#snippet rail()}
    <RailGroup>
      <RailSection title="Department" icon={GraduationCap} badge={departments.length}>
        <MultiSelect options={departmentOptions} bind:value={departments} label="Departments" />
      </RailSection>
      <Button variant="secondary" full onclick={reset}>Reset</Button>
    </RailGroup>
    <RailGroup title="Aggregate FCEs">...</RailGroup>
  {/snippet}
  {#snippet header()}
    <PageToolbar title="Search" hideTitle="desktop" count={results.length} onreset={reset}>
      {#snippet search()}<SearchInput bind:value={query} label="Search courses" />{/snippet}
      {#snippet chips()}<Chip label="12 Units" onremove={clearUnits} />{/snippet}
      {#snippet actions()}<ViewToggle pageKey="courses" bind:value={view} />{/snippet}
    </PageToolbar>
  {/snippet}
  <!-- results -->
</RailLayout>
```

`RailGroup`s stack with dividers between them; a group's `count` shows a pill after its title and `summary` puts
short lines under it (the schedule's courses and totals). `RailSection` is a collapsible filter with an icon, label
and chevron. `sheetButtonLabel` and `sheetIcon` replace the Filter button's text and icon where the rail isn't
filters (the schedules page's "Courses (6)").
`RailLayout`'s `showTitle={false}` keeps the rail's title for screen readers only, when the page's own title already
says where the student is (the degree plan); `railFooter` pins a snippet to the bottom of the rail and of its phone
sheet (a schedule's totals). `autoCollapse` folds the rail to its strip while something sits beside the results (the Courses page's
course panel below 1440px), with `bind:railCollapsed` to follow it.
`PageToolbar` has slots for the title, an intro, the search field, the result count, removable chips (plus a Reset
pill on phones) and right-aligned actions; `actionsLayout` (`auto`, `inline`, `row`) chooses whether the actions share
the Filter button's row on phones.

**Profile layout** (`/profile/[[section]]`). The profile rail: avatar, name, department and the section list (Saved
Courses, Currently Taking, Courses Taken, Schedules, Friends, Settings) with the active row filled. The section title,
`actions` and `filters` sit in a white band, or on the page background with `band={false}` as on Friends. A section
hands its own actions and filters to the band with `profileBand(() => ({ actions, filters }))` from
`$lib/components/layout`, using snippets declared in its markup. On phones
the sections become an accordion with the open one's content under it.

The degree plan (`/plan`, [decision 44](decisions/0044-put-the-degree-plans-programs-and-progress-in-a-rail.md)) is
a rail page: the programs, progress and requisite problems in the rail, and in the main column the plan's title row
(its name, switcher, layout switch and options) over the semester grid. The requirements are a sticky column beside
the semesters once the main column is 1120px wide, and the rail's last group below that.

**Page container** (course page, shared schedule, invite, errors). A centered column, `narrow`, `default` or `wide`.

Every list of courses or instructors offers cards and a one-column list. Put a `ViewToggle` with the page's key in the
toolbar actions and create the page's state with `storedView(pageKey) ?? "cards"` so the first render already uses the
device's choice.

## App shell

The header shows the logo, the navigation (Courses, Instructors, Schedules, Plan, Profile), the theme switch
and a Sign in or Sign out pill; below 1024px it becomes a menu button, the logo and the account control. Signed in,
`SyncStatus` beside Sign out says whether changes have reached the account (Saved, Saving, Offline, Not saved) with
a Retry after a failure; on phones it shows only while something isn't saved, and in full in the menu sheet. The shell
reads the session from context:

```ts
interface ShellSession {
  readonly status: "loading" | "signed-out" | "signed-in";
  readonly name?: string;
  readonly detail?: string; // second line on the profile, such as the department
  signIn: () => void;
  signOut: () => void;
  /** Save status while signed in: status, error and retry(), from `personal`. */
  readonly sync?: ShellSync;
}
```

The root layout calls `setSession(...)` with the data layer's session (`shellSession()` in `$lib/state`), backed by
runes state. Pages read it with `getSession()`, and `SignInPrompt`
shows the sign-in state for pages that need an account. Set each page's title with `<Title value="Instructors" />`.

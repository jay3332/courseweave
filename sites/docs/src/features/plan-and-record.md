# Degree plan and academic record

## Degree plan

`/plan` ports Courseweave's degree planner (`src/features/degree/*`). The route is a thin wrapper around
`PlanPage.svelte` in `sites/web/src/lib/features/plan/`; the logic is Courseweave's, already in `lib/core`
(`plan.ts`, `audit.ts`, `plan-table.ts`, `requirement-match.ts`, `substitutes.ts`, `degree/progress.ts`,
`degree/hooks.ts`), and the plan's data is the `plans`, `links`, `schedules`, `record` and `preferences` stores.

Which plan it shows: `?plan=<id>` (`planPath()`), else the active plan (`plans.activeId`: the one chosen, else the most
recently edited). Opening a plan makes it the active one. With no plan yet, the page is the first-run start
(`StartPlan.svelte`): the first semester (from the record's entry term when there is one), programs, "Create plan",
and "Import from Stellic". The semester being browsed for titles, units and "offered in" hints is `?term=`, else the
last one visited (`resolveTerm`).

The page is a rail page like Courses, Schedules and Profile
([decision 44](../decisions/0044-put-the-degree-plans-programs-and-progress-in-a-rail.md), amending
[decision 36](../decisions/0036-lay-out-the-degree-plan-beside-its-requirements.md)), with Courseweave's semesters
beside its requirements:

- **Title row** (`PlanHeader.svelte`, at the top of the semesters column, level with the requirements heading; no band
  above the page): the plan's name as the page title (click it to rename in place; Enter saves, Escape cancels), a
  chevron beside it that lists the student's plans and "New plan" (same programs and start), and on the right the
  Cards/Detailed switch (icons only below 1280px) and the plan's options: rename, duplicate, send to Stellic (a script
  for the student's own Stellic tab, `core/stellic-export.ts`), import from Stellic, delete. On phones, under it, the
  button that opens the rail's sheet ("Programs and requirements") and the progress bar in one line.
- **Rail** (`PlanRail.svelte`, a sheet on phones): the programs (`audit/ProgramPicker.svelte`: each with its
  requirements version by entry year and campus, its concentrations, any number of them, pressed again to clear, and
  what's checked alongside; then the program search, whose panel holds the type filter for majors, minors,
  additional majors and concentrations while it's in use, and lists a whole type with no query), the progress (the
  overall bar, `DegreeProgressBar.svelte`: done, in progress, planned, still needed; and the numbers from
  `numbers.ts` as `StatBox`es: units planned of the degree's total, units completed, requirements met or planned,
  semesters with the first one), and "Requisites" (`RequisiteProblems.svelte`): courses planned before their
  requisites, each jumping to the course.
- **Record prompt** while the record is empty, above the semesters.
- **Semester grid** (`SemesterGrid.svelte`): incoming credit (AP, IB, transfer, placements), then academic years with
  fall, spring and, when planned, summer (`grid.ts`), slots to add back a removed semester, the next semester and
  summers. A cards or detailed layout (the `planLayout` preference); the detailed one is a table per semester with
  the requirements each course satisfies, when it's usually offered and its prerequisites colored against the plan.
- **Semester cards** (`TermCard.svelte`): record courses (read-only, with grades; a W or other no-credit grade counts
  0 units, as on Courses Taken, unlike Courseweave) and planned courses, each with
  pass/fail, offering warnings, the requisite state (its issues and "Mark requisites as waived" on click), FCE hours,
  units (editable for variable-unit courses) and a menu: move up or down, move to another semester, pass/fail, units,
  view, remove. "Add a course" searches the whole catalog and says whether the semester offers each result. The
  footer has factorable and pass/fail units and FCE hours a week (at the busier half when minis run); either turns the
  warning color with an icon when it's past its guidance, and says why on hover.
  The semester's menu syncs it with one of its schedules (`links` store: the semester then shows the schedule's
  courses, and edits go to the schedule, with a section picked for added courses), copies a schedule's courses,
  opens the semester on the schedules page, or removes it.
- **Requirements** (`RequirementsPanel.svelte`, `audit/*`): each program's state, areas done and unit progress, then
  the requirement tree with done, planned, in progress and still needed states, the courses counted toward each,
  "ways to satisfy" a pool with Add, rules the audit can't check, and free electives. "Add" puts a course in the
  semester `suggestTerm()` picks (offered, with room, prerequisites met by then) and jumps to it. "Expand" opens the
  requirements in a dialog.

When the main column is at least 1120px wide (with the rail open, from about 1700px; hiding the rail makes room
sooner) the requirements are a sticky column beside the semesters, a third of the column wide (320 to 600px; 300 to 560px beside the detailed table). Below that they're the
rail's last group (its sheet on phones, "Programs and requirements"), without cards (`AuditPanel`'s `flat`).
Requirement rows are one line at any width: the status icon, the number, the title (truncated, whole in its tooltip),
then the semester a course counted in ("F27") and its units. Add appears over the row's end when the row is hovered or
focused; on touch, where nothing hovers, it's a + in the row (`AddButton.svelte`). Drag and drop
(HTML drag events, `DRAG_TYPE` and `DRAG_NEW_COURSE`) moves courses between and within semesters and adds courses
from the requirements; it's on with a fine pointer from 768px. The course menus and "Add" do the same from the
keyboard or a touch screen. On phones, past semesters start collapsed.

Course links go to `/course/<code>?term=<semester>` (`courseHref()`), so the course page offers "Back to plan"
(`planOrigin()`).

Signed out, plans are drafts in the tab, which the student can add to the account on signing in
([decision 42](../decisions/0042-ask-before-adding-signed-out-drafts-to-an-account.md)), and the program picker and
requirements say degree programs need a CMU sign-in
([decision 37](../decisions/0037-let-signed-out-visitors-draft-a-degree-plan.md)).

Pure helpers with tests: `grid.ts` (year rows), `rows.ts` (a course row's facts, where a drop lands, nudging),
`audit/programs.ts` (program search, a type's list with no query, and labels), and `state/plans.test.ts` (a
program's concentrations reach the account and come back); "Add a course" searches with the shared
`components/course/course-search.ts`. "Send to Stellic" opens the schedules' dialog
(`components/stellic/SendToStellicDialog.svelte`) with `mode="plan"`.

## Academic record

The academic record lives in the profile, ported from Courseweave's record page (`src/features/record/*`): the
components are in `sites/web/src/lib/features/record/`, the logic in `lib/core` (`sio-record.ts`, `stellic-plan.ts`,
`exam-credit.ts`, `core/record/*`, `core/state/record.ts`) and the data in the `record` store.

- **Courses Taken** (`features/profile/TakenSection.svelte`) is the whole record, in Courseweave's order. The profile's
  title band holds the actions (import from SIO or Stellic, and under More: export and import a backup in
  Courseweave's JSON format, with merge or replace, and clear the record) and the courses' filters
  (`TakenFilters.svelte`, sharing `taken-list.svelte.ts` with the list); then the empty-record start with the import and links to add by hand, the student's college, first
  semester and expected graduation beside the unit totals and QPA, then the courses taken, exam credit, transfer credit,
  and placements and requisite overrides. Courses taken look like the Figma's Courses Taken page: department, course
  level and semester filters, and cards (with grade and semester) or a list (`ViewToggle`, `profile-taken`), grouped
  by semester; grades can be changed and courses removed in both. The add form searches the catalog and the browsed
  semester, checks units, and takes a pasted list of course numbers. Exam credit picks an AP, IB or A-Level exam and
  score and shows what CMU awards from the registrar's charts, checking college eligibility, with a form for credit the
  charts don't cover.
- **Currently Taking** (`TakingSection.svelte`) is this semester's courses from the record, with their sections and
  meeting times from the semester's active schedule, as cards or a list with department and level filters in the
  title band. When the
  active schedule has courses the record lacks, it offers to add them.
- **Import** (`SioImportButton.svelte`, `ImportReview.svelte`): an SIO unofficial academic record PDF or a Stellic plan
  PDF is read in the browser by pdf.js, which loads in its own chunk only when a file is chosen
  (`core/record/SioImportPdf.ts`); the file never leaves the device
  ([decision 17](../decisions/0017-store-personal-data-on-the-server.md)). The review lists what was read by group,
  with what's already in the record unchecked, an option to update the profile, and the lines that couldn't be read.
  A Stellic plan also becomes a new degree plan. The degree plan's first run and its options menu use the same button.
- **Onboarding** (`RecordOnboarding.svelte`, mounted once in the root layout): new students are asked once, after their
  account's data has loaded and any signed-out drafts were added or discarded, to import their record or add it by hand (`personal.onboardingDue`,
  `personal.markOnboardingAsked()`); not on the Courses Taken page itself. `RecordPrompt.svelte` nudges again on the
  degree plan while the record is empty, until it's hidden (`preferences.hideOnboardingPrompt()`).

Pure helpers with tests: `core/record/taken-list.ts` (which entries each list shows, filters, grouping, the courses
taken this semester) and `core/record/grades.ts` (grade choices and notes).

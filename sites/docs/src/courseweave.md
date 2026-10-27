# Courseweave features in CMU Courses

[Decision 14](decisions/0014-bring-courseweave-features-into-cmu-courses.md) brings
[Courseweave](https://courseweave.jay3332.tech)'s features into CMU Courses. This page maps each feature to where it
lives here, and fixes the contracts between the catalog builder, the web API and the website.

Courseweave's source is the reference implementation: when this page says "as Courseweave does", read its code.

## Feature map

| Courseweave feature | In CMU Courses |
| --- | --- |
| Course search, ranked, with filters (department, units, level, days and times, fits my schedule, requirement, offered in, mini, FCE hours and ratings) | Courses page (`/`), filter rail from the Figma plus Courseweave's extra filters |
| Course list rows and the detail panel | Course cards from the Figma, expandable in place, with a cards/list switch; list rows are Courseweave's |
| Full course page: description, requisite tree checked against the record, unlocks, cross-listings, sections and meetings, offering history, counts toward, FCE charts, syllabi | `/course/[code]` |
| All semesters view of courses and instructors | "All semesters" in the semester picker |
| Instructor explorer and FCE history | Instructors page (`/instructors`, `/instructors/[id]`), signed in only |
| Schedule planner: several schedules a semester, section picker, week calendar, conflicts, colors, hidden courses, pass/fail, unit and workload totals, calendar display options, .ics and image export, share links, schedule generator, send to Stellic | Schedules page (`/schedules`) |
| Saved courses (bookmarks) | Saved filter on the course and instructor lists; saved courses also listed on the profile |
| Degree plan: programs, requirement audit, semester grid with drag and drop, progress bar, requisite problems | Plan page (`/plan`); signed out it is a draft, and degree programs ask for a CMU sign-in ([decision 37](decisions/0037-let-signed-out-visitors-draft-a-degree-plan.md)) |
| Academic record: SIO and Stellic PDF import, taken courses, transfer credit, exams, waivers | Profile, under "Courses Taken" and "Currently Taking" |
| Accounts, sync, sign out and clear this device | Keycloak sign-in; data on the server ([decision 17](decisions/0017-store-personal-data-on-the-server.md)) |
| Search-engine course pages and sitemap | The web API adds course head tags to `/course/[code]` and serves `/sitemap.xml`; `app.html` has the site's description, Open Graph image (`static/og-image.png`), touch icon and WebSite search action |
| - | Friends: requests, invite links, friends taking a course, friends' schedules (new) |
| - | Final exam schedule from the registrar, in a dialog on each schedule: that schedule's exams with conflict warnings, search across the semester's exams, .ics export; SIO calendar import stays (new) |

## Design

The [Figma redesign](https://www.figma.com/design/vsvdhGC2QP5fsvG0Pl7W6v/CMUCourses-Redesign--summer-25---Copy-?node-id=502-10393)
is the base, though screens needn't match it one to one: where a Courseweave pattern fits a feature better, we use it
in the same design system ([decision 40](decisions/0040-follow-courseweaves-interaction-design.md)). The Figma sets
the look: Inter, a pale blue-gray page, white cards with thin borders, pill buttons, a header with centered
icon-and-label navigation, a collapsible filter rail on the left and the ScottyLabs footer.

Tokens, from the file's variables:

| Token | Light | Use |
| --- | --- | --- |
| `--color-paper` | `#f0f4f8` | Page background, secondary buttons, subtle hover |
| `--color-surface` | `#ffffff` | Cards, rail, header controls |
| `--color-surface-2` | `#f0f4f8` | Wells inside cards (FCE aggregate, tables) |
| `--color-ink` | `#4a5662` | Primary text |
| `--color-muted` | `#7a8fa3` | Secondary text, department names |
| `--color-faint` | `#aebdcc` | Disabled text, placeholders |
| `--color-line` | `#d9e1e7` | Card borders, dividers, hover fill |
| `--color-line-strong` | `#9eb1c2` | Input and pill borders |
| `--color-pressed` | `#c7d2dc` | Pressed and selected fill |
| `--color-accent` | `#0e96d1` | Brand: active nav, links, primary buttons, slider |
| `--color-accent-ink` | `#0d89be` | Accent text on light surfaces |
| `--color-ok-bg` | `#e7f6ec` | Satisfied requisites |
| `--color-warn-bg` | `#fef7e6` | Requisites in progress or planned |

Type: Inter; heading 18/26 and 16/24 medium, body 16/24 and 14/20 regular, label 12/16 medium. The website defines
dark values for every token.

Rules where the Figma and Courseweave meet:

- No gen eds page: the requirement filter covers gen eds.
- No Saved tab: saved courses are a filter on the course and instructor lists.
- Every list of courses or instructors switches between cards and a one-column list. The choice is remembered per
  device.
- Every page works at phone width, following the Figma's mobile frames: the rail becomes a filter sheet, navigation
  moves to a menu.

## Catalog documents

`courses-index build` writes these into `catalog.sqlite`, and `GET /api/catalog/<name>` serves them
([decision 16](decisions/0016-serve-the-catalog-as-json-documents.md)). The types are Courseweave's, in
`sites/web/src/lib/core` after the port. "Member" means signed-in CMU users; a public version leaves fields out or the
document doesn't exist publicly.

| Name | Courseweave type and source | Public | Member |
| --- | --- | --- | --- |
| `build` | build info | yes | same |
| `terms` | `TermIndexEntry[]` (`types.ts`) | yes | same |
| `term/<id>` | `TermData` (`types.ts`), from `build-data.ts` | without instructors and rooms | full |
| `offerings` | `OfferingsData` | yes | same |
| `catalog/index` | `CatalogIndex` (`catalog-types.ts`), from `build-catalog.ts` | yes | same |
| `catalog/details/<NN>` | `Record<courseId, CatalogDetails>`; every course-number prefix has one, `{}` when none of its courses has details | yes | same |
| `teaching` | `TeachingData` | no | full |
| `fce/summary`, `fce/courses/index`, `fce/courses/<NN>`, `fce/instructors` | FCE files from `build-fce.ts` | no | full |
| `instructors/<id>`, `instructors/all` | The instructor list's rows, new ([decision 43](decisions/0043-list-instructors-from-their-own-documents.md), [format](api/catalog-fce-programs.md#instructor-list-documents)) | no | full |
| `programs/index`, `programs/<auditId>` | `ProgramsIndex`, `ProgramVersion` (`plan-types.ts`, `degree-types.ts`), from `build-programs.ts` | no | full |
| `syllabi/<NN>` | syllabus index from `build-syllabi.ts` | no | full |
| `finals/<id>` | final exam schedule, new (below) | without instructors | full |

`<NN>` is a course-number prefix, such as `15`. `finals/<id>` is a list of
`{ courseId, section, title, date, start, end, mode, location, instructors }` parsed from the registrar's PDF, with
`date` as `YYYY-MM-DD` and times as minutes after midnight in Pittsburgh. `title` is the registrar's abbreviation,
`mode` is `In Person`, `Remote` or `Cancelled`, `location` is the room or the registrar's note about it (or null), and
`instructors` are names as printed, last name first (`SHAW DIANE`).

### Raw inputs

| Path | Contents | Producer |
| --- | --- | --- |
| `data/terms.json` | Term ids, names, dates, minis, breaks and each term's sources, as Courseweave's `data/terms.json` | Committed |
| `data/fces.csv` | SmartEvals export | Committed (existing) |
| `data/finals/<id>.pdf` | Registrar final exam schedules | Committed; public documents |
| `exported/<andrew>/courses_history/`, `exported/<andrew>/programs/` | Stellic course info, sections and degree programs | `courses-scraper --mode courses / programs` (existing) |
| `exported/syllabi/<term>/<dept>/` | Syllabus registry files | `courses-scraper --mode syllabi` (existing) |
| `exported/soc/<id>/` | SOC search pages, course details, reservations, `meta.json`, as Courseweave's `data/raw/soc/<id>/` | `courses-scraper --mode soc` (new) |
| `exported/soc/details.json` | SOC course detail pages for the catalog | `courses-scraper --mode soc` (new) |
| `exported/schedules/<id>.csv` | Registrar schedule CSV for a term the SOC doesn't list yet | Downloaded by hand |

`exported/` is gitignored; raw scrape output is uploaded to object storage as [decision 10](decisions/0010-build-the-catalog-separately-from-scraping.md) describes.

## Web API

Same origin as the website. JSON field names are camelCase. Every write needs `Origin` to equal `APP_URL`. Errors are
`{ "code", "message" }` with `code` one of `auth`, `forbidden`, `not_found`, `conflict`, `too_large`, `too_many`,
`bad_request`, `unavailable`.

| Route | Behavior |
| --- | --- |
| `GET /api/health` | 200 when the catalog and the user database are ready (Kennel's health check) |
| `GET /api/me` | `{ subject, name, andrewId, email, isAdmin }`, or 401 |
| `GET /api/catalog/{*name}` | A catalog document, as above |
| `GET /api/syllabi/{*key}` | A syllabus file, member only. PDFs inline with a sandboxing CSP, other types as downloads |
| `GET /api/schedules?term=` | The caller's schedules |
| `POST /api/schedules` | Create `{ termId, name, entries?, visibility? }` |
| `PUT /api/schedules/{id}` | Replace with `{ ..., revision }`; 409 with the current record when stale |
| `DELETE /api/schedules/{id}` | Delete |
| `POST`/`DELETE /api/schedules/{id}/share` | Create or revoke a read-only link |
| `GET /api/shared-schedules/{token}` | A shared schedule, without its owner |
| `GET`, `POST /api/plans`; `PUT`, `DELETE /api/plans/{id}` | Degree plans, revisioned like schedules |
| `GET`, `PUT /api/record` | The academic record, revisioned |
| `GET`, `PUT /api/preferences` | Preferences that follow the student: calendar display, active schedule and plan, schedule tab order, onboarding answers |
| `GET /api/saved`; `PUT`, `DELETE /api/saved/{courseId}` | Saved courses, not tied to a semester |
| `GET /api/friends` and the request, accept, remove, invite and redeem routes | As before, renamed to camelCase |
| `PUT /api/friends/sharing` | `{ shareCourses, shareSchedules }`: what accepted friends may see |
| `GET /api/friends/{id}/schedules?term=` | A friend's schedules marked visible to friends, when they share schedules |
| `GET /api/friends/courses?term=` | `{ [courseId]: friendName[] }`: friends taking each course, from shared schedules and records |
| `GET /api/finals?term=`; `POST`, `DELETE /api/finals/import?term=` | The SIO calendar import, as before |
| `DELETE /api/account` | Delete the caller's data |
| `GET /api/courses`, `/api/courses/{code}`, `/api/terms` | Public course API over the relational tables |
| `GET /course/{code}` | The website, with the course's title, description, canonical link and structured data in the head |
| `GET /sitemap.xml`, `/robots.txt` | Search-engine files |

Record bodies:

- Schedule: Courseweave's `Schedule` (`state/store.ts`) plus `visibility: 'private' | 'friends'`, `revision`,
  `shareId`.
- Plan: Courseweave's `Plan` (`state/plan.ts`) plus `revision`.
- Record: Courseweave's persisted record state (`state/record.ts`) plus `revision`.
- Preferences: `{ calendarDisplay, activeSchedule: { [termId]: id }, scheduleOrder: { [termId]: id[] }, activePlanId, planLayout, sectionPicker, onboarding, revision }`.

## Website

SvelteKit, client-rendered, Svelte 5 runes, Tailwind 4 with the tokens above.

```
sites/web/src/
  lib/
    core/          Courseweave's UI-free modules and their tests, ported as-is
    api/           HTTP client and the types generated from the OpenAPI document
    data/          catalog document loading and caching; signed-in session
    state/         runes stores for schedules, plans, record, saved courses, preferences and drafts
    components/    shared components; components/ui/ for buttons, selects, chips, menus, dialogs
    features/      one folder per area: explorer, course, instructors, schedules (with finals), plan, profile, friends
  routes/
    +layout.svelte              header, navigation, footer
    +page.svelte                courses
    course/[code]/              full course page
    instructors/, instructors/[id]/
    schedules/, schedules/shared/[token]/
    plan/
    profile/[[section]]/        saved, taking, taken, schedules, friends, settings
    invite/[token]/
```

The semester is a `term` query parameter (`?term=S27`), remembered per student; `term=all` is the all semesters view
on the course and instructor pages.

## Status

Every feature in the map above is built; [feature status](features.md) lists where each one lives and what it needs,
and the per-area pages under `features/` describe them. The work was split into workstreams merged into the
`courseweave` branch: the catalog builder (decisions 18-22), the web API (23-26), the website foundation (27-31), and
the explorer, schedules, plan and record, and people areas (32-39).

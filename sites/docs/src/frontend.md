# Website data and state

The website in `sites/web` is a client-rendered SvelteKit app. It loads the catalog as JSON documents
([decision 16](decisions/0016-serve-the-catalog-as-json-documents.md)), runs Courseweave's TypeScript over them in the
browser, and keeps each student's own data on the server
([decision 17](decisions/0017-store-personal-data-on-the-server.md)). This page covers everything under the
components: where the data comes from, the stores, the development mock of the API and the tests. The look and the
components are in [the design system](design.md); the routes and contracts are in
[Courseweave features in CMU Courses](courseweave.md) and [the web API](api/web-api.md).

## Layout

| Path | Contents |
| --- | --- |
| `src/lib/core/` | Courseweave's UI-free modules and their tests, with Courseweave's file names: `audit.ts`, `requisites.ts`, `plan.ts`, `search.ts`, `ics.ts`, ... and feature modules in folders (`explorer/filters.ts`, `planner/format.ts`, `record/forms.ts`). `core/state/` holds the pure half of Courseweave's stores: record types and the edits they make. `core/routes.ts` builds links to the website's pages |
| `src/lib/api/` | The same-origin client for the web API (`api`), its errors (`ApiError`) and its types, generated from `openapi.json` |
| `src/lib/data/` | Catalog documents (`catalog`), the session (`session`), `resource()` for components, and the stale-deploy reload |
| `src/lib/state/` | The student's own data (`personal` and its stores), device conveniences (`device`), and helpers for semesters and "Back to plan" |
| `dev/` | The mock API for development and tests, and the API type generator |

Modules in `core`, `api`, `data` and `state` import each other by relative path with a `.ts` extension, so `deno test`
can load them; components import them as `$lib/data`, `$lib/state` and so on.

## Catalog documents

`catalog` (from `$lib/data`) loads `GET /api/catalog/<name>` and turns documents into what Courseweave's code expects:

| Loader | Gives |
| --- | --- |
| `terms()` | Every built semester, newest first |
| `term(id)` | A semester's courses and sections, indexed (`courseById`, `searchDocs`, `instructors`, `departments`) |
| `catalogIndex()`, `catalogDetails(prefix)`, `courseDetails(courseId)` | The course catalog: titles, units, requisites; descriptions by course-number prefix |
| `offerings()` | Which semesters offer each course, indexed for search; null without the document |
| `teaching()` | Who teaches what in each semester (member data) |
| `instructorList(scope)` | The instructor list's rows for a semester or `all` (member data); null for a catalog built without them |
| `fceSummary()`, `fceAccess()`, `fceCourses(prefix)`, `courseFce(courseId)`, `fceCoursesIndex()`, `fceInstructors()` | FCEs, decoded from the documents' tuples (member data) |
| `programsIndex()`, `program(auditId)`, `programs(ids)`, `auditVersions(selections)` | Degree programs and the versions an audit needs (member data) |
| `syllabi(prefix)`, `courseSyllabi(courseId)` | Past syllabi (member data); `syllabusPath(key)` in `$lib/api` links to a file |
| `finals(termId)` | The registrar's final exam schedule; null until it's published |
| `document(name)`, `build()` | Any document as JSON |

Each document is requested once however many callers ask at the same time, and kept in memory until the session
changes. The browser revalidates every request by ETag, so a reload downloads only documents that changed. A missing
document (404) becomes the empty value Courseweave used (no details, no syllabi, no FCEs); other failures are forgotten
so the next call tries again.

Member documents reject with `SignInRequiredError`: its `reason` is `signin` when nobody is signed in and `forbidden`
for a signed-in account that isn't a CMU one. The website's catalog waits for the session's first answer before
requesting a member document and doesn't request it at all when the server would refuse it (`setMemberGate`), so a
signed-out page makes no requests that end in 401. `settle(promise)` turns any load into
`{ status: "ready" | "signin" | "forbidden" | "error" }` without throwing. In a component, `resource()` does the same
as reactive state and loads again whenever what the loader reads changes:

```svelte
<script lang="ts">
  import { catalog, resource } from "$lib/data";
  import { searchCourses } from "$lib/core/search";

  let { termId, query }: { termId: string; query: string } = $props();
  const term = resource(() => catalog.term(termId));
  const results = $derived(term.value ? searchCourses(term.value.searchDocs, query) : []);
</script>

{#if term.status === "signin"}Sign in to see this{:else if term.value}...{/if}
```

The pure functions in `core` take loaded documents as arguments. Courseweave's React hooks became plain functions
there, such as `planDerived()` and `courseHref()` in `core/degree/hooks.ts`, `unofferedDocs()` and `allCourses()` in
`core/explorer`, `allInstructors()` and `courseLookup()` in `core/instructors/allInstructors.ts`, and
`requisiteContext()` in `core/record/context.ts`. Wrap them in `$derived` where they're expensive.

## The session

`session` (from `$lib/data`) asks `GET /api/me` as soon as the module loads in the browser. `session.status` is
`loading`, `signed-in`, `signed-out` or `unavailable` (the API couldn't be reached), and `session.user` is the CMU user.
`session.authError` is `not-cmu` after signing in with an account that isn't a CMU one.

`session.signIn()` leaves for `/auth/login?returnTo=<this page>` and also remembers the page in sessionStorage;
`session.consumeReturnPath()` gives it back once after signing in, should the API have landed somewhere else. Signing
out goes through `personal.signOut()`, which saves first. The root layout gives the app shell a session built by
`shellSession()` from `$lib/state/shell-session`. Any 401 from the API while signed in ends the session, and every
change of session empties the catalog's cache.

## The student's data

`personal` (from `$lib/state`) holds the student's schedules, degree plans, academic record, saved courses and
preferences. Its stores are also exported on their own:

| Store | Reading | Changing |
| --- | --- | --- |
| `schedules` | `items`, `get(id)`, `forTerm(termId)`, `activeId(termId)`, `active(termId)` | `ensureSchedule`, `createSchedule`, `duplicateSchedule`, `deleteSchedule`, `renameSchedule`, `setActiveSchedule`, `moveSchedule`, `addCourse`, `removeCourse`, `setSection`, `setChild`, `setSections`, `setPassFail`, `setColor`, `toggleHidden`, `moveEntry`, `setVisibility`, `importShared`; `share(id)` and `unshare(id)` when signed in |
| `plans` | `items`, `list`, `get(id)`, `activeId`, `active` | `createPlan`, `duplicatePlan`, `deletePlan`, `setActivePlan`, `renamePlan`, `setPrograms`, `setStartTerm`, `addTerm`, `removeTerm`, `addCourse`, `removeCourse`, `moveCourse`, `updateCourse`, `setTermCourses`, `linkTerm`, `unlinkTerm`, `setCourseUnits`, `removeCourseFromTerm` |
| `links` | | Plan edits that land in a synced schedule: `addToTerm`, `placeInTerm`, `removeFromPlan`, `moveInPlan`, `setPlanPassFail`, `setPlanUnits`, `linkTermToSchedule`, `unlinkTerm` |
| `record` | `data`, `entries`, `overrides`, `profile`, `isEmpty`, `totals(unitsOf)` | `addEntry`, `addEntries`, `updateEntry`, `removeEntry`, `removeExam`, `setOverride`, `setProfile`, `importRecord`, `clearRecord` |
| `saved` | `ids`, `has(courseId)` | `toggle`, `add`, `remove` |
| `preferences` | `calendarDisplay`, `scheduleOrder`, `planLayout`, `sectionPicker`, `onboarding`, `activePlanId` | `setCalendarDisplay`, `setScheduleOrder`, `setPlanLayout`, `setSectionPicker`, `hideOnboardingPrompt` |

These are Courseweave's store actions with the same meaning; the pure edits behind them are in `core/state`. What
changed is where the data lives:

- **Signed out**, every store is a draft in sessionStorage (`cmucourses:draft:<store>`) for this tab only.
  `personal.mode` is `draft`; label the data as unsaved.
- **Signing in** loads the account's records (`personal.mode` is `loading`, then `account`). The tab's drafted
  schedules (with courses), plans, record and saved courses are held back until the student adds them or discards
  them (`personal.heldDrafts`, `acceptDrafts()`, `discardDrafts()`; `HeldDraftsDialog` asks,
  [decision 42](decisions/0042-ask-before-adding-signed-out-drafts-to-an-account.md)): added, new schedules and plans
  are created under names the account's schedules and plans don't use, the record is merged with Courseweave's rules and saved courses
  are added. Preferences are merged at once. An empty default schedule is dropped when the account already has one for
  its semester. Signing out gives the tab its held drafts back.
- **Signed in**, every edit shows at once and is written back after a pause of 1.5 seconds, so bursts of edits are one
  request. Each schedule and plan is its own record; the record and preferences are one record each. Writes name the
  revision they're based on; when another device wrote first (409), the edits made here since that revision are
  replayed onto the stored record and written again ([decision 28](decisions/0028-replay-edits-onto-the-stored-record.md)).
  Until the server has a change it is also kept in sessionStorage (`cmucourses:pending:<store>`, with the account it
  belongs to), so a reload, a lost connection or the trip through sign-in loses nothing.
- **Status**: `personal.status` is `saved`, `saving`, `offline` or `error`, with `personal.error` explaining an error and
  `personal.retry()` to try again. Writes retry by themselves after rate limits (Retry-After) and server errors, and
  when the browser comes back online. `personal.unsaved` says whether the server is missing anything.
- **The session ending** on its own (a 401) keeps everything on screen with an error asking to sign in again; signing in
  saves it. `personal.signOut()` saves first and answers `unsaved` when it couldn't, so the page can ask before
  `personal.signOut(true)`; signing out forgets the account's data in the tab.

A schedule made by `ensureSchedule` (the empty schedule a semester shows first) stays on the device until something is
added to it, so visiting a semester creates no records. `personal.onboardingDue` and `personal.markOnboardingAsked()`
drive the "add your record" prompt.

`device` keeps the last semester visited (`device.rememberTerm(id)`, `device.lastTerm`) and, signed out, the prompt's
answer, in localStorage. The color theme and the cards/list choice belong to the design system
(`components/shell/theme.svelte.ts`, `components/ui/ViewToggle.svelte`). `resolveTerm()` and `isAllSemesters()` in
`state/term-scope.ts` pick the semester a page shows from its `term` parameter; `trackOrigin()` and `planOrigin()` in
`state/nav-origin.ts` give course pages their "Back to plan".

### Wiring for the app shell

The root layout already supplies the session. The shell should also:

- call `installUpdateReload()` (from `$lib/data`) once, and `handleStaleBuild(error)` from `handleError` in
  `src/hooks.client.ts`, so a tab opened before a deploy reloads instead of failing to load a page; SvelteKit also
  checks for a new build every five minutes (`kit.version.pollInterval`), and the root layout then shows a toast
  offering to reload, which loses nothing since unsaved changes survive a reload;
- call `trackOrigin(url.pathname, url.search)` and `device.rememberTerm(term)` after each navigation;
- after the session loads, go to `session.consumeReturnPath()` when it isn't null.

### How the stores are built

The stores are plain TypeScript classes that keep their state in cells: `runeCell` (`data/cell.svelte.ts`) is Svelte's
`$state.raw` for the website, and `plainCell` a bare variable for tests
([decision 27](decisions/0027-keep-store-logic-in-plain-typescript.md)). `instances.svelte.ts` in `data` and `state`
creates the website's instances. Reading a store's getter in markup, `$derived` or `$effect` tracks it, and every change
replaces values rather than mutating them, so components can compare by reference.

## API types

`src/lib/api/openapi.json` is the web API's OpenAPI document, written by `cargo run -p courses-web-api -- openapi`.
`deno task generate-api` turns it into `src/lib/api/schema.d.ts`, and `src/lib/api/types.ts` names the schemas the
website uses. Regenerate both when the API changes.

## Developing against the mock API

The website needs the web API for everything but static pages. Without the Rust API running, the mock in
`dev/mock-server.ts` answers `/api` and `/auth` from memory
([decision 29](decisions/0029-develop-against-an-in-memory-mock-api.md)):

```sh
cd sites/web
MOCK_CATALOG_DIR=/path/to/cmu-course-planner/public/data deno task dev:mock
# or: MOCK_API=1 MOCK_CATALOG_DIR=... deno task dev
```

| Variable | Effect |
| --- | --- |
| `MOCK_API=1` | Turns the mock on (`dev:mock` sets it) |
| `MOCK_CATALOG_DIR` | A directory of Courseweave-format catalog files, such as Courseweave's `public/data`: `term/S27` is `S27.json`, `catalog/details/15` is `catalog/details/15.json`, and so on. Without it every document is 404 |
| `MOCK_SIGNED_IN=1` | Starts signed in. Either way, the website's sign-in and sign-out work, and `/auth/login?as=bob` signs in as another Andrew ID |

Signed out, member documents (`teaching`, `fce/*`, `programs/*`, `syllabi/*`) answer 401 and term documents leave out
instructors and rooms. Schedules, plans, the record, preferences and saved courses behave like the real API's, with
revisions and 409s, in memory until the dev server restarts. Friends are only deep enough for the pages to render
(nobody to befriend), and finals imports aren't supported. The mock's Vite plugin applies only to `vite dev` and is
loaded only when `MOCK_API=1`, so it is never part of a build.

To use the real API instead, run `courses-web-api` on port 3002 (see the [maintainer guide](maintaining.md)); without
`MOCK_API`, the dev server proxies `/api` and `/auth` to it.

## Tests

```sh
cd sites/web
deno task test      # unit tests: src/lib/**/*.test.ts and dev/**/*.test.ts
deno task check     # svelte-check
deno task build
```

Tests use `node:test`'s `describe` and `it` with `expect` from `@std/expect`, imported through `$lib/testing.ts`.
Courseweave's tests came along with its modules, changed only where they used Vitest-specific features. The commit
hook runs `deno test` from the repository root, where `sites/web`'s configuration doesn't apply, which is why modules
import each other with `.ts` extensions and tests import `expect` from `testing.ts` rather than by package name.

A few of Courseweave's tests need real catalog files; they run when `CATALOG_DATA_DIR` (or `MOCK_CATALOG_DIR`) points
at a Courseweave-format directory and are skipped otherwise. Catalog data is never committed.

The store tests (`src/lib/state/*.test.ts`) run the real stores against the mock API through the real client, with a
clock whose timers run only when told to (`state/test-env.ts`): signed-out drafts, signing in, debouncing, conflicts,
going offline, reloads and the session ending.

Ported files keep Courseweave's code as it was, so some carry a first-line `oxlint-disable` naming the style rules
they don't follow; fixes then port between the two codebases unchanged. New code follows the linter.

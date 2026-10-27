# Instructors, friends and settings

The website's people pages: the instructor explorer, friends on the profile, the invite page and the profile's
settings. They follow the [Figma redesign](https://www.figma.com/design/vsvdhGC2QP5fsvG0Pl7W6v/CMUCourses-Redesign--summer-25---Copy-?node-id=502-10393)
and port Courseweave's instructor explorer ([Courseweave features](../courseweave.md)).

## Instructors

`/instructors?term=S27` lists who teaches in a semester; `term=all` is "All semesters", everyone teaching in any
built semester plus everyone in the FCE history. `/instructors/<slug>?term=` is one instructor. Both are member data:
signed out, the pages ask the visitor to sign in, and a non-CMU account is told it needs one.

| Where | What |
| --- | --- |
| `routes/instructors/` | A layout and two thin pages over the feature components |
| `lib/features/instructors/InstructorsShell.svelte` | The layout: filter rail, search toolbar, and the rows beside an open instructor |
| `lib/features/instructors/scope.svelte.ts` | State the pages share: semester, filters (in the URL), documents, results, the open instructor |
| `lib/features/instructors/InstructorResults.svelte` | `/instructors`: cards or rows |
| `lib/features/instructors/InstructorDetail.svelte` | `/instructors/<slug>`: aggregate data, evaluations by section, teaching, evaluation history |
| `lib/components/instructor/` | Instructor card, row and preview card; `instructor-fce.ts` (an instructor's FCE rows), `directory.ts` (the compact documents' rows and slugs) and `preview.ts` (which links and names preview), tested |
| `lib/components/course/` | What instructors share with courses: the aggregate window and figures (`fce-aggregate.ts`), the "Aggregate FCEs" settings, stat boxes (`FceStats`), the FCE table and the trend chart |

The layout keeps the list's state while the student opens instructors. In the list view on screens 1280 pixels wide
or more, an open instructor shows beside Courseweave's rows, which stay in their own scrolling column (as tall as the
room below its top until it sticks, `roomBelow`, so its end is always on screen); in the cards
view and on narrower screens the instructor page is on its own, with "All instructors" going back to the list.

The rail and toolbar match the Courses page: departments are a searchable multi-select and the sort a toolbar select
(on phones, beside the semester); signed out, neither offers filters. The list keeps its filters in the URL (`q`,
`dept=CS,MSC`, `saved=1`, `sort=sections`), so Back from an instructor, a
reload or a shared link shows the same list. Search is Courseweave's: names first, then course numbers (`15-122`,
`15-1`) and course titles; `/` focuses the field, the arrow keys move through the rows and Enter opens one. Saved is
a filter, matching instructors who teach one of the student's saved courses. The cards/list switch is remembered per
device; rows have letter headings when sorted by name.

The list reads one small document, `instructors/<termId>` or `instructors/all`, with each row's name, departments,
courses, titles to search, teaching rating and FCE courses
([ADR 43](../decisions/0043-list-instructors-from-their-own-documents.md)); the semester, `teaching`, the FCE index
and course titles load only once an instructor is open. With a catalog built before those documents, the list is
built from the full documents as before (`lib/features/instructors/list.ts`).

Cards follow the Figma: the name and departments, three stat boxes (workload, teaching rate, course rate) and the
FCE rows the aggregate counts. A card loads its FCE rows the frame after it comes near the viewport, from the
`fce/courses/<NN>` documents of the courses the list names for that person, so the names show first and a long list
only downloads what is seen ([ADR 39](../decisions/0039-build-instructor-fce-rows-in-the-browser.md)).

### Instructor previews

Links to an instructor's page anywhere on the site (the course page's instructors and sections, FCE tables,
"Teaches with") show a card when the pointer rests on them or keyboard focus reaches them, and on a touch screen
when they're pressed and held, with "Open instructor"
([ADR 41](../decisions/0041-preview-every-course-link.md#instructor-links)). The card
(`lib/components/instructor/InstructorPreviewCard.svelte`) shows the name and departments, what they teach in the
link's semester (or where they teach, for all semesters), and the FCE aggregate the cards show: teaching and course
rating, hours a week and the semesters it covers. It reads the list's compact document and the cards' FCE rows
through `instructor/data.svelte.ts`, loaded once per session; when they don't teach in the semester, it says so and
describes them from `instructors/all`. The schedule's section picker marks its instructor names with
`instructorPreview(name, term)` (`instructor/preview.ts`), since its options can't hold links; instructor cards and
rows opt out. Signed out, nothing previews.

### Aggregate FCEs

The rail's "Aggregate FCEs" settings choose what the stat boxes average: the most recent N semesters with responses
("Semesters to show", empty for all; default 2) in the chosen seasons (default spring and fall). On an instructor's
page, "Courses" narrows it to some of their courses. Means are weighted by responses, as Courseweave's summaries are.
The settings are a device convenience in localStorage (`cmucourses:fce-aggregate`), shared by both instructor pages
and the Courses rail, whose cards average the same way.

### Instructor page

- The Figma card: aggregate data in the well, then every evaluated section in the window, or every semester with
  "Every semester" on; semester, course, section, workload, ratings, respondents and response rate.
- In a semester: Courseweave's teaching table (course, title, section, meeting times, rooms, co-instructors), class
  hours a week and "Teaches with", then the weekly timetable on the shared `WeekGrid`: a color per course, each class
  opening its course, sections without a set time listed under it.
- In all semesters: what they taught each semester, linking to that semester's view.
- Evaluation history: recent teaching rating, courses evaluated, teaching rating by semester and a per-course table.

## Friends

Friends are new in CMU Courses; the Figma's "Profile Page (Friends)" sets the look. They live on the profile
(`/profile/friends`) and on the invite page (`/invite/<token>`), over the friends routes of the
[web API](../api/web-api.md#friends).

| Where | What |
| --- | --- |
| `lib/features/friends/friends.ts` | The friends store: friends and requests, the invite made in this tab, sharing; errors in plain words (tested) |
| `lib/features/friends/instance.svelte.ts` | The website's store, emptied when the account changes |
| `lib/features/profile/FriendsSection.svelte` | The section: requests, friend cards, sent requests, sharing settings |
| `lib/features/friends/FriendsActions.svelte` | "Share link" and "Add friends" beside the heading, with their dialogs |
| `lib/features/friends/FriendSchedule.svelte` | A friend's friends-visible schedule for a semester |
| `lib/features/friends/InvitePage.svelte` | The invite page |

- **Friends taking a course** show on course cards and the course panel as avatars on a button that lists their names
  (for touch and keyboard users as well as hover).
- **Friend cards** show the friend's name and Andrew ID, "Schedule" when they share schedules, and the courses they're
  taking in the chosen semester (from `GET /api/friends/courses`), with the ones the student is also taking (their
  schedule for the semester and courses in progress on their record) first and marked. The semester defaults to the
  one in session. The card's menu removes the friend after a confirmation.
- **Requests**: incoming ones can be accepted or declined, sent ones canceled. "Add friends" sends a request by Andrew
  ID (an email address works too); when nobody with that ID has signed in, it offers an invite link instead.
- **Invite links**: "Share link" makes a link (`/invite/<token>`, built from the site's own origin), copies or shares
  it, makes a new one or revokes it. The API can't list a student's links, so the dialog shows only the one made in
  this tab.
- **Sharing**: "What friends can see" holds the two switches, share my courses and share my schedules, each saying
  exactly what friends see; both start off. The settings link here (`/profile/friends#sharing`).
- **A friend's schedule** opens in a dialog: semester, schedule (when they share several), their week as a calendar,
  and each course with its chosen sections and meeting times, pass/fail and hidden courses noted.
- **The invite page** asks a signed-out visitor to sign in without naming the sender, then shows who sent it
  (`GET /api/friends/invites/{token}`, [ADR 38](../decisions/0038-show-an-invites-sender-before-it-is-accepted.md)),
  what friends can see, and Accept. It handles the student's own link, existing friends, pending requests and links
  that expired or were used.

## Settings

`/profile/settings` (`lib/features/profile/SettingsSection.svelte`) works signed in or out.

- **Account**: name, Andrew ID and email from `GET /api/me`, whether everything is saved (`personal.status`, with a
  retry after an error), and Sign out, which saves first. Signed out, it explains what signing in adds.
- **Appearance**: the theme, for this device.
- **Calendar**: Courseweave's calendar display options (section, meeting time, room) in `preferences`, saved to the
  account, or kept in the tab until sign-in.
- **Friends and sharing**: what friends can see now, linking to the switches on Friends.
- **Your data**: what's stored in the account and what stays on the device, and "Delete my data"
  (`DELETE /api/account` through `personal.deleteAccount()`), which lists what is removed before it deletes
  everything and signs out on every device.

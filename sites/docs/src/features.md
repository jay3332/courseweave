# Feature status

What the website does today, where it lives and what it needs. "Member" means a signed-in CMU account; signed-out
visitors see public data and get a sign-in prompt where member data would be. Each area has its own page with the
details.

| Feature | Where | Needs | Details |
| --- | --- | --- | --- |
| Course search with ranked results, cards or compact rows sorted by their headers, FCE sample sizes, and an FCE hours chart | `/` | Public; FCEs are member | [Explorer](features/explorer.md) |
| Filters: saved only, fits my schedule, department, units (variable or fixed only), offered in, level, days and times, mini, delivery, FCE hours and rating | `/` | Public; FCE filters are member | [Explorer](features/explorer.md) |
| Requirement filter, gen eds included | `/` | Member (degree programs) | [Explorer](features/explorer.md) |
| All semesters view of courses and instructors | `/?term=all`, `/instructors?term=all` | Public; instructors are member | [Explorer](features/explorer.md), [People](features/people.md) |
| Course detail panel and full course page: sections, requisites checked against the record, what a course unlocks, cross-listings, counts toward, offering history | `/?course=`, `/course/[code]` | Public; instructors, rooms and counts toward are member | [Explorer](features/explorer.md) |
| FCE charts and history; past syllabi with preview and download | Course and instructor pages | Member | [Explorer](features/explorer.md) |
| Requisite explorer | `/requisites` | Public | [Explorer](features/explorer.md) |
| Schedules: several per semester, section pickers, week calendar, conflicts, colors, pass/fail, workload, display options | `/schedules` | Public as a draft; saved when signed in | [Schedules](features/schedules.md) |
| Schedule generator, .ics and image export, send to Stellic or SIO | `/schedules` | Public | [Schedules](features/schedules.md) |
| Share links and the read-only shared view | `/schedules/shared/[token]` | Member to share; anyone to view | [Schedules](features/schedules.md) |
| Final exams: the registrar's schedule matched to a schedule, conflict warnings, search, .ics, SIO import | Finals dialog on `/schedules` | Public; SIO import is member | [Schedules](features/schedules.md) |
| Degree plan: programs, requirement audit, progress bar, semester grid with drag and drop, requisite problems, schedule links | `/plan` | Member for degree programs; drafts without | [Plan and record](features/plan-and-record.md) |
| Academic record: SIO and Stellic PDF import in the browser, grades, exam and transfer credit, waivers, QPA | `/profile/taken`, `/profile/taking` | Member | [Plan and record](features/plan-and-record.md) |
| Instructors: search, cards or rows, aggregate FCEs, teaching history and timetable | `/instructors`, `/instructors/[id]` | Member | [People](features/people.md) |
| Friends: requests, invite links, sharing settings, friends taking a course, a friend's schedule | `/profile/friends`, `/invite/[token]`, course cards, schedules | Member | [People](features/people.md) |
| Settings: theme (Default, Telegram, Discord, Claude, Mono, Playful, Soft) and light or dark, calendar display, account, delete my data | `/profile/settings`, the header's Appearance button | Theme for everyone; the rest member | [People](features/people.md) |
| Course pages for search engines and a sitemap | `/course/[code]`, `/sitemap.xml` | Public | [Web API](api/web-api.md) |

## Boundaries

- The degree audit is a planning aid. It follows the rules in Stellic's degree programs, but substitutions, advisor
  exceptions and college policies aren't all modeled; the plan page says so.
- FCEs are historical. A course's next instructor may differ from those evaluated.
- Final exams come from the registrar's published PDFs, which change; the dialog asks students to confirm with SIO.
- Instructors, rooms, FCEs, syllabi and Stellic degree programs are member data
  ([decision 20](decisions/0020-redact-public-term-documents.md)). Syllabi stay private only once they're in a private
  bucket ([decision 24](decisions/0024-serve-syllabi-from-private-object-storage.md)).
- Personal data lives in the web API's SQLite database on one service instance
  ([decision 17](decisions/0017-store-personal-data-on-the-server.md)); replicas would need shared storage.

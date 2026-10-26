# Web API

`courses-web-api` is the Rust/Axum service behind cmu.courses. On one origin it serves the built website, the catalog
documents ([decision 16](../decisions/0016-serve-the-catalog-as-json-documents.md)), a public course API, sign-in, and
CMU students' personal records ([decision 17](../decisions/0017-store-personal-data-on-the-server.md)). The separate
`courses-api` crate is the older public catalog service and is not what the website calls.

The OpenAPI document is the contract for every JSON route and body: `sites/web/src/lib/api/openapi.json`, also served
at `/api/openapi.json` with a browser at `/api/scalar`. Regenerate it after changing a route or a body, without running
the server:

```sh
cargo run -p courses-web-api -- openapi > sites/web/src/lib/api/openapi.json
```

A test fails when the committed file no longer matches the code.

## Running locally

The server needs a catalog built by `courses-index build`: `$CATALOG_DIR/catalog.sqlite`, or
`data/catalog/catalog.sqlite` when neither `CATALOG_DIR` nor `DATABASE_PATH` is set. Startup fails when the file is
missing, has another schema version or has no terms.

Without Keycloak, use development sign-in ([ADR 26](../decisions/0026-sign-in-locally-without-keycloak.md)):

```sh
APP_URL=http://localhost:5173 DEV_USER=jdoe CATALOG_DIR=data/catalog \
  cargo run -p courses-web-api --features dev-auth
```

Every request is then the verified CMU user `jdoe@andrew.cmu.edu` (subject `dev:jdoe`, name from `DEV_USER_NAME` or
the Andrew ID). In the browser:

- `/auth/login?as=bob` switches to `bob`; `/auth/login` returns to `DEV_USER`.
- `/auth/logout` signs out, so signed-out pages can be tried. Signing in again clears it.
- The choice lives in the `cw_dev_user` cookie.

Development sign-in only runs when the `dev-auth` feature is compiled in (it never is in the Nix build), `APP_URL`
starts with `http://localhost`, and `DEV_USER` is set. With `DEV_USER` set and any other `APP_URL`, the server refuses to
start. Without the feature, `DEV_USER` is ignored with a warning and the Keycloak settings below are required.

`APP_URL` must be the exact origin the browser uses, including the port: with the Vite dev server proxying `/api` and
`/auth`, that's the Vite origin. Personal data goes to `data/private/users.sqlite` unless `USER_DB_PATH` says otherwise.
For syllabi, point `SYLLABI_DIR` at a scraper export such as the main checkout's `exported/syllabi`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port; default 3002 |
| `APP_URL` | Required. The public origin: the only `Origin` writes are accepted from, the base of canonical links, share and invite URLs, and `https://` makes cookies Secure |
| `DATABASE_PATH` | Kennel's SQLite path. When set, the personal database lives here and the pinned catalog release is installed beside it |
| `USER_DB_PATH` | Overrides the personal database path; default `DATABASE_PATH`, then `data/private/users.sqlite` |
| `CATALOG_DIR` | Directory holding `catalog.sqlite`; overrides the pinned release |
| `CATALOG_ENCRYPTION_KEY` | Base64 AES-256 key to decrypt the pinned release; only needed when installing one |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | The OIDC issuer, `<url>/realms/<realm>` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The OIDC client |
| `OAUTH_RELAY_URL` | The Ricochet callback relay registered with Keycloak |
| `PROJECT_ADMIN_GROUP` | Keycloak group path whose members get `isAdmin`; empty for none. Never grants CMU membership |
| `STATIC_DIR` | The built website. Enables `/course/{code}` and serves the SPA with `index.html` as the fallback |
| `SYLLABI_DIR` | Serve syllabi from this directory (development). Takes precedence over the bucket |
| `SYLLABI_BUCKET` | Serve syllabi from this S3-compatible bucket |
| `SYLLABI_PREFIX` | Key prefix inside the bucket; default `syllabi/` |
| `SYLLABI_S3_ENDPOINT` | Default `https://s3.scottylabs.org` (ScottyLabs Garage) |
| `SYLLABI_S3_REGION` | Default `us-east-1` |
| `SYLLABI_ACCESS_KEY_ID`, `SYLLABI_SECRET_ACCESS_KEY` | Required with `SYLLABI_BUCKET`; read-only keys for that bucket |
| `DEV_USER`, `DEV_USER_NAME` | Development sign-in, above |
| `RUST_LOG` | Log filter; default `info` |

Without `SYLLABI_DIR` or `SYLLABI_BUCKET` the server starts, logs a warning and answers `/api/syllabi/*` with 503.

## Sign-in and identity

Keycloak OIDC through `axum-oidc`, with the callback relayed by Ricochet. `GET /auth/login?returnTo=/path` runs the flow
and then redirects to `returnTo` when it's a path on this site (anything else, `/auth/*` included, becomes `/`).
`POST /auth/logout` signs out and answers 204; `GET /auth/logout` signs out and redirects to `/`.

A caller is a member only with a verified email at `cmu.edu` or a subdomain of it. Project groups never establish
membership. The Andrew ID is the email's local part; the owner of every personal record is the OIDC subject, never
anything the browser sends.

| Caller | Routes that need a member | Catalog documents |
| --- | --- | --- |
| Not signed in | 401 `auth` | Public versions; member-only documents 401 |
| Signed in without a verified CMU email | 403 `forbidden` | Public versions; member-only documents 403 |
| CMU member | Allowed | Member versions where they exist |

`GET /api/me` returns `{ subject, name, andrewId, email, isAdmin }` and records the caller's Andrew ID and name so
friends can find them by Andrew ID.

### Sessions

Sessions live in the personal database's `sessions` table ([ADR 23](../decisions/0023-persist-sessions-in-the-user-database.md)),
so restarts don't sign anyone out. Rows are keyed by the SHA-256 of the session id; the cookie value itself is never
stored. Each session is tagged with its owner's subject the first time it's used by a member, so deleting an account
signs out all of its sessions. The cookie is `cmu_courses_session`: HttpOnly, SameSite=Lax, Secure over https, expiring
after 14 days without a change. Expired rows are deleted at startup and hourly.

The session holds `axum-oidc`'s ID, access and refresh tokens. An expired ID token is refreshed with the refresh token,
and a failed refresh signs the session out, so Keycloak's token lifetimes still bound how long someone stays signed in.

## Conventions

- JSON field names are camelCase.
- Every request other than `GET`, `HEAD` and `OPTIONS` needs an `Origin` header equal to `APP_URL`, or it gets 403
  `forbidden` before anything else runs.
- Request bodies are limited to 128 KiB (413 `too_large`).
- Times are milliseconds since the epoch unless a field says otherwise.
- Errors are `{ "code", "message" }` with `code` one of `auth`, `forbidden`, `not_found`, `conflict`, `too_large`,
  `too_many`, `bad_request`, `unavailable`. A 409 adds `current`, the stored record. A 429 has `Retry-After` in seconds.
  Axum's own errors under `/api/` (malformed JSON, a wrong type, a missing route, a wrong method) are converted to this
  shape: 400 `bad_request` with the parser's message, 404 `not_found`, 405 with code `bad_request`. Unexpected failures
  are 500 with code `unavailable`; the cause is logged, not returned.
- Responses under `/api/` and `/auth/` get `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (syllabus PDFs:
  `SAMEORIGIN`), `Referrer-Policy: strict-origin-when-cross-origin`, a deny-all `Content-Security-Policy` unless they're
  HTML or set their own, `Cache-Control: no-store` unless they set their own, and `Vary: Cookie`. HSTS is added when
  `APP_URL` is https. Request logs record the method and path, never the query string, which can hold OAuth codes.

## Routes

Shapes are in `openapi.json`; this table is the summary. "Member" means a signed-in CMU user; "write" means a member
within the write limit below.

| Route | Access | Request | Response |
| --- | --- | --- | --- |
| `GET /api/health` | Anyone | | `{ status, catalogSchema }`, or 503 |
| `GET /api/me` | Member | | `Me` |
| `DELETE /api/account` | Write | | 204 |
| `GET /api/catalog/{*name}` | Anyone | | The document; see below |
| `GET /api/syllabi/{*key}` | Member | `?download=1` | The file; see below |
| `GET /api/terms` | Anyone | | `Term[]`, newest first |
| `GET /api/courses` | Anyone | `?search&term&department&level&units&page&pageSize` | `CoursePage` |
| `GET /api/courses/{code}` | Anyone | `?term` | `CourseDetail` |
| `GET /api/schedules` | Member | `?term` | `Schedule[]`, oldest first |
| `POST /api/schedules` | Write | `NewSchedule` | 201 `Schedule` |
| `PUT /api/schedules/{id}` | Write | `ScheduleUpdate` | `Schedule`; 409 `ScheduleConflict` |
| `DELETE /api/schedules/{id}` | Write | | 204 |
| `POST /api/schedules/{id}/share` | Write | | `{ shareId, url }` |
| `DELETE /api/schedules/{id}/share` | Write | | 204 |
| `GET /api/shared-schedules/{token}` | Anyone | | `SharedSchedule` |
| `GET /api/plans` | Member | | `Plan[]`, oldest first |
| `POST /api/plans` | Write | `NewPlan` | 201 `Plan` |
| `PUT /api/plans/{id}` | Write | `PlanUpdate` | `Plan`; 409 `PlanConflict` |
| `DELETE /api/plans/{id}` | Write | | 204 |
| `GET /api/record` | Member | | `Record` |
| `PUT /api/record` | Write | `RecordUpdate` | `Record`; 409 `RecordConflict` |
| `GET /api/preferences` | Member | | `Preferences` |
| `PUT /api/preferences` | Write | `PreferencesUpdate` | `Preferences`; 409 `PreferencesConflict` |
| `GET /api/saved` | Member | | `{ courseId, savedAt }[]`, oldest first |
| `PUT /api/saved/{courseId}` | Write | | 204 |
| `DELETE /api/saved/{courseId}` | Write | | 204 |
| `GET /api/friends` | Member | | `Friend[]` |
| `POST /api/friends` | Write | `{ andrewId }` | `Friend` (outgoing) |
| `POST /api/friends/{id}/accept` | Write | | 204 |
| `DELETE /api/friends/{id}` | Write | | 204 |
| `POST /api/friends/invites` | Write | | `{ token, url, expiresAt }` |
| `GET /api/friends/invites/{token}` | Member | | `InviteInfo`: the sender, for the invite page |
| `POST /api/friends/invites/{token}/redeem` | Write | | `Friend` (accepted) |
| `DELETE /api/friends/invites/{token}` | Write | | 204 |
| `GET /api/friends/sharing` | Member | | `{ shareCourses, shareSchedules }` |
| `PUT /api/friends/sharing` | Write | `{ shareCourses, shareSchedules }` | The same |
| `GET /api/friends/{id}/schedules` | Member | `?term` | `FriendSchedule[]` |
| `GET /api/friends/courses` | Member | `?term` (required) | `{ [courseId]: string[] }` |
| `GET /api/finals` | Member | `?term&courses` | `FinalExam[]` |
| `POST /api/finals/import` | Write | `?term`, multipart `calendar` | `FinalExam[]` |
| `DELETE /api/finals/import` | Write | `?term` | 204 |
| `GET /auth/login` | Anyone | `?returnTo` (`?as` in development) | Redirect |
| `GET`, `POST /auth/logout` | Anyone | | Redirect to `/`, or 204 |
| `GET /course/{code}` | Anyone | | The website with the course's head tags (with `STATIC_DIR`) |
| `GET /sitemap.xml`, `/robots.txt` | Anyone | | Search-engine files |
| `GET /api/openapi.json`, `/api/scalar` | Anyone | | The OpenAPI document and its viewer |

Friend routes take the friendship's `id` from `GET /api/friends`, not a user id. Unknown `/api/` routes are 404
`not_found`.

## Catalog documents

`GET /api/catalog/<name>` serves a document from `catalog.sqlite`, such as `terms`, `term/S27` or `fce/courses/15`
(the list is in [Courseweave features](../courseweave.md#catalog-documents)).

- A member gets the member version when there is one, otherwise the public version. Everyone else gets the public
  version. A document with only a member version is 401 `auth` signed out and 403 `forbidden` for a non-CMU account. An
  unknown or malformed name is 404.
- The stored gzip is sent as-is with `Content-Encoding: gzip` when `Accept-Encoding` allows gzip, and decompressed
  otherwise.
- `ETag` is the quoted SHA-256 of the uncompressed JSON, so the public and member versions have different tags.
  `If-None-Match` with a matching tag answers 304 with no body.
- `Cache-Control: private, no-cache` and `Vary: Cookie, Accept-Encoding`: the browser keeps its copy and revalidates on
  each load; shared caches don't keep it.

Readers come from a small pool (up to 8) and run on blocking threads.

## Public course API

Served from the catalog's relational tables, which hold public fields only.

- `GET /api/terms`: `{ id, name, season, year }`, newest first.
- `GET /api/courses`: `{ items, total, page, pageSize }`, items `{ id, code, title, department, units, unitsMax }`.
  - `search`: a course number or its start (`15-122`, `15122`, `15-1`, `15`) matches by number; anything else is a
    full-text search of codes, titles and descriptions, every word a prefix, ranked by relevance.
  - `term`: offered in that term. `department`: a department name, case-insensitive, or a two-digit prefix.
    `level`: 100 to 900 in hundreds, matching the course number's hundreds digit. `units`: courses that can be taken
    for that many units.
  - `page` from 1 (default 1); `pageSize` 1 to 100 (default 20). Out-of-range values are 400.
- `GET /api/courses/{code}`: `15-122` or `15122`. The course with `description`, `prerequisites`, `corequisites` and its
  `offerings` (newest first). With `?term=S27`, also `sections` in that term: `{ name, kind, parent, mini, meetings }`,
  meetings `{ days, start, end }` with days 0 (Monday) to 6 and times in minutes after midnight.

## Personal records

Schedules, plans, the academic record, preferences and saved courses, each scoped to its owner in every query. The body
types mirror Courseweave's TypeScript and are validated for shape and bounds; unknown fields are ignored.

| Record | Shape | Limits |
| --- | --- | --- |
| Schedule | Courseweave's `Schedule` (`termId`, `name`, `entries`) plus `visibility`, `revision`, `shareId`, `createdAt`, `updatedAt` | 300 per student, 100 courses each |
| Plan | Courseweave's `Plan` (`name`, `programs`, `startTerm`, `terms`) plus `revision`, `createdAt`, `updatedAt` | 50 per student; 40 terms, 40 courses a term, 10 programs |
| Record | Courseweave's persisted record (`entries`, `overrides`, `profile`) plus `revision`, `updatedAt` | 600 entries, 600 overrides |
| Preferences | `calendarDisplay` (`{ section, time, location, title }`), `activeSchedule` (term to schedule id), `activePlanId`, `planLayout` (`cards` or `table`), `sectionPicker` (`dropdown` or `compact`), `onboarding` (`{ asked, promptHidden }`), plus `revision`, `updatedAt` | 100 active schedules |
| Saved course | `{ courseId, savedAt }` | 1000 per student |

Names are 1 to 120 characters after trimming. Course ids are five digits (`15122`), terms look like `S27`, `M26` or
`F26`, and client-made ids are 1 to 64 letters, digits, `-` or `_`.

### Revisions

Every schedule, plan, record and preferences document has a `revision`. A write sends the revision it was based on; the
server stores the change only if that is still the stored revision, and returns the record with the next revision.
Otherwise it answers 409:

```json
{ "code": "conflict", "message": "...", "current": { "...": "the stored record" } }
```

The website merges its change into `current` with Courseweave's merge rules and writes again.

- Schedules and plans are created with `POST` at revision 1. A `POST` may name its own `id`, so a retried create can't
  make two: when that id already exists for the caller, the answer is 409 with it. Without one the server makes a UUID.
  Ids are per owner, so two students can use the same one. `PUT` to an id the caller doesn't have is 404.
- The record and preferences exist once per student. Before the first write, `GET` returns the defaults at revision 0
  with `updatedAt` 0, and a `PUT` with revision 0 creates it. A revision-0 write when one exists, or a later revision
  when none does, is 409 with `current` (revision 0 for a missing one).

### Write limits

- A stored record is at most 128 KiB of JSON (413 `too_large`).
- Each record takes at most 500 writes a UTC day, like Courseweave's synced documents. Beyond that a write is 429
  `too_many` with `Retry-After` set to the next UTC midnight.
- Each member makes at most 60 writes a minute across all routes (429 `too_many` with `Retry-After`). Reads aren't
  limited. Counters are in memory, which suffices for the single service instance per database.

### Schedules and the catalog

A schedule is checked against the catalog on every create and update:

- `termId` is a term in the catalog.
- Each `courseId` is offered in that term, and appears once.
- `section`, when set, is one of that course's top-level sections in the term (a lecture or a standalone section). A
  recitation or lab named as the section is refused with a message naming its lecture.
- `child`, when set, is a section whose parent is `section`; a child without a section is refused.
- `color` is a palette index from 0 to 63; section names are 1 to 16 characters.

Messages name the offending course, so the website can show which entry to fix. `visibility` is `private` (default) or
`friends`. A share link (`POST /api/schedules/{id}/share`) is a random token; creating it again returns the same one, and
`url` is `APP_URL/schedules/shared/<token>`. `GET /api/shared-schedules/{token}` returns `{ termId, name, entries, updatedAt }` to anyone with the link, never the owner, id, visibility or revision. Revoking it, or deleting the schedule,
ends access.

### Saved courses

`PUT /api/saved/{courseId}` saves a course from the catalog's course list, not tied to a term; saving it again changes
nothing. `DELETE` removes it and is a no-op when it isn't saved.

### The user database and its migration

`PRAGMA user_version` is 4. Opening an older database migrates it in one transaction, additively:

- A new or pre-versioned database first gets the version 3 schema, so every database takes the same path.
- Version 4 adds `user_schedules`, `user_plans`, `user_documents` (record and preferences), `user_saved`, `sessions`, a
  `health` row and `profiles.share_schedules`.
- Version 3 schedules are copied best effort: `15-122` becomes `15122`, duplicates and malformed codes are dropped, and
  old section ids can't be mapped to section names, so every entry starts with `section: null`. Names, share tokens and
  ids carry over, so old share links keep working. Unreadable rows are skipped.
- Version 3 saved courses with status `saved` are copied to `user_saved`. `taking` and `taken` history isn't converted.
- The version 3 `schedules` and `saved_courses` rows are left as they were.

A database newer than the build refuses to open.

## Friends

- A request names an Andrew ID of someone who has signed in once (`POST /api/friends`), or goes through an invite link
  (`POST /api/friends/invites`): single use, valid seven days, replacing the caller's previous link, with
  `url` `APP_URL/invite/<token>`. Redeeming an invite makes the two friends at once. Before that,
  `GET /api/friends/invites/{token}` tells a member who sent it (`name`, `andrewId`), when it expires and whether they
  made it themselves (`own`), without using it up; an expired, used or unknown token is 404
  ([ADR 38](../decisions/0038-show-an-invites-sender-before-it-is-accepted.md)).
- Only the recipient accepts a request. Either person can decline, cancel or remove (`DELETE /api/friends/{id}`), and
  access ends immediately.
- Friendship alone shares nothing. Each student chooses, with `PUT /api/friends/sharing`, whether accepted friends see
  their courses (`shareCourses`) and their schedules (`shareSchedules`). Both start off. Sharing is one-way: turning it
  on doesn't require or grant anything from the other side.
- `GET /api/friends` lists accepted friends and pending requests with `name`, `andrewId`, `status` (`accepted`,
  `incoming` or `outgoing`) and what each accepted friend shares with the caller (`sharesCourses`, `sharesSchedules`).
- `GET /api/friends/{id}/schedules?term=`: an accepted friend's schedules with visibility `friends`, as
  `{ id, termId, name, entries, updatedAt }`, when that friend shares schedules; an empty list when they don't. Not
  friends (or not accepted) is 404.
- `GET /api/friends/courses?term=S27`: `{ [courseId]: names[] }` of accepted friends taking each course that term. A
  friend counts as taking a course from the entries of their friends-visible schedules for the term that aren't hidden,
  when they share schedules, and from their record's in-progress courses (source `taken`, that term, no grade), when they
  share courses.

## Final exams

The registrar's schedule for everyone is the `finals/<term>` catalog document. These routes are a student's own SIO
calendar import.

- `POST /api/finals/import?term=S27` takes one multipart field `calendar`: a UTF-8 `.ics` file of at most 120 KiB. Events
  mentioning "final" whose summary names a course offered that term are kept, as `{ courseId, courseCode, title, startsAt, endsAt, location }` with RFC 3339 UTC times. UTC and `TZID` times are supported; floating times are
  Pittsburgh time. Recurring finals, ambiguous local times, durations over 12 hours and dates outside the term are
  refused. A calendar with no matching finals is refused and the previous import kept.
- `GET /api/finals?term=S27&courses=15122,21-127` lists the import, optionally filtered by ids or codes. Imports from the
  first backend (snake_case fields) are read and converted.
- `DELETE /api/finals/import?term=S27` removes the caller's import for the term.

## Syllabi

`GET /api/syllabi/<term>/<dept>/<file>` serves a past syllabus to members only (401 signed out, 403 for non-CMU
accounts). Keys follow the registry layout, ported from Courseweave's `isSyllabusKey`: a term `[SMNF]` plus two digits, a
department of 1 to 6 uppercase letters or digits, and a file name of 1 to 200 characters that doesn't start with `.`,
has no `\` or control characters, and ends in `pdf`, `docx`, `doc`, `pptx`, `odt`, `rtf`, `txt` or `html`. Other keys,
and files that don't exist or are over 50 MB, are 404. Without configured storage it's 503 `unavailable`.

- PDFs are shown in the page: `Content-Disposition: inline`, `X-Frame-Options: SAMEORIGIN` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'self'`. `?download=1` downloads them instead.
- Every other type is an attachment with `X-Frame-Options: DENY` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`, so nothing uploaded to the registry runs
  on this site.
- The saved file name is `<term>-<file>`, such as `F25-21241-1.pdf`, with an ASCII `filename` and a UTF-8 `filename*`.
- `Cache-Control: private, max-age=3600`, `Vary: Cookie`, an `ETag` (the object's, or size and modification time for a
  directory), and 304 on a matching `If-None-Match`.

Files come from the bucket in `SYLLABI_BUCKET` under `SYLLABI_PREFIX`, or from `SYLLABI_DIR`
([ADR 24](../decisions/0024-serve-syllabi-from-private-object-storage.md)). The scraper currently uploads syllabi to the
`cdn-courses` bucket under `syllabi/`, and that bucket is publicly readable: anyone who knows a key can fetch the file
from the CDN directly. The member check here only protects syllabi once they live in a private bucket.

## Search engines

With `STATIC_DIR` set, `GET /course/{code}` (`15-122` or `15122`) serves the website's `index.html` with the course's
head tags ([ADR 25](../decisions/0025-render-course-head-tags-on-the-server.md)), ported from Courseweave's
`scripts/build-seo.ts`:

- `<title>15-122 Principles of Imperative Computation | CMU Courses</title>`, a description of at most 158 characters
  (code, title and units, then the start of the course description), a canonical link to `APP_URL/course/15-122`,
  Open Graph tags, and schema.org `Course` JSON-LD with the course's name, code, URL, description and prerequisites.
- A `<noscript>` summary after `<body>`: the title, units, description, prerequisites and the terms it was offered.
- The template's own description, canonical link and `og:` tags are removed first. Text is HTML-escaped, and `<` in the
  JSON-LD is written as `<`.
- Only public catalog fields, from the relational tables. Unknown codes, courses titled with just their number, and a
  template without `</head>` or `<body>` get the plain website.

`GET /sitemap.xml` lists `APP_URL/` and every course with a description or an offering, with `lastmod` from the
catalog's `built_at` (or `build_time`) meta value when it's a date. `GET /robots.txt` disallows `/api/`, `/auth/`,
`/schedules`, `/plan`, `/profile`, `/finals` and `/instructors`, and names the sitemap. Both are served with or without
`STATIC_DIR`.

## Health

`GET /api/health` is 200 `{ status: "ok", catalogSchema }` when a fresh reader opens the catalog with this build's
schema version and a write to the personal database commits. Otherwise 503. Kennel checks it before routing traffic.

## Account deletion

`DELETE /api/account` deletes, in one transaction, every row the caller owns: schedules, plans, the record,
preferences, saved courses, final exam imports, invites, the version 3 schedule and saved-course rows, friendships on
either side, the profile and every session, then clears the current session. Friends stop seeing the caller at once.

## Tests

`cargo test -p courses-web-api` runs the unit tests and router tests that go through the production layers, with an
`x-test-user` header naming the caller (compiled only in tests) and a catalog built with `courses_catalog::Writer`.
They cover ownership isolation, revisions and 409 bodies, catalog validation, the version 3 migration, document
audiences and 304s, syllabus gating and headers, course page escaping, friends' visibility, account deletion, write
limits, the Origin guard, sessions and the release manifest. `cargo test -p courses-web-api --features dev-auth` adds
the development sign-in tests.

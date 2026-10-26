# Courseweave

A CMU course explorer, instructor directory, schedule planner and degree planner. Everything runs in the browser: course data is static JSON, and your schedules, record and plans are saved in local storage.

- **Courses**: search and filter every course in a semester, with sections (lectures and their recitations), FCE workload against units, an hours-vs-units chart, descriptions and requisites. Each course links to its prerequisite tree and everything it unlocks.
- **Instructors**: who teaches what, weekly timetables and evaluation history.
- **Schedule**: plan several versions of a semester; lecture + recitation choices, conflicts (mini-aware), a schedule generator, factorable vs pass/fail units, workload, requisite warnings, `.ics` export and share links.
- **Record**: courses taken, AP/IB/A-Level and transfer credit, placements and requisite waivers.
- **Degree**: semester-by-semester plans audited against CMU's degree requirements (majors, minors, concentrations, college gen-eds).

## Running it

```sh
npm install
npm run dev      # rebuilds data (npm run data), then starts Vite on :5173
npm test         # unit tests (vitest)
npm run build    # data + typecheck + production build into dist/
npm run deploy   # build and deploy to Cloudflare (see below)
```

## Data

`npm run data` runs four builds in order; outputs go to `public/data/` (gitignored).

| Script | Reads | Writes |
| --- | --- | --- |
| `scripts/build-catalog.ts` | Stellic catalog exports, cached SOC course details | `catalog/index.json`, `catalog/details/*`, `data/derived/pass-fail.json` |
| `scripts/build-fce.ts` | ScottyLabs `data/fces.csv` | `fce/*` |
| `scripts/build-programs.ts` | Stellic program exports | `programs/*` |
| `scripts/build-data.ts` | `data/terms.json` and its sources | `<TERM>.json`, `terms.json` |

Several inputs come from a checkout of the ScottyLabs courses repo (FCE CSV, Stellic exports). Its location is `data/sources.json` (`scottylabsDir`), overridable with `SCOTTYLABS_DIR`. Missing inputs are skipped and the matching features hide.

**FCE results are CMU-internal.** They stay in `public/data/fce/`, which is never committed. Don't deploy a build that includes them without CMU authentication in front of it.

### Terms and sources

Each entry in `data/terms.json` lists academic-calendar dates (classes, minis, breaks) and one or more `sources`. The first source is primary and defines the course list; later ones are supplements that fill in instructors, rooms and capacities, and can add missing sections. With `"addMissingSections": false` (when the SOC is primary, as it is for every term it lists), a supplement doesn't add sections or meetings at times the SOC doesn't list: next to the SOC's current times, its own are out of date or the same meetings split by day. `addMissingMeetings` overrides that part.

| Source | Input | Notes |
| --- | --- | --- |
| `csv` | `data/raw/<TERM>.csv` | Schedule CSV export (`num,title,units,section,lecture,days,...`). Primary until the SOC lists the term, then a supplement for instructors and rooms. |
| `soc` | `data/raw/soc/<TERM>/` | Public Schedule of Classes, cached by `npm run fetch:soc`. Has recitations, no instructors or rooms. |
| `stellic` | Stellic `getcoursesections` exports | Instructors, rooms, capacities, recitations. `npm run fetch:stellic -- <TERM>` fetches a term read-only with your session cookie (`COOKIE_HEADER`). |

Mini sections are detected from the section name's last digit when it matches one of the term's minis (A3 = Mini 3), so Mini 3 and Mini 4 sections at the same time don't conflict.

### Adding a semester

1. Run `npm run fetch:soc -- F27` once the Schedule of Classes lists it (or drop a CSV in `data/raw/`).
2. Add the term to `data/terms.json` with dates from the [official academic calendar](https://www.cmu.edu/hub/calendar/) and its sources.
3. Run `npm run data`.

### Keeping data fresh

The **Refresh course data** workflow (`.github/workflows/refresh-data.yml`) runs every Monday and Thursday, or any time from the Actions tab:

- It re-downloads the public Schedule of Classes. When sections really changed (not just the SOC's daily "last updated" stamp), it builds and tests the new data and opens a pull request on `data/schedule-of-classes` listing the added, removed and changed courses. When a semester that `data/terms.json` builds from something else appears on the SOC, the pull request also switches it to the SOC as its primary source, keeping its Stellic sections and schedule CSV as supplements.
- It keeps one **Data refresh checklist** issue for what CI can't do: newer FCE data from ScottyLabs, Stellic sections more than two weeks old for a term that hasn't ended (Stellic needs your CMU login), merged data the live site doesn't have yet, and semesters newly on the Schedule of Classes. The issue closes itself once everything is current.

Deploys stay on your machine, because a deploy also needs the Stellic and FCE data that live there. After merging a refresh pull request (or refreshing Stellic or FCE data), run `npm run data`, commit `data/derived/refreshed.json` if it changed, and `npm run deploy`. Pull requests from the workflow need **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

## Deploying to Cloudflare

Courseweave runs as a Cloudflare Worker that serves the built site as static assets (Cloudflare's successor to Pages). `wrangler.jsonc` configures it. `worker/` handles sign-in with a CMU account, keeps each user's schedules, record and degree plans in a D1 database, serves FCE data only to signed-in CMU users, and 404s missing data files.

Deploy from your machine, not from Cloudflare's Git builds: the data build needs local inputs (the ScottyLabs checkout, Stellic exports) that aren't in this repo.

### 1. Cloudflare (once)

1. Create a free account at <https://dash.cloudflare.com/sign-up>, then run `npx wrangler login`.
2. Create the database: `npx wrangler d1 create courseweave`. Paste the printed `database_id` into `wrangler.jsonc`, replacing the `00000000-…` placeholder.
3. Create its tables: `npm run db:migrate:remote`. Run it again whenever `migrations/` gets a new file.

### 2. Sign in with CMU (once)

Andrew accounts are CMU's Google Workspace accounts, so "Sign in with Google" goes through CMU's own login page (with Duo). The Worker only accepts verified emails on `ALLOWED_EMAIL_DOMAINS` (`andrew.cmu.edu` and `cmu.edu` by default), checks the ID token's signature, issuer, audience, expiry and nonce, and uses PKCE.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (any name, e.g. "Courseweave").
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen):
   - **Branding**: app name "Courseweave", your support email.
   - **Audience**: user type **External**, then **Publish app**. Only the `openid`, `email` and `profile` scopes are used, which need no Google verification. (In "Testing" mode only the test users you list can sign in.)
3. **Clients** → **Create client** → **Web application**. Under **Authorized redirect URIs** add:
   - `https://legacy.courseweave.jay3332.tech/auth/callback` (your deployed domain)
   - `http://localhost:8787/auth/callback` and `http://localhost:5173/auth/callback` for local development
4. Put the client ID in `wrangler.jsonc` under `vars.OIDC_CLIENT_ID`.
5. Store the secrets with Cloudflare (Wrangler offers to create the Worker if it doesn't exist yet):
   - `npx wrangler secret put OIDC_CLIENT_SECRET` (the client secret from step 3)
   - `npx wrangler secret put SESSION_SECRET` (any long random string, e.g. from `openssl rand -base64 32`)

Without `OIDC_CLIENT_ID`, the site still deploys: sign-in reports that accounts aren't set up, FCE data is left out of the upload, and everything else works locally in the browser as before.

### 3. Deploy

```sh
npm run deploy
```

This rebuilds the data, builds the site, decides what ships, and uploads. The site is at <https://legacy.courseweave.jay3332.tech> (see "Custom domain").

- FCE data ships only when sign-in is configured, and the Worker serves it only to signed-in CMU users (`Cache-Control: private`). `INCLUDE_FCE=0` / `INCLUDE_FCE=1` override the default.
- `npm run deploy` refuses to run while `wrangler.jsonc` still has the placeholder database id.
- `npm run deploy:dry-run` checks everything without uploading.
- When `migrations/` has a new file, run `npm run db:migrate:remote` **before** `npm run deploy` (the Worker expects the new columns). `0002_write_caps.sql` is one of these.

Redeploy the same way after updating data (`npm run fetch:stellic -- S27`, a new term, …).

Course schedules, catalog data and degree requirements stay public. Some of that (Spring 2027 sections, degree requirements) came from Stellic behind a CMU login; to put the whole site behind CMU sign-in instead, use Cloudflare Access: Workers & Pages → courseweave → **Access** → **Protect this Worker behind Access** → All traffic, allowing emails ending in `@andrew.cmu.edu`.

### Local development

- `npm run dev` runs the app alone; account features report themselves unavailable.
- For the full loop with sign-in and sync: copy `.dev.vars.example` to `.dev.vars` and fill it in, build once (`npm run build`), then run `npm run dev:worker` (applies migrations to a local database and starts `wrangler dev` on :8787) next to `npm run dev`. Vite forwards `/api` and `/auth` to the Worker. Locally the Worker sees every request as `http://localhost:8787` (`dev.host` in `wrangler.jsonc`), so signing in from :5173 comes back on :8787; the session cookie works on both ports.
- `npm run preview:worker` serves the exact production build on :8787.

### Other sign-in providers

Any OpenID Connect provider works: set `OIDC_ISSUER` to its issuer URL and use its client ID and secret. For example ScottyLabs' login service (which federates CMU login) if they register a client for you. CMU's own Shibboleth login is SAML; it needs CMU to register the app and an OIDC bridge (such as Keycloak) in front of it. `ALLOWED_EMAIL_DOMAINS` applies to every provider, which must return a verified `email` claim.

### Limits on the free plan

Requests to `/api`, `/auth` and `/data/fce` run the Worker (100,000 a day on the free plan); pages, scripts, styles and the other data files are served without it. D1's free tier allows 100,000 row writes and 5 million row reads a day and 5 GB of storage, far beyond a few hundred users' plans. When a daily limit runs out, Cloudflare refuses further requests until 00:00 UTC; nothing is billed on the free plan.

### Abuse protection

The Worker keeps one visitor (or a script) from using up those daily limits:

- **Rate limits** (Workers Rate Limiting, `ratelimits` in `wrangler.jsonc`), counted per Cloudflare location:
  - 120 requests a minute per IP across `/api`, `/auth` and `/data/fce`, checked before any database read
  - 10 sign-in starts or callbacks a minute per IP (each one calls Google)
  - 20 sync writes a minute per account
  - Over a limit, requests get `429` with `Retry-After`; the app pauses syncing and retries on its own, keeping changes on the device.
- **Daily write cap**: each synced document (schedules, record, plan) accepts 500 writes per UTC day. Edits are batched for 4 seconds, so normal use stays far below that. Documents are capped at 128 KiB.
- **Sessions**: at most 10 per account, the oldest dropped first; signing in again replaces the browser's previous session, and a daily Cron Trigger (`triggers` in `wrangler.jsonc`) deletes expired ones.
- **Sign-in**: Google accounts must belong to CMU's Workspace (the ID token's `hd` claim, not just an `@andrew.cmu.edu` address), and the provider's discovery document must name the configured issuer.
- **Responses** from the Worker carry `nosniff`, `X-Frame-Options: DENY`, HSTS and a deny-all CSP; logs drop query strings so sign-in codes never reach them (`observability.redact_query_string`).

Requests the Worker turns away still count toward its 100,000 a day. To stop a flood before it reaches the Worker, add one free WAF rule in the dashboard (once):

1. Cloudflare dashboard → the `jay3332.tech` zone → **Security** → **WAF** → **Rate limiting rules** → **Create rule**.
2. Name it "Courseweave API". Choose **Edit expression** and paste:

   ```
   (http.request.uri.path wildcard "/api/*") or (http.request.uri.path wildcard "/auth/*") or (http.request.uri.path wildcard "/data/fce/*")
   ```

   (The free plan matches on path only; this rule also covers any other site on the zone using those paths.)
3. **With the same characteristics**: IP. **When rate exceeds**: 20 requests per 10 seconds. **Then take action**: Block, **for duration** 10 seconds.
4. Deploy the rule.

The app makes a handful of these requests per page, so 20 per 10 seconds is only reached by scripts.

### Custom domain

The site is served at `legacy.courseweave.jay3332.tech`, set in `wrangler.jsonc`. Its old address,
`courseweave.jay3332.tech`, redirects to <https://courses.jay3332.tech>, Courseweave's features on ScottyLabs' CMU
Courses (the `scottylabs` branch).

```jsonc
"routes": [{ "pattern": "legacy.courseweave.jay3332.tech", "custom_domain": true }],
"workers_dev": false,
```

The domain's zone must be on the same Cloudflare account; `npm run deploy` creates the DNS record and certificate. To use another domain, change the pattern (or set `"workers_dev": true` to get a `*.workers.dev` address back), and add `https://<domain>/auth/callback` to the Google client's redirect URIs.

## Layout

```
scripts/                 data builds, source adapters (scripts/sources), fetchers, deploy checks
worker/                  Cloudflare Worker: CMU sign-in (OIDC), sessions and sync (D1), FCE gate
migrations/              D1 schema
src/lib/                 pure logic: types, time, sections, conflicts, search, generator, ics, share,
                         catalog, requisites, exam credit, FCE, audit engine, plans
src/state/               zustand stores (schedules, record, plans) and the routed term
src/components/          app shell, WeekGrid calendar, settings, small UI primitives
src/features/            explorer, instructors, planner, schedule-tools, catalog, fce, record, degree
```

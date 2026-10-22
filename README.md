# Courseweave

A CMU course explorer, instructor directory, schedule planner and degree planner. Everything runs in the browser: course data is static JSON, and your schedules, record and plans are saved in local storage.

- **Courses**: search and filter every course in a semester, with sections (lectures and their recitations), FCE workload against units, an hours-vs-units chart, descriptions and requisites.
- **Instructors**: who teaches what, weekly timetables and evaluation history.
- **Schedule**: plan several versions of a semester; lecture + recitation choices, conflicts (mini-aware), a schedule generator, factorable vs pass/fail units, workload, requisite warnings, `.ics` export and share links.
- **Requisites**: a course's prerequisite tree and everything it unlocks.
- **Record**: courses taken, AP/IB/A-Level and transfer credit, placements and requisite waivers.
- **Degree**: semester-by-semester plans audited against CMU's degree requirements (majors, minors, concentrations, college gen-eds).

## Running it

```sh
npm install
npm run dev      # rebuilds data (npm run data), then starts Vite on :5173
npm test         # unit tests (vitest)
npm run build    # data + typecheck + production build into dist/
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

Each entry in `data/terms.json` lists academic-calendar dates (classes, minis, breaks) and one or more `sources`. The first source is primary and defines the course list; later ones are supplements that fill in instructors, rooms and capacities, and can add missing sections.

| Source | Input | Notes |
| --- | --- | --- |
| `csv` | `data/raw/<TERM>.csv` | Schedule CSV export (`num,title,units,section,lecture,days,...`). |
| `soc` | `data/raw/soc/<TERM>/` | Public Schedule of Classes, cached by `npm run fetch:soc`. Has recitations, no instructors or rooms. |
| `stellic` | Stellic `getcoursesections` exports | Instructors, rooms, capacities, recitations. `npm run fetch:stellic -- <TERM>` fetches a term read-only with your session cookie (`COOKIE_HEADER`). |

Mini sections are detected from the section name's last digit when it matches one of the term's minis (A3 = Mini 3), so Mini 3 and Mini 4 sections at the same time don't conflict.

### Adding a semester

1. Run `npm run fetch:soc -- F27` once the Schedule of Classes lists it (or drop a CSV in `data/raw/`).
2. Add the term to `data/terms.json` with dates from the [official academic calendar](https://www.cmu.edu/hub/calendar/) and its sources.
3. Run `npm run data`.

## Layout

```
scripts/                 data builds, source adapters (scripts/sources), fetchers
src/lib/                 pure logic: types, time, sections, conflicts, search, generator, ics, share,
                         catalog, requisites, exam credit, FCE, audit engine, plans
src/state/               zustand stores (schedules, record, plans) and the routed term
src/components/          app shell, WeekGrid calendar, settings, small UI primitives
src/features/            explorer, instructors, planner, schedule-tools, catalog, fce, record, degree
```

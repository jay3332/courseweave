# Courseweave

A CMU course explorer, instructor directory and schedule planner. Everything runs in the browser: course data is static JSON, and your schedules are saved in local storage.

## Running it

```sh
npm install
npm run dev      # regenerates course data, then starts Vite on :5173
npm test         # unit tests (vitest)
npm run build    # data + typecheck + production build into dist/
```

## Course data

Raw Schedule of Classes exports live in `data/raw/`, one CSV per term, with the columns
`num,title,units,section,lecture,days,begin,end,bldg,room,mode,level,dept,instructors`.
`data/terms.json` lists the terms and their academic-calendar dates (used for mini-semesters, calendar export and holidays).

`npm run data` (`scripts/build-data.ts`) turns each CSV into `public/data/<TERM>.json` and writes `public/data/terms.json`. It:

- groups rows into courses → sections → meetings (a section can have several meeting rows),
- reads `-1` units as variable units,
- marks mini sections from the section name's last digit when it matches a mini in `terms.json` (e.g. `A3` = Mini 3 in spring), so Mini 3 and Mini 4 sections at the same time don't count as conflicts,
- detects cross-listed courses (same times, same room, shared instructor).

### Adding a semester

1. Save the CSV as `data/raw/F27.csv`.
2. Add an entry to `data/terms.json` with `id`, `name`, `season`, `year`, `source`, the minis (fall uses 1 and 2), `classesBegin`, `classesEnd` and `noClasses` ranges from the [official academic calendar](https://www.cmu.edu/hub/calendar/).
3. Run `npm run data`. The newest term becomes the default; the term picker in the header switches between them.

Spring 2027 dates come from the 2026-27 official calendar. That calendar doesn't list mini boundaries, so Mini 3 is taken to end the Friday before spring break and Mini 4 to start the Monday after.

## Layout

```
scripts/build-data.ts      CSV → JSON pipeline
src/lib/                   pure logic: types, time, conflicts, search, data indexing, generator, ics, share
src/state/                 zustand store (schedules, bookmarks, theme) and term loading context
src/components/            app shell, WeekGrid calendar, small UI primitives
src/features/explorer/     course search, filters, course detail
src/features/instructors/  instructor directory and timetables
src/features/planner/      schedule page
src/features/schedule-tools/  generator dialog, .ics export, share links
```

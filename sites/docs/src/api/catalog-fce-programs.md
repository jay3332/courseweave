# FCE and degree program documents

`courses-index build` writes two families of catalog documents ported from Courseweave: Faculty Course Evaluation
(FCE) results, from `scripts/build-fce.ts`, and Stellic degree programs, from `scripts/build-programs.ts`. Every
document is member-only: signed-out callers of `GET /api/catalog/<name>` get 401
([decision 16](../decisions/0016-serve-the-catalog-as-json-documents.md)). The JSON is Courseweave's, so its ported
TypeScript modules (`fce.ts`, `audit.ts`, `programs.ts`) read the documents unchanged.

The code is in `crates/courses-index/src/fce/` and `crates/courses-index/src/programs/`.

## Inputs

| Input | Where | Notes |
| --- | --- | --- |
| SmartEvals FCE export | `data/fces.csv`, committed | One row per instructor per section per term, Spring 2012 to Spring 2026 (90,050 rows) |
| Stellic degree programs | `exported/<andrew id>/programs/<catalogId>/<auditId>.json`, gitignored | `courses-scraper --mode programs`, scraped with one student's session; never committed |

## Entry points

```rust
// Reads <data_dir>/fces.csv.
courses_index::fce::write(writer: &courses_catalog::Writer, data_dir: &Path) -> anyhow::Result<fce::Summary>
// Reads <exported_root>/*/programs/.
courses_index::programs::write(writer: &courses_catalog::Writer, exported_root: &Path) -> anyhow::Result<programs::Summary>
```

Both store their documents with `Audience::Member` and return counts for the build log. When the input is missing
they log a warning, write nothing and return an empty summary, as Courseweave skips them. `fce::documents(csv_text)`
and `programs::documents(exported_root)` return the documents as `(name, JSON bytes)` pairs without a catalog.

## FCE documents

| Name | Contents |
| --- | --- |
| `fce/summary` | `{ latest, recentTerms, courses: { [courseId]: SummaryTuple } }`: each course's recent averages, for lists, sorting and the hours-versus-units chart |
| `fce/courses/<NN>` | `{ [courseId]: RowTuple[] }`: every row of the courses whose number starts with `NN`, such as `fce/courses/15` |
| `fce/courses/index` | The `NN` prefixes that have a `fce/courses/<NN>` document, sorted. New: Courseweave has no such file |
| `fce/instructors` | `{ instructors: { [nameKey]: { name, courses: { [courseId]: CourseTuple }, terms } } }`: each instructor's history |

The tuples are arrays, to keep the documents small:

- `RowTuple`: `[term, section, instructor, enrolled, responses, hours, teachingRate, courseRate, questions, mini]`.
  `instructor` is as the export spells it ("CERVESATO, ILIANO"), `questions` the seven teaching questions in export
  order, and `mini` the mini number or `null`.
- `SummaryTuple`: `[hours, courseRate, teachingRate, responses, recentTerms, totalTerms, lastTerm, hoursDelta, enrolledPerTerm, miniShare, miniHalf]`.
- `CourseTuple`: `[terms, responses, teachingRate, courseRate, hours, lastTerm, firstTerm]`.
- `terms`: `[term, teachingRate, responses][]`, oldest first, for the terms with responses.

### Reading the export

- Course numbers are normalized to five digits: "15-122" and "15122" to `15122`, "6222" to `06222`, "FA14-12-100"
  to `12100`. Terms are coded like `S26`, `M25` (summer) and `F25`.
- Rows without a course number, year or season are dropped (2 rows). Blank or non-numeric cells are `null`;
  enrollment and responses default to 0.
- Rows from every college are kept, including the 13 "Teaching Assistants" rows, as Courseweave keeps them.
- A section is a mini when its name ends in one of the season's mini digits after a letter code or lecture number:
  fall A1/B2, spring A3/B4, summer A5/B6. "13" is lecture 1 in mini 3; a single digit is a full-semester lecture.

### Aggregates

- Averages are weighted by responses. Rows without responses stay in the history but are never averaged.
- A course's recent window is its last 4 terms with responses; the previous window is the 4 terms before those.
- Co-taught sections have one row per instructor. Course-level values (hours and course rating) are first averaged
  within each section, and the section then counts with its largest response count and largest enrollment. The
  teaching rating is averaged over rows, since each row rates a different instructor.
- In `SummaryTuple`, hours are rounded to 0.1 and ratings to 0.01, halves up as `Math.round` does. `responses` sums
  the recent sections. `hoursDelta` is recent hours minus the previous window's, when both exist. `enrolledPerTerm`
  is the recent sections' enrollment over the recent terms, rounded to a whole number. `miniShare` is the share of
  recent sections that were minis (to 0.01) and `miniHalf` which half they ran in: 0 none, 1 first, 2 second, 3
  both.
- Instructors are keyed by first given name and full last name, lowercase and without accents
  (`"iliano|cervesato"`, `"claire|le goues"`), so spellings across terms merge. The display name prefers a
  mixed-case spelling, then the most common, written first-name first with all-caps words title-cased. A
  `CourseTuple` counts the terms the instructor taught the course (with or without responses) and averages the rows
  with responses.
- Course rows are newest first, then by section, then by instructor, compared with Unicode collation
  ([decision 21](../decisions/0021-sort-catalog-strings-with-unicode-collation.md)).

## Instructor list documents

`crates/courses-index/src/instructors.rs` also writes, member-only, `instructors/<termId>` for each semester and
`instructors/all`: the rows of the website's instructor list (`/instructors`), so the list doesn't load the whole
semester, `fce/instructors` and the course catalog to show names
([decision 43](../decisions/0043-list-instructors-from-their-own-documents.md)). They're new in CMU Courses.

```json
{
  "titles": { "15112": "Fundamentals of Programming and Computer Science" },
  "instructors": [
    {
      "name": "David Kosbie",
      "depts": ["CS"],
      "courses": ["15112", "15151"],
      "sections": 4,
      "topics": { "15390": ["Robotics"] },
      "terms": ["S27", "F26"],
      "fce": { "rating": 4.52, "courses": ["15110", "15112"] }
    }
  ]
}
```

| Field | Contents |
| --- | --- |
| `titles` | The title of every course listed, for search: the semester's own, or for all semesters the newest semester's, then the course catalog's (titles that only repeat the course number are left out) |
| `instructors` | In the order the website numbers repeated URL slugs: a semester's in the order its sections first name them, all semesters' in `teaching` order and then the people only FCEs know |
| `name` | As the Schedule of Classes prints it; people only FCEs know get their FCE name, first name first |
| `depts`, `courses`, `sections` | A semester's departments and courses in the order its sections name them, counting the sections they teach (recitations that repeat their lecture's instructors don't count). For all semesters, `teaching`'s departments, the sorted courses of every semester and the section total; people only FCEs know get the departments of their FCE courses |
| `topics` | Semesters only, left out when empty: titles of sections that differ from their course's, by course |
| `terms` | All semesters only: the built semesters they teach in, newest first |
| `fce` | Left out when no FCE record matches the name (matched as `fce::names::NameIndex` matches it). `rating` is the teaching rating over their last 4 semesters with responses, weighted by responses, to 0.01, or null; `courses` the courses `fce/instructors` lists for them, which say which `fce/courses/<NN>` hold their rows |

On 2026-10-24's catalog a semester's list was about 420 KB of JSON (95 KB gzipped) and `instructors/all` 1.4 MB
(270 KB gzipped).

## Program documents

| Name | Contents |
| --- | --- |
| `programs/index` | `ProgramsIndex` (`plan-types.ts`): `{ programs: { catalogId, name, kind, versions }[] }`, sorted by name. `versions` are `{ auditId, name, entryYear, campus }`, newest entry year first, Pittsburgh first among equals |
| `programs/<auditId>` | `ProgramVersion` (`degree-types.ts`): one audit version's requirement tree with `totalUnits`, `attached`, `doubleCount` and `concentrations` |

### Reading the exports

- Every `programs/` directory under `exported/` is read. When several exports have the same audit version, the file
  modified last wins.
- Versions whose program or audit name starts with "DELETE" are dropped.
- `kind` comes from Stellic's program type: major, minor, additional-major, requirements (bundles such as gen eds
  and concentrations) or track.
- A version's name is the audit name before " - " ("EY2025 Pittsburgh - BS in ..." gives "EY2025 Pittsburgh"), or
  "EY<year>" or "Current" when Stellic calls it "Published". The entry year comes from "EY2025" or "(2025)" in the
  audit or program name, the campus from a campus name in either (Qatar is Doha).

### Requirement trees

Each Stellic node becomes a `ReqNode` with `children` from its choices. Constraints the audit can evaluate become
fields; the rest become `notes`, Stellic's own wording.

| Stellic constraint | `ReqNode` field |
| --- | --- |
| `course`, `coursesection` | `course: { id, section? }` |
| `anyxof` | `rule`: all, any or `atLeast n` of the children |
| `minxunits`, `minxcourses` | `minUnits` or `minUnitsEach`, `minCourses` |
| `xfromcourseset`, `coderange`, `xfromdepts`, `xfromallcourses` | `pool` on a leaf, `conditions` on a group; at-most rules go to `caps`, inverse rules with no count to `exclude` |
| `notcountcourseset` | `exclude` |
| `mingrade`, `cancountungraded`, `notcountbeforeusem` | `minGrade`, `allowPassFail`, `window` |
| `repeatx`, `repeatxcourses` | `repeat` |
| `dc` | `shareWithin` below the root or for subrequirements; otherwise a `doubleCount` rule of the version |
| `programdependentanyxof` | `programDependent`, when it depends only on programs |
| `noncourse`, `staticonly` | `manual`, with a note |
| `alwayshide` | `onlyIfAttempted` |

Course sets become `PoolSet`s of courses, five-digit ranges, any-department ranges, department prefixes, wildcard
patterns ("15-3\*\*" as a regex source) and term windows; a college ("School of Computer Science") is its
departments. A leaf with nothing to evaluate is a manual check; a leaf with only a unit or course minimum counts any
course.

The root's unit minimum is the version's `totalUnits`. For majors and additional majors it's removed from the root,
so it isn't reported twice.

### Bundles and concentrations

- `attached`: the requirement bundles a version's `doubleCount` rules name (or, for programs not exported, ones
  named like "General Education", "Degree Check" or "Core Requirements"), each at the version for the major's entry
  year and campus. Among the bundle's versions for that campus or no campus (all of them when there are none), it's
  the newest that started by the entry year, or else the newest. Concentration bundles are picked the same way.
  Where Stellic splits a bundle into one program per entry year ("EY2020 SCS - General Education" to "EY2023+ SCS -
  General Education"), the website checks the one for the plan's entry year instead of the one named here, and points
  the major's sharing rule at it ([decision 46](../decisions/0046-check-year-split-gen-eds-at-the-plans-entry-year.md)).
- `concentrations`: each of the major's Stellic concentrations with up to three requirement bundles whose names
  contain the concentration's, best first. A bundle scores for being named a concentration or track, for sharing
  words with the major's name, for the major's department, and for the major's campus; it loses for another
  department, another campus (heavily) and words in neither the concentration's nor the major's name. Ties go by
  name.

## Differences from Courseweave

- No `generatedAt` in `fce/summary`, `fce/instructors` or `programs/index`
  ([decision 22](../decisions/0022-leave-build-times-out-of-fce-and-program-documents.md)). Nothing reads it.
- `fce/courses/index` is new.
- Object keys are written in sorted order rather than JavaScript's insertion order, so the bytes differ while the
  parsed JSON is identical.

## Verifying against Courseweave

An ignored test builds every document from the real inputs and compares each with Courseweave's file, as parsed
JSON:

```sh
COURSEWEAVE_DATA=~/Projects/cmu-course-planner/public/data \
EXPORTED_ROOT=~/Projects/scottylabs/courses/exported \
  cargo test --release -p courses-index --test courseweave_parity -- --ignored --nocapture
```

On 2026-10-24 every document matched: 62 FCE documents (9.7 MB of JSON, 2.3 MB gzipped) built in about 0.5 s, and
2,962 program documents for 1,342 programs and 2,961 versions (34.2 MB, 4.7 MB gzipped) in about 1.2 s.

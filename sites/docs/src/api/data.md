# Catalog data and releases

`courses-index build` turns the raw inputs into one file, `catalog.sqlite`
([decision 15](../decisions/0015-build-the-catalog-in-rust.md)). It ports Courseweave's data scripts, so its JSON
documents match the files they write ([decision 16](../decisions/0016-serve-the-catalog-as-json-documents.md)). The
FCE and degree program documents are described in [their own page](catalog-fce-programs.md).

## Inputs

| Path | Contents | Producer |
| --- | --- | --- |
| `data/terms.json` | The terms to build: ids, names, dates, minis, breaks and each term's sources | Committed, edited by hand |
| `data/fces.csv` | SmartEvals FCE export | Committed |
| `data/finals/<term>.pdf`, `data/finals/<term>-<part>.pdf` | The registrar's final exam schedules | Committed; public documents |
| `exported/<andrew id>/courses_history/<course>/info.json` | Stellic course info: requisite trees, grading, offering tags, profiles | `courses-scraper --mode courses` |
| `exported/<andrew id>/courses_history/<course>/ly<n>_sm<s>.json` | Stellic sections, with instructors, rooms and recitations | `courses-scraper --mode courses` |
| `exported/<andrew id>/programs/` | Stellic degree programs | `courses-scraper --mode programs` |
| `exported/syllabi/<term>/<dept>/` | Syllabus registry files | `courses-scraper --mode syllabi` |
| `exported/soc/<term>/` | Schedule of Classes search pages, detail pages, reservations and `meta.json` | `courses-scraper --mode soc` |
| `exported/soc/details.json` | Parsed course detail pages, for descriptions and requisite text | `courses-scraper --mode soc --soc-catalog` |
| `exported/schedules/<term>.csv` | A registrar schedule CSV for a term the SOC doesn't list yet | Downloaded by hand |
| `exported/stellic-terms/<term>/` | Stellic sections fetched for one term, with a `meta.json` naming its `lyear` and `sem` | Courseweave's `fetch-stellic.ts` |

`exported/` is gitignored and never committed: the Stellic data and syllabi are CMU-internal and were scraped with one
student's session. Without it, nothing builds.

### `data/terms.json`

Each term lists its sources in order. The first is primary and defines the course list; later ones are supplements,
which add instructors, rooms, capacities and missing sections but never remove anything.

| Source | Options |
| --- | --- |
| `{ "type": "soc", "term": "F26" }` | `term`: the SOC capture to read (default the term's id). `campuses`: keep sections at campuses starting with these names (default `["Pittsburgh"]`, `["*"]` for all) |
| `{ "type": "csv", "path": "schedules/S27.csv" }` | `path`: relative to the exported root |
| `{ "type": "stellic", "lyear": 1, "sem": 1 }` | `dir`: relative to the exported root, default the one account's `courses_history`. `lyear`: Stellic's academic year counted from the exporting account's first term. `sem`: 1 fall, 2 spring, 3 summer. Both may come from `<dir>/meta.json`. `optional`: skip a missing export |

Any source takes `role` (`primary` or `supplement`); supplements take `addMissingCourses` (default false),
`addMissingSections` (default true; false when the primary is the SOC, which drops cancelled sections) and
`addMissingMeetings` (default `addMissingSections`). Without `addMissingMeetings`, a supplement fills in rooms for the
primary's meetings and times for its TBA sections, but adds no meetings at other times: next to the SOC's current
times, a supplement's are out of date or the same meetings split by day, and would show as conflicts.

`lyear` values are relative to one Stellic account. With several accounts under `exported/`, pass `--stellic-user`.

## Building

```sh
cargo run --release -p courses-index -- build
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--exported <dir>` | `exported` (or `EXPORTED_ROOT`) | The scraper's output root |
| `--data <dir>` | `data` | `terms.json`, `fces.csv` and `finals/` |
| `--output <file>` | `data/catalog/catalog.sqlite` | Written to a temporary file and moved into place when complete |
| `--term <id>` | every term | Build only these terms (repeat or separate with commas). `terms`, `offerings` and `teaching` then cover only them |
| `--stellic-user <andrew id>` | the only account | Whose Stellic export `lyear` refers to |
| `--dump <dir>` | none | Also write every document as JSON: `<dir>/public/<name>.json`, and `<dir>/member/<name>.json` for what a signed-in user gets |

A full build takes about four seconds and prints each term's course and section counts. The same inputs always give
the same bytes: collections are sorted, gzip has no timestamps, and nothing reads the clock. Each term's `generatedAt`
is the newest fetch time its sources record, the catalog's is the SOC details' fetch time, and the `build`
document's is `SOURCE_DATE_EPOCH` when set, otherwise the newest input time.

## Outputs

`catalog.sqlite` holds:

- `documents(name, audience, etag, bytes, gzip)`: the JSON documents, gzipped, one row per audience. The public
  version is what signed-out visitors get; the member version, when there is one, is what signed-in CMU users get.
- `terms`, `courses`, `offerings`, `sections`, `meetings` and the `course_search` index: public fields only, for the
  public course API and server-side checks.
- `meta`: `schema_version`, `generated_at`, `version` and `inputs`, a summary of what was read.

| Document | Contents | Public | Member |
| --- | --- | --- | --- |
| `build` | `{ version, generatedAt, schemaVersion, terms }`. `version` changes whenever any document does | yes | same |
| `terms` | Courseweave's `TermIndexEntry[]`, newest first | yes | same |
| `term/<id>` | Courseweave's `TermData`: every course, section and meeting | instructors emptied, `building` and `room` null ([decision 20](../decisions/0020-redact-public-term-documents.md)) | full |
| `offerings` | Which terms offer each course | yes | same |
| `catalog/index` | Requisites, grading and offering pattern of every course | yes | same |
| `catalog/details/<NN>` | Descriptions, websites, attributes, profiles and SOC notes, by course-number prefix | yes | same |
| `teaching` | Who teaches what in each term | no | full |
| `syllabi/<NN>` | Past syllabi: registry files (identical copies merged) and Canvas page links | no | full |
| `finals/<id>` | Final exams ([decision 19](../decisions/0019-parse-the-registrars-final-exam-schedule.md)) | instructors emptied | full |
| `fce/*`, `programs/*` | See [FCE and degree program documents](catalog-fce-programs.md) | no | full |

## Refresh procedure

1. Capture the Schedule of Classes for the terms it lists. It needs no credentials:

   ```sh
   cargo run --release -p courses-scraper -- --mode soc --soc-catalog
   ```

   `--soc-terms F26,S27` limits the terms; `--soc-extras all` re-reads every course's reservations instead of a
   rotating slice. Keep earlier captures: the SOC stops listing past terms.

1. Refresh Stellic course info and sections (`--mode courses`, or `--mode courses --term S27` for one term), degree
   programs (`--mode programs`) and syllabi (`--mode syllabi`). These need a CMU session; see the scraper's usage notes
   in `sites/docs-migrating-wip/src/scraper/running.md`.

1. For a new term, add it to `data/terms.json` with the registrar's calendar dates, minis and breaks, and its sources.
   Until the SOC lists it, use the registrar's schedule CSV in `exported/schedules/` as the primary source.

1. When the registrar publishes a final exam schedule, save it as `data/finals/<term>.pdf` (a mini's separate
   schedule as `data/finals/<term>-<part>.pdf`) and commit it. The build fails if a row can't be read.

1. Build, and review the printed counts against the previous build.

1. Publish (below).

## Checks

- `cargo test -p courses-index` runs the unit tests and `tests/build.rs`, which builds a tiny synthetic catalog
  twice and checks that the two files are identical and that each document reaches the right audience.

- With Courseweave's checkout, its built files are an oracle: the parity test builds everything from the same inputs
  and compares. Semester and catalog documents match byte for byte apart from `generatedAt`:

  ```sh
  COURSEWEAVE_DATA=~/Projects/cmu-course-planner/public/data EXPORTED_ROOT=exported \
    cargo test --release -p courses-index --test courseweave_parity -- --ignored --nocapture
  ```

- `cargo test --release -p courses-index -- --ignored reads_the_committed_pdfs` parses the committed final exam
  schedules.

## Production artifacts

`scripts/publish_catalog.py` gzips and encrypts `data/catalog/catalog.sqlite` with AES-256-GCM and a fresh random
nonce, uploads it, and writes `deployments/catalog.json` only after the upload succeeds. The key comes from
`CATALOG_ENCRYPTION_KEY`; it is never committed or placed in browser code. The manifest holds only the artifact's URL,
sizes and SHA-256 digests. See the [deployment runbook](../deployment.md) for the full release procedure.

Never put `exported/`, an unencrypted catalog or the personal database in the static site or a public bucket: the
member documents are CMU-internal.

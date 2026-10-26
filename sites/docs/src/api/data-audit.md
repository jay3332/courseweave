# Source data audit - October 23, 2026

This audit describes the inputs of the Python importer, which `courses-index build` replaced
([decision 15](../decisions/0015-build-the-catalog-in-rust.md)). The current inputs and refresh procedure are in
[catalog data](data.md).

The entire supplied `/Users/etashj/Downloads/data` directory was copied into
`data/raw`. **90,778 non-DS_Store files, 1,718,136,834 bytes** were checked against
a SHA-256 inventory with zero mismatches. The original Downloads folder is
unchanged. `data/catalog/inventory.json` records every file, including old backups;
`data/catalog/report.json` records the import counts and warnings. Raw and derived
data are local artifacts, not committed or placed in the frontend's static folder.

## Coverage and freshness

| Dataset | Available coverage | Interpretation |
| --- | --- | --- |
| Courses | 10,089 distinct merged course codes | Stellic course info plus legacy course records; not all are currently offered |
| Schedules | 48,796 legacy course/term records; 100,541 merged section records | Legacy export includes 3,355 course records for Fall 2026, 3,315 for Spring 2026, and 114 for Summer 2026 |
| Stellic sections | Dated starts August 30, 2021-June 30, 2025 | Older than the legacy schedule export; dates come from records, not `ly*` filenames |
| Offering metadata | 2015-Fall 2026 | Spring 2027 is absent; metadata alone does not establish a complete section schedule |
| FCE CSV | 90,052 rows, 2012-2026; 3,566 rows in 2026 | This is newer than the Mongo FCE export and is the selected aggregate source |
| Mongo FCEs | 447,411 rows, 2012-2025 | Retained, not combined with CSV; repeated historical records would bias aggregates |
| Gen ed mappings | 1,679 course rows, 35 school/category groups | 758 rows labeled October 2024, 319 May 2025, 602 undated |
| Syllabi | 19,794 links, 2018-2025 | Imported for authenticated users; link availability was not individually tested |
| Instructors | 3,534 Stellic identities | Catalog identity coverage is incomplete relative to names in legacy schedules; legacy professor export is retained |
| Stellic programs | 2,848 audits for 1,291 program IDs | Includes historical entry-year variants; newest explicitly labeled entry year is 2026; no verified retrieval timestamp |
| Current public requirements | 204/204 discovered program pages | Scraped October 23, 2026, all labeled **2026-2027**, zero failed pages; includes majors, additional majors and minors |
| Advanced credit | AP, IB, Cambridge and non-offered-course files | Preserved in raw data; not yet exposed as scheduling equivalency rules |
| Finals | Existing repository `data/exams.pdf` | Not imported; no verified current finals feed in this migration |

File modification/copy timestamps are **not** evidence of scrape freshness.
Fall 2026 schedule coverage is useful, but its exact retrieval date is unknown.
The newer public requirements come from the official
[Programs A-Z](https://coursecatalog.web.cmu.edu/programs/) and are archived in
`data/programs-current` with source URLs, HTML hashes and retrieval timestamps.
This verifies all links discovered by the scraper, not every possible graduate
or unpublished program.

## Import choices and limitations

- Prefer Stellic course details; retain legacy-only course codes and department
  labels. Prefer dated Stellic sections for overlapping course/terms; retain
  newer legacy terms. Keep only explicit fields intended for the app.
- FCE summaries are respondent-weighted across the available CSV history;
  teaching-assistant rows are excluded. They are not "current semester ratings."
- Two Stellic sections lack dates (`11605/ly3_sm3.json`,
  `36641/ly3_sm3.json`) and are omitted from the normalized schedule, with warnings.
  Their source files are retained.
- Raw exports may include student-specific context. Those fields are not copied
  to the public/member course payloads. All older snapshots, legacy professors,
  raw FCE rows, advanced-credit data and ancillary files remain available locally.
- Variable/unknown-unit courses currently use the numeric source value where
  available, otherwise zero. A future range/variable-units UI should distinguish
  these rather than treating zero as a confirmed fixed unit count.
- The requirements UI shows source text or versioned trees and stores the chosen
  program with a personal schedule. It does not yet certify degree completion,
  elective eligibility, substitutions, or double-counting rules.

For registration-quality planning, refresh sections for the target term,
especially Spring 2027. The existing authenticated Stellic scraper supports
courses and program requirements; commands and access requirements are in
[web API](./web-api.md). No live Stellic session was used here.

## Spring 2027 refresh from CourseWeave

Imported the public [CourseWeave S27 snapshot](https://courseweave.jay3332.tech/data/S27.json): **3,085 courses and 6,760 sections**, across all departments. The snapshot reports generation at **2026-10-24 00:37:00 UTC (October 23, 8:37 p.m. EDT)** and upstream sources `csv` and `stellic`. This is the publisher's generation timestamp, not independently verified collection dates or a guarantee of final CMU offerings. Sections do not include individual start/end dates; term metadata identifies Spring 2027. Existing descriptions, requirements and FCE history retain their older provenance.

Original JSON, semester metadata, retrieval time and SHA-256 are preserved in ignored `data/raw/courseweave/`. The importer automatically includes that snapshot when present; `--courseweave PATH` selects another S27 snapshot. It validates semester, unique course/section IDs, minute-of-day times and Monday-based weekday indices. Missing times remain TBA. Public catalogs still omit instructors, FCE and locations; member catalogs preserve section instructors and rooms. No Stellic credentials are sent to CourseWeave.

The S27 schedule CSV and Stellic sections behind that snapshot are now inputs of `courses-index build` directly
(`exported/schedules/S27.csv`, `exported/stellic-terms/S27`).

## Spring 2027 on the Schedule of Classes - October 26, 2026

The registrar published Spring 2027 on the Schedule of Classes (its complete schedule, `sched_layout_spring.dat`, has a
run date of October 25). `courses-scraper --mode soc --soc-extras all` captured it on October 26, and
`data/terms.json` now builds the term from that capture, like the other terms. The Stellic sections and the
registrar's CSV, both from October 21, stay on as supplements for instructors and rooms. The term's dates match the
[official 2026-27 academic calendar](https://www.cmu.edu/hub/calendar/docs/2627-academic-calendar.pdf) (updated
July 1, 2026).

At Pittsburgh, Spring 2027 has **3,086 courses and 6,752 sections** (3,224 courses at every campus). Compared with the
October 21 inputs:

- 12 courses are new: 39-653, 39-654, 45-890, 48-409, 48-709, 51-495, 51-695, 80-203, 90-783, 90-812, 94-710 and
  95-733. Seven are gone: 27-592, 27-792, 45-886, 45-893, 54-410, 54-810 and 95-811. Four administrative placeholders
  (00-060, 00-080, 01-700, 01-999) were only in the CSV; the SOC doesn't list them.
- Three sections were cancelled (94-819 Z3, 94-879 C4, 95-810 Z4), and 16 sections are new since Stellic's October 21
  list.
- 13 sections meet at new times, mostly minis: 45-820 A3 and B3, 45-821 M4, 45-842 M4, 45-872 M3, 95-760 B3 and D4,
  95-865 E4, 90-916 A4, 17-647 D4, 51-379 A, 54-823 A and 57-194 C.
- Five courses have new units: 51-206, 57-308 and 45-813 are now 3, 57-900 is 6, and 82-051 is variable.

Checks and coverage:

- The search pages and the complete schedule agree section for section on all 3,224 courses. They differ only on
  15-111 (Pre-College, dropped since October 25) and 67-375 (Qatar, added since).
- 5,521 sections have instructors: 5,454 from Stellic and 67 more from the CSV. Where both name instructors, they
  differ on 254 sections, mostly preferred against full names; Stellic's are kept, as in the other terms. 3,290 of the
  4,075 scheduled sections have a room.
- The SOC adds seat reservations for 2,451 sections and special permission for 493 courses.
- Instructors and rooms for the new courses and sections, and changes to either since October 21, need a Stellic
  refresh with a CMU session (Courseweave's `fetch-stellic.ts S27`, copied to `exported/stellic-terms/S27`).

The catalog's course pages gained 382 courses. The 1,494 courses Spring 2027 lists whose pages had been read from a
2025-26 term were re-read from Spring 2027; 215 had new descriptions, titles, cross-listings or prerequisite text.

Switching the term to the SOC turned up two problems in the builder, fixed with it: supplements added meetings at
times the SOC doesn't list (`addMissingMeetings` in [catalog data](data.md)), and SOC text was decoded with the wrong
charset ([decision 18](../decisions/0018-capture-the-schedule-of-classes-with-the-scraper.md)).

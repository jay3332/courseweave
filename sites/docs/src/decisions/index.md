# Architecture decisions

| # | Decision | Status |
|---|---|---|
| 1 | [Record architecture decisions](0001-record-architecture-decisions.md) | accepted |
| 2 | [Serve the website and a public course API](0002-serve-the-website-and-a-public-course-api.md) | accepted |
| 3 | [Query the catalog in the browser](0003-query-the-catalog-in-the-browser.md) | accepted |
| 4 | [Publish the catalog to object storage](0004-publish-the-catalog-to-object-storage.md) | accepted |
| 5 | [Use SQLite for the catalog](0005-use-sqlite-for-the-catalog.md) | superseded by 13 |
| 6 | [Use Diesel for catalog queries](0006-use-diesel-for-catalog-queries.md) | browser queries superseded by 13 |
| 7 | [Load the catalog into memory in the browser](0007-load-the-catalog-into-memory-in-the-browser.md) | superseded by 16 |
| 8 | [Cache the catalog in OPFS](0008-cache-the-catalog-in-opfs.md) | amended by 16 |
| 9 | [Share one in-memory catalog across the public course API's connections](0009-share-one-in-memory-catalog-across-api-connections.md) | accepted |
| 10 | [Build the catalog separately from scraping](0010-build-the-catalog-separately-from-scraping.md) | amended by 15 |
| 11 | [Version raw scrape output by format](0011-version-raw-scrape-output-by-format.md) | accepted |
| 12 | [Delete catalogs no deployed branch uses](0012-delete-catalogs-no-deployed-branch-uses.md) | accepted |
| 13 | [Use API-first DuckDB browser catalog reads](0013-use-api-first-duckdb-browser-reads.md) | superseded by 16 |
| 14 | [Bring Courseweave's features into CMU Courses](0014-bring-courseweave-features-into-cmu-courses.md) | accepted |
| 15 | [Build the catalog in Rust, as one SQLite file](0015-build-the-catalog-in-rust.md) | accepted |
| 16 | [Serve the catalog to the browser as JSON documents](0016-serve-the-catalog-as-json-documents.md) | accepted |
| 17 | [Store personal data on the server](0017-store-personal-data-on-the-server.md) | accepted |
| 18 | [Capture the Schedule of Classes with the scraper](0018-capture-the-schedule-of-classes-with-the-scraper.md) | accepted |
| 19 | [Parse the registrar's final exam schedule](0019-parse-the-registrars-final-exam-schedule.md) | accepted |
| 20 | [Redact public term documents](0020-redact-public-term-documents.md) | accepted |
| 21 | [Sort catalog strings with Unicode collation](0021-sort-catalog-strings-with-unicode-collation.md) | accepted |
| 22 | [Leave build times out of FCE and program documents](0022-leave-build-times-out-of-fce-and-program-documents.md) | accepted |
| 23 | [Persist sessions in the user database](0023-persist-sessions-in-the-user-database.md) | accepted |
| 24 | [Serve syllabi from private object storage](0024-serve-syllabi-from-private-object-storage.md) | accepted |
| 25 | [Render course head tags on the server](0025-render-course-head-tags-on-the-server.md) | accepted |
| 26 | [Sign in locally without Keycloak](0026-sign-in-locally-without-keycloak.md) | accepted |
| 27 | [Keep the website's store logic in plain TypeScript, with Svelte state injected](0027-keep-store-logic-in-plain-typescript.md) | accepted |
| 28 | [Replay edits onto the stored record after a conflict, and keep unsaved changes in the tab](0028-replay-edits-onto-the-stored-record.md) | accepted |
| 29 | [Develop and test the website against an in-memory mock of the web API](0029-develop-against-an-in-memory-mock-api.md) | accepted |
| 30 | [Build UI primitives on native elements and the top layer](0030-build-ui-primitives-on-native-elements.md) | accepted |
| 31 | [Scroll the page, with a sticky header and rail](0031-scroll-the-page-with-a-sticky-rail.md) | accepted |
| 32 | [Share course data between components through a module cache](0032-share-course-data-between-components.md) | accepted |
| 33 | [Open courses in a panel beside the course list](0033-open-courses-beside-the-course-list.md) | accepted |
| 34 | [Show final exams in a dialog on each schedule](0034-show-final-exams-in-a-dialog-on-each-schedule.md) | accepted |
| 35 | [Share schedules by token when signed in, by a link that carries the schedule when signed out](0035-share-schedules-by-token-or-by-a-link-that-carries-it.md) | accepted |
| 36 | [Lay out the degree plan beside its requirements, not in a rail](0036-lay-out-the-degree-plan-beside-its-requirements.md) | superseded in part by 44 |
| 37 | [Let signed-out visitors draft a degree plan; degree programs need a CMU sign-in](0037-let-signed-out-visitors-draft-a-degree-plan.md) | accepted |
| 38 | [Show an invite's sender before it's accepted](0038-show-an-invites-sender-before-it-is-accepted.md) | accepted |
| 39 | [Build an instructor's FCE rows in the browser from the course documents](0039-build-instructor-fce-rows-in-the-browser.md) | accepted |
| 40 | [Adapt the Figma design to the features, borrowing from Courseweave](0040-follow-courseweaves-interaction-design.md) | accepted |
| 41 | [Preview every course link, by hover or by press and hold](0041-preview-every-course-link.md) | accepted |
| 42 | [Ask before adding signed-out drafts to an account](0042-ask-before-adding-signed-out-drafts-to-an-account.md) | accepted |
| 43 | [List instructors from their own documents](0043-list-instructors-from-their-own-documents.md) | accepted |
| 44 | [Put the degree plan's programs and progress in a rail](0044-put-the-degree-plans-programs-and-progress-in-a-rail.md) | accepted |
| 45 | [Lay out the requisite graph ourselves](0045-lay-out-the-requisite-graph-ourselves.md) | accepted |
| 46 | [Check gen eds that Stellic splits by entry year at the plan's entry year](0046-check-year-split-gen-eds-at-the-plans-entry-year.md) | accepted |
| 47 | [Offer other looks as sets of the design tokens](0047-offer-other-looks-as-sets-of-the-design-tokens.md) | accepted |

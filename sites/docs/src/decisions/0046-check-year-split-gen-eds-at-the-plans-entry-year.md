# 46. Check gen eds that Stellic splits by entry year at the plan's entry year

Date: 2026-11-01

## Status

Accepted

## Context

A major's program document attaches the requirement bundles its Stellic sharing rules name, at the version for the
major version's entry year ([program documents](../api/catalog-fce-programs.md#bundles-and-concentrations)). The audit
checks those bundles with the major.

Stellic splits SCS's gen ed into one program per entry year, each with a single version: "EY2020 SCS - General
Education", "EY2021 SCS - General Education", "EY2022 SCS - General Education" and "EY2023+ SCS - General
Education". A major's sharing rule names one of these programs, and the rules aren't always updated with new
versions: every BS in Artificial Intelligence version from EY2020 to EY2025 names EY2020's, and BS in Computational
Biology's EY2025 version names EY2021's, while BS in Computer Science's EY2025 version names EY2023+'s. Plans for
those majors checked an old gen ed, whatever their first semester. College requirements follow the student's entry
year, not the major's version.

## Decision

- When an attached bundle's name starts with an entry year ("EY2020 ", "EY2023+ ", "EY2018 - "), the website
  checks the requirements program with the same rest of the name that started most recently by the plan's entry year
  (the version's own entry year when there's none), at its version for that year (`core/degree/year-bundles.ts`).
  `catalog.auditVersions()` applies it for every audit, and the program picker for its "Also checks".
- Sharing rules that named the swapped bundle name its replacement, so the limit a major sets for its gen ed (for BS
  in Artificial Intelligence, nothing shared) still applies.
- Bundles not named for an entry year, and ones with no newer program of the same name, stay as the major names them.
  The program documents don't change.

## Consequences

- Artificial Intelligence and Computational Biology plans check the gen ed for their entry year (EY2023+ from 2023),
  as Computer Science plans already did.
- The match depends on Stellic's naming: a year-split bundle renamed in another pattern wouldn't be found, and plans
  would check the bundle the major names, as before.
- It happens in the browser, so the catalog builder's documents still match Courseweave's. The builder could make the
  same choice by the major version's entry year later.
- Every audit loads the programs index, one document fetched once.
- Majors whose rules name no gen ed (BS in Human-Computer Interaction and BS in Robotics in EY2025) still check none.

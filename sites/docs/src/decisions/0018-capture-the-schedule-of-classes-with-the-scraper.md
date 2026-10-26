# 18. Capture the Schedule of Classes with the scraper

Date: 2026-10-24

## Status

Accepted; amended 2026-10-26 to decode pages by their declared charset (titles and descriptions with
accented letters or curly quotes had been garbled).

## Context

The semester documents ([decision 16](0016-serve-the-catalog-as-json-documents.md)) list every course, section and
meeting of a term. CMU's public Schedule of Classes (SOC) is the authoritative list: it drops cancelled sections and
has delivery modes, reservations and special permission. It lacks instructors and rooms, which Stellic has, and it
only lists the terms the registrar currently publishes, so a past term has to be captured while it is listed.

Courseweave fetched the SOC with its own TypeScript scripts into `data/raw/soc/` and parsed it during the build. The
builder must stay offline and deterministic ([decision 10](0010-build-the-catalog-separately-from-scraping.md)).

## Decision

- `courses-scraper --mode soc` captures the SOC into `exported/soc/<term>/`, in Courseweave's layout: the
  undergraduate and graduate search pages, detail pages for courses whose lecture and section grouping is ambiguous,
  reservations and special permission per course, and `meta.json` with the fetch time and department codes. With
  `--soc-catalog` it also keeps `exported/soc/details.json`, every course's parsed detail page for the catalog's
  descriptions and requisite text.
- It needs no credentials. Requests are serial with a delay. Reservations are re-read a rotating slice at a time,
  so a run stays short; past terms are read once.
- Pages are stored as UTF-8 text, decoded by the charset each declares (ISO-8859-1 for the search pages, UTF-8 for
  detail pages), so captures from Courseweave and from the scraper are interchangeable. The parsers live in
  `courses_index::soc`, shared by the scraper and the builder.
- The builder only reads captures. A term document's `generatedAt` is the newest fetch time its sources record
  (`meta.json`), not the build time.

## Consequences

- A term can be rebuilt from its capture after the registrar stops listing it, so captures have to be kept
- Refreshing the SOC is a separate, unauthenticated scraper run, which can be scheduled independently of Stellic
- Instructors and rooms still come from a Stellic supplement; without one, a term's document says they aren't listed
- Changes to the SOC's HTML break the parsers; the parity test against Courseweave's output and the unit tests on
  trimmed pages catch them

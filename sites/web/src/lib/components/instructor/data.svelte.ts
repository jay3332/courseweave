// Shared, cached reads for instructor previews (decision 41): the compact instructor documents (decision 43) and an
// instructor's FCE rows from the `fce/courses/<NN>` documents the documents name (decision 39), each loaded once
// however many previews ask, through the same cache as the course components (../course/data.svelte.ts).
import { catalog } from "$lib/data";
import { shared, type Shared } from "../course/data.svelte";
import {
  decodeInstructorList,
  instructorDirectory,
  type InstructorDirectory,
  type ListedDoc,
} from "./directory";
import { loadInstructorRows, type InstructorRow } from "./instructor-fce";

/**
 * A semester's instructors, or everyone in any semester or FCE history with `scope` "all" (member data); null when
 * the catalog was built without the compact documents.
 */
export function instructorsIn(scope: string): Shared<InstructorDirectory | null> {
  return shared(`instructors:${scope}`, async () => {
    const file = await catalog.instructorList(scope);
    return file === null ? null : instructorDirectory(file);
  });
}

/**
 * Everyone in any semester or FCE history as searchable rows, for the header's search (member data); null when the
 * catalog was built without the compact documents.
 */
export function instructorSearchDocs(): Shared<ListedDoc[] | null> {
  return shared("instructor-docs:all", async () => {
    const file = await catalog.instructorList("all");
    return file === null ? null : decodeInstructorList(file);
  });
}

/** Every FCE row of an instructor's for the courses their FCE record lists, newest first (member data). */
export function instructorRows(
  name: string,
  courseIds: readonly string[],
): Shared<InstructorRow[]> {
  return shared(`instructor-fce:${name}:${courseIds.join(",")}`, () =>
    loadInstructorRows(catalog, name, courseIds),
  );
}

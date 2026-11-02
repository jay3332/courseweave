// Links to the website's pages (docs/src/courseweave.md, "Website"). Courseweave puts the semester in the path; here
// it's the `term` query parameter, and `term=all` is the all-semesters view of the course and instructor lists.
import { reqParam, type ReqRef } from "./explorer/filters.ts";
import { codeOf } from "./requisite-format.ts";

/** The `term` value for the all-semesters view. */
export const ALL_TERMS = "all";

function withTerm(path: string, term?: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (term !== null && term !== undefined && term !== "") params.set("term", term);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The course list. */
export function coursesPath(term?: string | null): string {
  return withTerm("/", term);
}

/** The course list narrowed to what counts toward a requirement, in its usual order. */
export function requirementCoursesPath(req: ReqRef, term?: string | null): string {
  return withTerm("/", term, { req: reqParam(req) });
}

/** A course's full page. Takes a five-digit id ("15122") or a code ("15-122"). */
export function coursePath(course: string, term?: string | null): string {
  const code = /^\d{5}$/u.test(course) ? codeOf(course) : course;
  return withTerm(`/course/${encodeURIComponent(code)}`, term);
}

export function instructorsPath(term?: string | null): string {
  return withTerm("/instructors", term);
}

export function instructorPath(slug: string, term?: string | null): string {
  return withTerm(`/instructors/${encodeURIComponent(slug)}`, term);
}

/** The schedules page, optionally opening one schedule. */
export function schedulesPath(term?: string | null, scheduleId?: string | null): string {
  return withTerm(
    "/schedules",
    term,
    scheduleId === null || scheduleId === undefined ? {} : { schedule: scheduleId },
  );
}

/** A read-only shared schedule. */
export function sharedSchedulePath(token: string): string {
  return `/schedules/shared/${encodeURIComponent(token)}`;
}

/** The final exams of the schedule shown for a semester: a dialog on the schedules page. */
export function finalsPath(term?: string | null): string {
  return withTerm("/schedules", term, { finals: "1" });
}

export function planPath(planId?: string | null): string {
  return withTerm("/plan", null, planId === null || planId === undefined ? {} : { plan: planId });
}

export type ProfileSection = "saved" | "taking" | "taken" | "schedules" | "friends" | "settings";

export function profilePath(section?: ProfileSection): string {
  return section === undefined ? "/profile" : `/profile/${section}`;
}

export function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

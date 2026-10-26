// The web API's request and response bodies, from its OpenAPI document (openapi.json, generated from the Rust
// structs; `deno task generate-api` turns it into schema.d.ts). JSON field names are camelCase. The stores convert
// these wire records to Courseweave's types (core/state) with the normalizers in core/sync-merge.ts.
import type { components } from "./schema.d.ts";

type Schemas = components["schemas"];

/** Every error response's `code`. */
export type ErrorCode = Schemas["ErrorCode"];

/** Every error response. A 409 also carries the stored record as `current`. */
export type ErrorBody = Schemas["ErrorBody"] & { current?: unknown };

/** `GET /api/me`: the signed-in CMU user. */
export type Me = Schemas["Me"];

// ---- Schedules ----

export type Visibility = Schemas["Visibility"];
export type ScheduleEntryBody = Schemas["ScheduleEntry"];
/** A stored schedule: Courseweave's schedule plus visibility, revision and share link. */
export type ScheduleRecord = Schemas["Schedule"];
/** `POST /api/schedules`. `id` may be the client's own, so a retried create can't make two. */
export type NewSchedule = Schemas["NewSchedule"];
/** `PUT /api/schedules/{id}`: the whole schedule and the revision the change is based on. */
export type ScheduleUpdate = Schemas["ScheduleUpdate"];
/** `GET /api/shared-schedules/{token}`: a schedule shared by link, without its owner. */
export type SharedSchedule = Schemas["SharedSchedule"];
/** `POST /api/schedules/{id}/share`. */
export type ShareLink = Schemas["ShareLink"];

// ---- Degree plans ----

/** A stored degree plan: Courseweave's plan plus its revision. */
export type PlanRecord = Schemas["Plan"];
export type NewPlan = Schemas["NewPlan"];
export type PlanUpdate = Schemas["PlanUpdate"];

// ---- Academic record and preferences ----

/** `GET /api/record`. Revision 0 means nothing has been saved yet. */
export type AcademicRecord = Schemas["Record"];
/** `PUT /api/record`; revision 0 creates. */
export type RecordUpdate = Schemas["RecordUpdate"];

export type PlanLayout = Schemas["PlanLayout"];
/** How the schedule page picks sections: dropdowns, or compact buttons to hover through. */
export type SectionPicker = Schemas["SectionPicker"];
/** `GET /api/preferences`. Revision 0 means nothing has been saved yet. */
export type Preferences = Schemas["Preferences"];
/** `PUT /api/preferences`. */
export type PreferencesUpdate = Schemas["PreferencesUpdate"];
/** Preferences without their revision. */
export type PreferencesData = Omit<Preferences, "revision" | "updatedAt">;

// ---- Saved courses ----

/** `GET /api/saved`: one bookmarked course. */
export type SavedCourse = Schemas["SavedCourse"];

// ---- Friends ----

/** accepted, incoming (they asked you) or outgoing (you asked them). */
export type FriendStatus = Schemas["FriendStatus"];
/** `id` is the friendship's id. */
export type Friend = Schemas["Friend"];
/** `POST /api/friends/invites`: a single-use link to `APP_URL/invite/{token}`. */
export type Invite = Schemas["Invite"];
/** `GET /api/friends/invites/{token}`: who made an invite, before it's accepted. */
export type InviteInfo = Schemas["InviteInfo"];
/** `GET`/`PUT /api/friends/sharing`: what accepted friends may see. */
export type Sharing = Schemas["Sharing"];
/** `GET /api/friends/{id}/schedules`: a friend's schedule marked visible to friends. */
export type FriendSchedule = Schemas["FriendSchedule"];
/** `GET /api/friends/courses?term=`: course id to the names of friends taking it. */
export type FriendsTaking = Record<string, string[]>;

// ---- Finals ----

/** `GET /api/finals?term=`: an exam from the student's own SIO calendar import. */
export type FinalExam = Schemas["FinalExam"];

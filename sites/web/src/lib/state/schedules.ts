// Schedules (`/api/schedules`): Courseweave's schedule store, with each schedule its own server record. The schedule
// shown for each semester lives in preferences (preferences.ts).
import type { Api } from "../api/endpoints.ts";
import { ApiError } from "../api/errors.ts";
import type { ScheduleRecord, ShareLink, SharedSchedule } from "../api/types.ts";
import { mergeNewer, normalizeSchedule } from "../core/sync-merge.ts";
import {
  applyScheduleEdit,
  inTabOrder,
  latestSchedule,
  newSchedule,
  scheduleEdits,
  termSchedules,
  uid,
  type Schedule,
  type ScheduleEdit,
  type ScheduleEntry,
  type ScheduleVisibility,
  type SectionChoice,
} from "../core/state/store.ts";
import { CollectionStore } from "./collection.ts";
import type { StoreDeps } from "./drafts.ts";
import { isObject } from "./env.ts";
import { distinctName } from "./names.ts";
import type { PreferencesStore } from "./preferences.ts";
import type { Stored } from "./sync.ts";

/** A schedule as the website holds it: Courseweave's schedule and its share link, when it has one. */
export interface ScheduleItem extends Schedule {
  shareId?: string | null;
}

function normalize(raw: unknown): ScheduleItem | null {
  if (!isObject(raw) || typeof raw.id !== "string") return null;
  const schedule = normalizeSchedule(raw.id, raw);
  if (schedule === null) return null;
  return typeof raw.shareId === "string" ? { ...schedule, shareId: raw.shareId } : schedule;
}

function fromApi(r: ScheduleRecord): Stored<ScheduleItem> {
  const value = normalize(r);
  if (value === null)
    throw new ApiError(200, "unavailable", "The server sent a schedule this website can't read.");
  return { value: { ...value, shareId: r.shareId }, revision: r.revision };
}

/**
 * A schedule drafted signed out, joining the account's on sign-in. An empty one (the "Schedule 1" a semester shows
 * on a visit) is dropped when the account already has a schedule for that semester, and otherwise stays unsaved
 * until something is added; any other takes a name no schedule of that semester has.
 */
function adoptDraft(
  draft: ScheduleItem,
  existing: readonly ScheduleItem[],
): { value: ScheduleItem; save: boolean } | null {
  const sameTerm = existing.filter((s) => s.termId === draft.termId);
  if (draft.entries.length === 0) return sameTerm.length > 0 ? null : { value: draft, save: false };
  const name = distinctName(
    draft.name,
    sameTerm.map((s) => s.name),
    "Schedule",
  );
  return { value: name === draft.name ? draft : { ...draft, name }, save: true };
}

export class ScheduleStore {
  readonly store: CollectionStore<ScheduleItem>;
  readonly #api: Api;
  readonly #prefs: PreferencesStore;
  readonly #now: () => number;

  constructor(api: Api, prefs: PreferencesStore, deps: StoreDeps) {
    this.#api = api;
    this.#prefs = prefs;
    this.#now = () => deps.env.now();
    this.store = new CollectionStore<ScheduleItem>(
      {
        name: "schedules",
        list: async () => (await api.schedules.list()).map((r) => fromApi(r)),
        create: async (s) =>
          fromApi(
            await api.schedules.create({
              id: s.id,
              termId: s.termId,
              name: s.name,
              entries: s.entries,
              visibility: s.visibility ?? "private",
            }),
          ),
        update: async (s, revision) =>
          fromApi(
            await api.schedules.update(s.id, {
              termId: s.termId,
              name: s.name,
              entries: s.entries,
              visibility: s.visibility ?? "private",
              revision,
            }),
          ),
        remove: (id) => api.schedules.remove(id),
        normalize,
        merge: (local, remote) => mergeNewer(local, remote),
        adoptDraft,
      },
      deps,
    );
  }

  // ---- Reading ----

  /** Every schedule, by id. */
  get items(): Record<string, ScheduleItem> {
    return this.store.items;
  }

  get(id: string): ScheduleItem | undefined {
    return this.store.items[id];
  }

  /** A term's schedules in tab order: as the student arranged them (preferences), then any newer, oldest first. */
  forTerm(termId: string): ScheduleItem[] {
    return inTabOrder(
      termSchedules(Object.values(this.store.items), termId),
      this.#prefs.scheduleOrder[termId],
    );
  }

  /** The schedule shown for a term: the one chosen, else the term's most recently edited one. */
  activeId(termId: string): string | null {
    const chosen = this.#prefs.activeSchedule[termId];
    if (chosen !== undefined && this.store.items[chosen]?.termId === termId) return chosen;
    return latestSchedule(Object.values(this.store.items), termId)?.id ?? null;
  }

  active(termId: string): ScheduleItem | null {
    const id = this.activeId(termId);
    return id === null ? null : (this.store.items[id] ?? null);
  }

  // ---- Schedules ----

  /**
   * Makes sure the term has a schedule to show and returns its id. A new one stays on this device until something
   * is added to it, so visiting a semester doesn't create records.
   */
  ensureSchedule(termId: string): string {
    const id = this.activeId(termId);
    if (id !== null) return id;
    const schedule = newSchedule({
      id: uid(),
      termId,
      now: this.#now(),
      existing: Object.values(this.store.items),
    });
    this.store.create(schedule, { save: false });
    return schedule.id;
  }

  /** Creates a schedule (named "Schedule N" unless `name` is given) and shows it. */
  createSchedule(termId: string, name?: string, entries: ScheduleEntry[] = []): string {
    const schedule = newSchedule({
      id: uid(),
      termId,
      name,
      entries,
      now: this.#now(),
      existing: Object.values(this.store.items),
    });
    this.store.create(schedule);
    this.#prefs.setActiveSchedule(termId, schedule.id);
    return schedule.id;
  }

  /** A copy named "<name> copy", shown. Returns its id (or `id` when there's no such schedule). */
  duplicateSchedule(id: string): string {
    const s = this.store.items[id];
    if (s === undefined) return id;
    return this.createSchedule(s.termId, `${s.name} copy`, structuredClone(s.entries));
  }

  /** Deletes a schedule; when it was shown, the term shows its most recently edited other schedule. */
  deleteSchedule(id: string): void {
    const s = this.store.items[id];
    if (s === undefined) return;
    this.store.delete(id);
    if (this.#prefs.activeSchedule[s.termId] === id) {
      this.#prefs.setActiveSchedule(
        s.termId,
        latestSchedule(Object.values(this.store.items), s.termId)?.id ?? null,
      );
    }
  }

  setActiveSchedule(termId: string, id: string): void {
    this.#prefs.setActiveSchedule(termId, id);
  }

  /** Moves a schedule's tab to just before another's (null: the end). */
  moveSchedule(id: string, beforeId: string | null): void {
    const s = this.store.items[id];
    if (s === undefined) return;
    const ids = this.forTerm(s.termId).flatMap((t) => (t.id === id ? [] : [t.id]));
    const at = beforeId === null ? -1 : ids.indexOf(beforeId);
    this.#prefs.setScheduleOrder(s.termId, at < 0 ? [...ids, id] : ids.toSpliced(at, 0, id));
  }

  /** Adds a schedule shared by link (or an import link) to the student's own schedules, and shows it. */
  importShared(shared: Pick<SharedSchedule, "termId" | "name" | "entries">): string {
    return this.createSchedule(shared.termId, shared.name, structuredClone(shared.entries));
  }

  // ---- Edits ----

  #edit(id: string, edit: ScheduleEdit): void {
    const now = this.#now();
    this.store.edit(id, (s) => ({ ...s, ...applyScheduleEdit(s, edit, now) }));
  }

  renameSchedule(id: string, name: string): void {
    this.#edit(id, scheduleEdits.rename(name));
  }

  /** Who else may see it: only the student, or also friends they share schedules with. */
  setVisibility(id: string, visibility: ScheduleVisibility): void {
    this.#edit(id, scheduleEdits.setVisibility(visibility));
  }

  /** Adds a course, or updates its sections and unhides it when it's already there. */
  addCourse(
    scheduleId: string,
    courseId: string,
    section: string | null = null,
    child: string | null = null,
  ): void {
    this.#edit(scheduleId, scheduleEdits.addCourse(courseId, section, child));
  }

  removeCourse(scheduleId: string, courseId: string): void {
    this.#edit(scheduleId, scheduleEdits.removeCourse(courseId));
  }

  /** Picks a top-level section. The child resets unless given. */
  setSection(
    scheduleId: string,
    courseId: string,
    section: string | null,
    child: string | null = null,
  ): void {
    this.#edit(scheduleId, scheduleEdits.setSection(courseId, section, child));
  }

  setChild(scheduleId: string, courseId: string, child: string | null): void {
    this.#edit(scheduleId, scheduleEdits.setChild(courseId, child));
  }

  /** Bulk assignment, e.g. applying a generated schedule. */
  setSections(scheduleId: string, sections: Record<string, SectionChoice>): void {
    this.#edit(scheduleId, scheduleEdits.setSections(sections));
  }

  setPassFail(scheduleId: string, courseId: string, passFail: boolean): void {
    this.#edit(scheduleId, scheduleEdits.setPassFail(courseId, passFail));
  }

  setColor(scheduleId: string, courseId: string, color: number): void {
    this.#edit(scheduleId, scheduleEdits.setColor(courseId, color));
  }

  toggleHidden(scheduleId: string, courseId: string): void {
    this.#edit(scheduleId, scheduleEdits.toggleHidden(courseId));
  }

  /** Moves a course to just before another (null: the end). Order is only for organizing. */
  moveEntry(scheduleId: string, courseId: string, beforeCourseId: string | null): void {
    this.#edit(scheduleId, scheduleEdits.moveEntry(courseId, beforeCourseId));
  }

  // ---- Share links (signed in) ----

  /** Creates (or reuses) a read-only link to a schedule. Saves the schedule first so the link shows it. */
  async share(id: string): Promise<ShareLink> {
    await this.store.flush();
    const link = await this.#api.schedules.share(id);
    this.store.amend(id, (s) => (s.shareId === link.shareId ? s : { ...s, shareId: link.shareId }));
    return link;
  }

  /** Turns a schedule's share link off. */
  async unshare(id: string): Promise<void> {
    await this.#api.schedules.unshare(id);
    this.store.amend(id, (s) =>
      s.shareId === null || s.shareId === undefined ? s : { ...s, shareId: null },
    );
  }
}

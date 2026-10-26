// Preferences that follow the student between devices (`/api/preferences`): calendar display options, the schedule
// shown for each semester, the active degree plan, the plan layout, how sections are picked and the onboarding
// prompt's answer. Courseweave kept these on the device; here they're one record per student.
import type { Api } from "../api/endpoints.ts";
import type { PlanLayout, Preferences, PreferencesData, SectionPicker } from "../api/types.ts";
import { EMPTY_ONBOARDING, type OnboardingState } from "../core/state/onboarding.ts";
import { DEFAULT_CALENDAR_DISPLAY, type CalendarDisplay } from "../core/state/store.ts";
import type { StoreDeps } from "./drafts.ts";
import { DocumentStore } from "./document.ts";
import { isObject } from "./env.ts";
import type { Stored } from "./sync.ts";

export const DEFAULT_PREFERENCES: PreferencesData = {
  calendarDisplay: DEFAULT_CALENDAR_DISPLAY,
  activeSchedule: {},
  activePlanId: null,
  planLayout: "cards",
  sectionPicker: "dropdown",
  onboarding: EMPTY_ONBOARDING,
};

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Preferences from untrusted JSON, with defaults for anything missing or malformed. */
export function normalizePreferences(raw: unknown): PreferencesData | null {
  if (!isObject(raw)) return null;
  const cd = isObject(raw.calendarDisplay) ? raw.calendarDisplay : {};
  const activeSchedule: Record<string, string> = {};
  if (isObject(raw.activeSchedule)) {
    for (const [term, id] of Object.entries(raw.activeSchedule)) {
      if (!UNSAFE_KEYS.has(term) && typeof id === "string") activeSchedule[term] = id;
    }
  }
  const ob = isObject(raw.onboarding) ? raw.onboarding : {};
  return {
    calendarDisplay: {
      section: flag(cd.section, DEFAULT_CALENDAR_DISPLAY.section),
      time: flag(cd.time, DEFAULT_CALENDAR_DISPLAY.time),
      location: flag(cd.location, DEFAULT_CALENDAR_DISPLAY.location),
      title: flag(cd.title, DEFAULT_CALENDAR_DISPLAY.title),
    },
    activeSchedule,
    activePlanId: typeof raw.activePlanId === "string" ? raw.activePlanId : null,
    planLayout: raw.planLayout === "table" ? "table" : "cards",
    sectionPicker: raw.sectionPicker === "compact" ? "compact" : "dropdown",
    onboarding: { asked: ob.asked === true, promptHidden: ob.promptHidden === true },
  };
}

/**
 * This device's preferences over the server's, field by field: they're the more recent choice. Active schedules
 * combine per semester, and the onboarding prompt counts as answered if either copy says so.
 */
export function mergePreferences(local: PreferencesData, remote: PreferencesData): PreferencesData {
  return {
    calendarDisplay: local.calendarDisplay,
    activeSchedule: { ...remote.activeSchedule, ...local.activeSchedule },
    activePlanId: local.activePlanId ?? remote.activePlanId,
    planLayout: local.planLayout,
    sectionPicker: local.sectionPicker,
    onboarding: {
      asked: local.onboarding.asked || remote.onboarding.asked,
      promptHidden: local.onboarding.promptHidden || remote.onboarding.promptHidden,
    },
  };
}

function fromApi(p: Preferences): Stored<PreferencesData> {
  return { value: normalizePreferences(p) ?? DEFAULT_PREFERENCES, revision: p.revision };
}

export class PreferencesStore {
  readonly store: DocumentStore<PreferencesData>;

  constructor(api: Api, deps: StoreDeps) {
    this.store = new DocumentStore<PreferencesData>(
      {
        name: "preferences",
        empty: () => DEFAULT_PREFERENCES,
        get: async () => fromApi(await api.preferences.get()),
        put: async (value, revision) => fromApi(await api.preferences.put({ ...value, revision })),
        normalize: normalizePreferences,
        merge: mergePreferences,
        isEmpty: (v) => JSON.stringify(v) === JSON.stringify(DEFAULT_PREFERENCES),
      },
      deps,
    );
  }

  get value(): PreferencesData {
    return this.store.value;
  }

  get calendarDisplay(): CalendarDisplay {
    return this.store.value.calendarDisplay;
  }

  /** Term id to the id of the schedule shown for it. Use schedules.activeId(), which falls back sensibly. */
  get activeSchedule(): Record<string, string> {
    return this.store.value.activeSchedule;
  }

  get activePlanId(): string | null {
    return this.store.value.activePlanId;
  }

  get planLayout(): PlanLayout {
    return this.store.value.planLayout;
  }

  get sectionPicker(): SectionPicker {
    return this.store.value.sectionPicker;
  }

  get onboarding(): OnboardingState {
    return this.store.value.onboarding;
  }

  setCalendarDisplay(patch: Partial<CalendarDisplay>): void {
    this.store.edit((p) => ({ ...p, calendarDisplay: { ...p.calendarDisplay, ...patch } }));
  }

  setPlanLayout(planLayout: PlanLayout): void {
    this.store.edit((p) => (p.planLayout === planLayout ? p : { ...p, planLayout }));
  }

  setSectionPicker(sectionPicker: SectionPicker): void {
    this.store.edit((p) => (p.sectionPicker === sectionPicker ? p : { ...p, sectionPicker }));
  }

  /** Shows schedule `id` for `termId`; null forgets the choice. */
  setActiveSchedule(termId: string, id: string | null): void {
    this.store.edit((p) => {
      if ((p.activeSchedule[termId] ?? null) === id) return p;
      const activeSchedule = { ...p.activeSchedule };
      if (id === null) delete activeSchedule[termId];
      else activeSchedule[termId] = id;
      return { ...p, activeSchedule };
    });
  }

  setActivePlan(id: string | null): void {
    this.store.edit((p) => (p.activePlanId === id ? p : { ...p, activePlanId: id }));
  }

  /** The student added their record or skipped the prompt. */
  markOnboardingAsked(): void {
    this.store.edit((p) =>
      p.onboarding.asked ? p : { ...p, onboarding: { ...p.onboarding, asked: true } },
    );
  }

  /** The "add your record" nudges were closed. */
  hideOnboardingPrompt(): void {
    this.store.edit((p) =>
      p.onboarding.promptHidden ? p : { ...p, onboarding: { ...p.onboarding, promptHidden: true } },
    );
  }
}

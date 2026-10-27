/* oxlint-disable typescript/no-floating-promises, typescript/no-unsafe-type-assertion -- node:test awaits describe and it itself; fixtures are cast to their shapes */
import { describe, it } from "node:test";
import { expect } from "../testing.ts";
import { DevicePrefs } from "./device.ts";
import { DEFAULT_PREFERENCES, mergePreferences, normalizePreferences } from "./preferences.ts";
import { draftStores, MemoryStorage } from "./test-env.ts";
import { isAllSemesters, resolveTerm } from "./term-scope.ts";
import { planOrigin, trackOrigin } from "./nav-origin.ts";
import { plainCell } from "../data/cell.ts";
import type { TermIndexEntry } from "../core/types.ts";

describe("preferences", () => {
  it("reads untrusted JSON with defaults, and drops prototype keys", () => {
    expect(normalizePreferences({})).toEqual(DEFAULT_PREFERENCES);
    const raw = JSON.parse(
      '{"activeSchedule":{"S27":"a","__proto__":"x"},"scheduleOrder":{"S27":["b",5,"a"],"F26":"b","__proto__":["x"]},"planLayout":"table","sectionPicker":"compact","calendarDisplay":{"time":false,"title":true},"onboarding":{"asked":true}}',
    ) as unknown;
    expect(normalizePreferences(raw)).toEqual({
      ...DEFAULT_PREFERENCES,
      activeSchedule: { S27: "a" },
      scheduleOrder: { S27: ["b", "a"] },
      planLayout: "table",
      sectionPicker: "compact",
      calendarDisplay: { section: true, time: false, location: true, title: true },
      onboarding: { asked: true, promptHidden: false },
    });
    expect(normalizePreferences({ sectionPicker: "carousel" })?.sectionPicker).toBe("dropdown");
    expect(normalizePreferences(null)).toBeNull();
  });

  it("prefers this device's choices and keeps either side's answers", () => {
    const local = {
      ...DEFAULT_PREFERENCES,
      activeSchedule: { S27: "mine" },
      scheduleOrder: { S27: ["b", "a"] },
      planLayout: "table" as const,
      sectionPicker: "compact" as const,
    };
    const remote = {
      ...DEFAULT_PREFERENCES,
      activeSchedule: { S27: "theirs", F26: "old" },
      scheduleOrder: { S27: ["a", "b"], F26: ["c", "d"] },
      activePlanId: "p",
      onboarding: { asked: true, promptHidden: false },
    };
    expect(mergePreferences(local, remote)).toEqual({
      ...DEFAULT_PREFERENCES,
      activeSchedule: { S27: "mine", F26: "old" },
      scheduleOrder: { S27: ["b", "a"], F26: ["c", "d"] },
      activePlanId: "p",
      planLayout: "table",
      sectionPicker: "compact",
      onboarding: { asked: true, promptHidden: false },
    });
  });
});

describe("active schedules", () => {
  it("shows the chosen schedule, else the term's latest", () => {
    const stores = draftStores();
    const a = stores.schedules.createSchedule("S27", "A");
    const b = stores.schedules.createSchedule("S27", "B");
    expect(stores.schedules.activeId("S27")).toBe(b);
    stores.schedules.setActiveSchedule("S27", a);
    expect(stores.schedules.active("S27")?.name).toBe("A");
    stores.schedules.deleteSchedule(a);
    expect(stores.schedules.activeId("S27")).toBe(b);
    expect(stores.schedules.activeId("F26")).toBeNull();
    expect(stores.schedules.forTerm("S27").map((s) => s.name)).toEqual(["B"]);
  });

  it("keeps the tabs in the order the student puts them, with new ones after", () => {
    const stores = draftStores();
    const names = (): string[] => stores.schedules.forTerm("S27").map((s) => s.name);
    const a = stores.schedules.createSchedule("S27", "A");
    stores.schedules.createSchedule("S27", "B");
    const c = stores.schedules.createSchedule("S27", "C");
    expect(names()).toEqual(["A", "B", "C"]);
    stores.schedules.moveSchedule(c, a);
    expect(names()).toEqual(["C", "A", "B"]);
    stores.schedules.moveSchedule(a, null);
    expect(names()).toEqual(["C", "B", "A"]);
    stores.schedules.createSchedule("S27", "D");
    stores.schedules.deleteSchedule(c);
    expect(names()).toEqual(["B", "A", "D"]);
    stores.schedules.moveSchedule(a, "missing");
    expect(names()).toEqual(["B", "D", "A"]);
    expect(stores.preferences.scheduleOrder.S27).toEqual(
      stores.schedules.forTerm("S27").map((s) => s.id),
    );
  });
});

describe("saved courses", () => {
  it("toggles in a draft signed out", () => {
    const stores = draftStores();
    expect(stores.saved.toggle("15122")).toBe(true);
    expect(stores.saved.has("15122")).toBe(true);
    expect(stores.saved.toggle("15122")).toBe(false);
    stores.saved.add("21127");
    expect(stores.saved.ids).toEqual(["21127"]);
  });
});

describe("device conveniences", () => {
  it("remembers the last real semester and survives broken storage", () => {
    const storage = new MemoryStorage();
    const device = new DevicePrefs(plainCell, () => storage);
    device.rememberTerm("all");
    expect(device.lastTerm).toBeNull();
    device.rememberTerm("F26");
    expect(new DevicePrefs(plainCell, () => storage).lastTerm).toBe("F26");
    storage.setItem("cmucourses:device", "{not json");
    expect(new DevicePrefs(plainCell, () => storage).lastTerm).toBeNull();
    const broken = new DevicePrefs(plainCell, () => {
      throw new Error("storage off");
    });
    broken.markOnboardingAsked();
    expect(broken.onboardingAsked).toBe(true);
  });

  it("picks a real semester for pages that need one", () => {
    const terms = [{ id: "F26" }, { id: "S26" }] as TermIndexEntry[];
    expect(resolveTerm("S26", terms, null)).toBe("S26");
    expect(resolveTerm("all", terms, "S26")).toBe("S26");
    expect(resolveTerm(null, terms, "M20")).toBe("F26");
    expect(resolveTerm(null, [], null)).toBeNull();
    expect(isAllSemesters("all")).toBe(true);
  });

  it("goes back to the plan from a course page opened there", () => {
    trackOrigin("/plan", "?plan=p1");
    trackOrigin("/course/15-122", "?term=S27");
    expect(planOrigin()).toBe("/plan?plan=p1");
    trackOrigin("/schedules");
    expect(planOrigin()).toBeNull();
  });
});

/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { scheduleHeading, scheduleInSentence, scheduleShort } from "./schedule-label.ts";

describe("schedule names in actions", () => {
  it("keeps names that say they're a schedule", () => {
    expect(scheduleInSentence("Schedule 1")).toBe("Schedule 1");
    expect(scheduleInSentence("Fall schedule")).toBe("Fall schedule");
    expect(scheduleHeading("Schedule 2")).toBe("Schedule 2");
  });

  it("quotes other names after \"schedule\", so a copied plan's name doesn't read as the plan", () => {
    expect(scheduleInSentence("From Plan 2")).toBe("schedule \u201CFrom Plan 2\u201D");
    expect(scheduleHeading("From Plan 2")).toBe("Schedule \u201CFrom Plan 2\u201D");
    expect(scheduleInSentence("Schedules-ish")).toBe("schedule \u201CSchedules-ish\u201D");
  });

  it("only quotes the name where room is short", () => {
    expect(scheduleShort("From Plan 2")).toBe("\u201CFrom Plan 2\u201D");
    expect(scheduleShort("Schedule 1")).toBe("Schedule 1");
  });

  it("falls back without a schedule", () => {
    expect(scheduleInSentence(null)).toBe("your schedule");
    expect(scheduleShort(null)).toBe("your schedule");
    expect(scheduleHeading(null)).toBe("Your schedule");
  });
});

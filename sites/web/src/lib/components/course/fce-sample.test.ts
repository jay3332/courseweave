/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { fceSample } from "./fce-sample.ts";

describe("FCE sample sizes", () => {
  it("names the responses and semesters an average is over", () => {
    expect(fceSample(21, 4)).toBe("Averaged from 21 responses over 4 semesters");
    expect(fceSample(1, 1)).toBe("Averaged from 1 response over 1 semester");
    expect(fceSample(1204, 3)).toBe("Averaged from 1,204 responses over 3 semesters");
  });

  it("leaves out a response count it doesn't have", () => {
    expect(fceSample(0, 2)).toBe("Averaged over 2 semesters");
  });
});

/* oxlint-disable typescript/no-floating-promises -- node:test awaits describe and it itself */
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { expect } from "../../testing.ts";
import { SKINS, isDark, skinFontsHref } from "./skins.ts";

describe("isDark", () => {
  it("follows the light, dark or device choice for a skin with both modes", () => {
    expect(isDark("telegram", "dark", false)).toBe(true);
    expect(isDark("telegram", "light", true)).toBe(false);
    expect(isDark("default", "system", true)).toBe(true);
    expect(isDark("default", "system", false)).toBe(false);
  });

  it("lets a one-mode skin decide", () => {
    expect(isDark("mono", "light", false)).toBe(true);
    expect(isDark("soft", "dark", true)).toBe(false);
  });
});

describe("skinFontsHref", () => {
  it("asks Google Fonts for each family the skin names", () => {
    expect(skinFontsHref("playful")).toBe(
      "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Fredoka:wght@500;600&display=swap",
    );
  });

  it("is null for a skin set in the site's own type", () => {
    expect(skinFontsHref("default")).toBeNull();
    expect(skinFontsHref("soft")).toBeNull();
  });

  // Google Fonts answers 400, and the skin falls back to Georgia or the system font, when a tuple leaves an axis out:
  // "opsz,wght@8..60,400;500" names two axes but gives the second tuple one value.
  it("gives every axis a value in each of a family's tuples", () => {
    for (const s of SKINS) {
      for (const family of s.fonts) {
        const match = /^[A-Za-z0-9+]+(?::([a-z,]+)@(.+))?$/u.exec(family);
        expect(match).not.toBeNull();
        const [, axes, tuples] = match as RegExpExecArray;
        if (axes === undefined || tuples === undefined) continue;
        for (const tuple of tuples.split(";")) expect([family, tuple.split(",").length]).toEqual([family, axes.split(",").length]);
      }
    }
  });
});

// app.html applies the skin before first paint with its own copy of the one-mode skins and the font families.
describe("app.html's first-paint script", () => {
  const html = readFileSync(new URL("../../../app.html", import.meta.url), "utf8");
  const object = (name: string): Record<string, string | null> => {
    const body = new RegExp(`var ${name} = \\{([^}]*)\\}`, "u").exec(html)?.[1] ?? "";
    return Object.fromEntries(
      [...body.matchAll(/(\w+): (null|"([^"]*)")/gu)].map(([, key, raw, value]) => [key, raw === "null" ? null : value]),
    );
  };

  it("knows which skins have one mode", () => {
    const oneMode = Object.fromEntries(SKINS.filter((s) => s.modes !== "both").map((s) => [s.id, s.modes]));
    expect(object("oneMode")).toEqual(oneMode);
  });

  it("loads the same fonts for every skin but the default", () => {
    const fonts = Object.fromEntries(
      SKINS.filter((s) => s.id !== "default").map((s) => [
        s.id,
        s.fonts.length === 0 ? null : s.fonts.map((f) => `family=${f}`).join("&"),
      ]),
    );
    expect(object("fonts")).toEqual(fonts);
  });
});

// Color theme: light, dark or the system's. The choice is a device
// convenience kept in localStorage; app.html applies it before first paint
// using the same key.
import { MediaQuery } from "svelte/reactivity";
import { readLocal, writeLocal } from "../ui/storage";
import { skin } from "./skin.svelte";
import { isDark, type SkinId } from "./skins";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "cmucourses:theme";

function stored(): ThemePreference {
  const value = readLocal(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

class Theme {
  readonly #systemDark = new MediaQuery("(prefers-color-scheme: dark)", false);

  preference = $state<ThemePreference>(stored());

  /** Whether the page is dark right now. A skin with one mode (Mono is dark, Soft is light) decides for itself. */
  get dark(): boolean {
    return this.darkFor(skin.id);
  }

  /** Whether `skinId` would be dark with this choice: the theme picker previews each skin as it would look. */
  darkFor(skinId: SkinId): boolean {
    return isDark(skinId, this.preference, this.#systemDark.current);
  }

  set(preference: ThemePreference): void {
    this.preference = preference;
    writeLocal(THEME_KEY, preference === "system" ? null : preference);
  }

  /** Switches to the opposite of what is showing, as an explicit choice. */
  toggle(): void {
    this.set(this.dark ? "light" : "dark");
  }
}

export const theme = new Theme();

/** Mirrors the theme onto <html>. Call once from the root layout inside an effect. */
export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

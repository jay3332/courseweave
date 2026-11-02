// Themes ("skins"): the site's look as a set of design tokens, chosen per device beside light and dark. Default is
// the CMU Courses look; the others come from other projects: Telegram (Telegram Web's Night and Day, from the Gemini
// Telegram userscript), Discord and Claude (from the same scripts' Discord and Claude looks), and Mono, Playful and
// Soft (MajorPay's themes). A skin only changes tokens and a few signature touches (routes/skins.css);
// every component keeps its own markup. `data-skin` on <html> carries it, set before first paint by app.html's script,
// which keeps its own copy of the one-mode skins and the fonts (skins.test.ts checks they match).

export type SkinId = "default" | "telegram" | "discord" | "claude" | "mono" | "playful" | "soft";

export interface Skin {
  id: SkinId;
  name: string;
  /** One line for the picker. */
  blurb: string;
  /** The modes the skin has: both follow the light, dark or device choice; one is always used. */
  modes: "both" | "light" | "dark";
  /** Google Fonts families (the css2 `family=` values) the skin's type needs; none for the site's own Inter. */
  fonts: string[];
  /** The picker's swatch: page, card, accent and text, light then dark where the skin has both. */
  swatch: { light?: [string, string, string, string]; dark?: [string, string, string, string] };
}

export const SKINS: readonly Skin[] = [
  {
    id: "default",
    name: "Default",
    blurb: "CMU Courses as designed",
    modes: "both",
    fonts: [],
    swatch: { light: ["#f0f4f8", "#ffffff", "#0e96d1", "#1e1e1e"], dark: ["#0e151c", "#16202a", "#1b9ad3", "#f2f5f8"] },
  },
  {
    id: "telegram",
    name: "Telegram",
    blurb: "Night and Day, violet, with the wallpaper",
    modes: "both",
    fonts: ["Roboto:wght@400;500;700"],
    swatch: { light: ["#ece6f8", "#ffffff", "#7262d0", "#000000"], dark: ["#181818", "#212121", "#7262d0", "#ffffff"] },
  },
  {
    id: "discord",
    name: "Discord",
    blurb: "Blurple on Discord's greys",
    modes: "both",
    fonts: ["Noto+Sans:wght@400;500;600;700"],
    swatch: { light: ["#f2f3f5", "#ffffff", "#5865f2", "#060607"], dark: ["#1a1a1e", "#242429", "#5865f2", "#fbfbfb"] },
  },
  {
    id: "claude",
    name: "Claude",
    blurb: "Warm cream and clay, serif headings",
    modes: "both",
    fonts: ["Source+Serif+4:opsz,wght@8..60,400..600"],
    swatch: { light: ["#faf9f5", "#ffffff", "#b4542f", "#141413"], dark: ["#262624", "#30302e", "#b4542f", "#faf9f5"] },
  },
  {
    id: "mono",
    name: "Mono",
    blurb: "Black and white, numbers first",
    modes: "dark",
    fonts: ["Geist:wght@400;500;600", "Geist+Mono:wght@400;500"],
    swatch: { dark: ["#000000", "#0a0a0a", "#ededed", "#ededed"] },
  },
  {
    id: "playful",
    name: "Playful",
    blurb: "Chunky, bright, game-like",
    modes: "both",
    fonts: ["Nunito:wght@400;600;700;800", "Fredoka:wght@500;600"],
    swatch: { light: ["#eef9ff", "#ffffff", "#58cc02", "#3c3c3c"], dark: ["#141f25", "#1b2930", "#93d334", "#f1f7fb"] },
  },
  {
    id: "soft",
    name: "Soft",
    blurb: "Light, calm, pastel",
    modes: "light",
    fonts: [],
    swatch: { light: ["#fafbfc", "#ffffff", "#6163f0", "#1a1d23"] },
  },
];

export const SKIN_KEY = "cmucourses:skin";
const SKIN_IDS = new Set<string>(SKINS.map((s) => s.id));

export function isSkinId(value: string | null): value is SkinId {
  return value !== null && SKIN_IDS.has(value);
}

export function skinById(id: SkinId): Skin {
  return SKINS.find((s) => s.id === id) ?? (SKINS[0] as Skin);
}

/** Whether the page is dark: a one-mode skin decides; otherwise the light, dark or device choice does. */
export function isDark(skinId: SkinId, preference: "light" | "dark" | "system", systemDark: boolean): boolean {
  const { modes } = skinById(skinId);
  if (modes !== "both") return modes === "dark";
  return preference === "dark" || (preference === "system" && systemDark);
}

/** The Google Fonts stylesheet a skin's type needs, or null. */
export function skinFontsHref(skinId: SkinId): string | null {
  const { fonts } = skinById(skinId);
  if (fonts.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f}`).join("&")}&display=swap`;
}

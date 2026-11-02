// The app shell. Import from "$lib/components/shell".
export { default as AppFooter } from "./AppFooter.svelte";
export { default as AppearanceMenu } from "./AppearanceMenu.svelte";
export { default as AppearanceOptions } from "./AppearanceOptions.svelte";
export { default as AppHeader } from "./AppHeader.svelte";
export { default as SignInPrompt } from "./SignInPrompt.svelte";
export { default as SyncStatus } from "./SyncStatus.svelte";
export { default as Title } from "./Title.svelte";
export { NAV_ITEMS, isActive } from "./nav";
export type { NavItem } from "./nav";
export { getSession, setSession } from "./session";
export type { SessionStatus, ShellSession, ShellSync } from "./session";
export { applySkin, skin } from "./skin.svelte";
export { SKINS, SKIN_KEY } from "./skins";
export type { Skin, SkinId } from "./skins";
export { THEME_KEY, applyTheme, theme } from "./theme.svelte";
export type { ThemePreference } from "./theme.svelte";

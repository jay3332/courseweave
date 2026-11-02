# 47. Offer other looks as sets of the design tokens

Date: 2026-11-01

## Status

Accepted

## Context

The website has one look, the Figma file's light tokens and our dark values. A contributor asked for others:
Telegram's, and the themes of their other projects (the Telegram, Discord and Claude looks of the Gemini userscripts,
and MajorPay's Mono, Playful and Soft). Every component already draws with the design tokens in `routes/layout.css`
(`paper`, `surface`, `ink`, `muted`, `accent`, the radii, shadows and the sans font), so a look is mostly a different
set of values. Several brand colors don't reach 4.5:1 for text in this site's places: white on Telegram's violet
measured 3.74:1, white on Claude's clay 3.12:1, MajorPay's near-white on Playful's green 2.03:1.

## Decision

- A skin is a set of values for the existing tokens, on `<html data-skin="…">` in `routes/skins.css`: light values on
  `:root[data-skin=…]` and dark ones on `:root[data-skin=…].dark`, then a few signature rules (Telegram's wallpaper,
  Claude's and Playful's heading fonts, Playful's card and button lips, the glows behind Mono and Soft). Components
  don't know skins exist and keep their markup.
- `lib/components/shell/skins.ts` lists the skins (name, line, modes, Google Fonts families, swatch);
  `skin.svelte.ts` keeps the device's choice in `cmucourses:skin` beside `cmucourses:theme`, and `app.html` applies
  both before the first paint, loading the skin's fonts. Default has no attribute, so the site as designed is
  unchanged and loads no new font.
- Mono is only dark and Soft only light, as in MajorPay: choosing one decides the mode (`isDark`), and the Mode choice
  stays for the other skins, with a note saying so.
- Every skin keeps text tokens at 4.5:1 on `paper`, `surface`, `surface-2` and `selected` (status colors also on
  their tints), white on the accent and its hover, `line-strong` at least as visible as the default's, and calendar
  blocks' labels readable for all ten course colors (`--block-text-mix`). Brand colors that fall short are deepened;
  each changed value names the original.
- The header's dark switch becomes an Appearance button opening the themes and Light, Dark or Device; the phone menu
  and Profile › Settings show the same choices.

## Consequences

- Switching between light and dark takes two clicks instead of one.
- A new token needs a value in each skin, or that skin shows the default's value for it. A component that hard-codes a
  color ignores skins (the calendar image export keeps the default's colors on purpose).
- Fonts load from Google Fonts only for a skin that needs them. `skins.test.ts` checks that each family's request is
  well formed and that `app.html`'s copy of the fonts and one-mode skins matches `skins.ts`.
- The default look's own contrast is unchanged: its `muted` text (3.0 to 3.3:1) and white on its accent (3.3:1) stay
  as designed.
- `.light` and `.dark` subtrees (the dev gallery) show the default look.

# Encounty Tempest

Review gallery for the Tempest design language of the Encounty app, derived from the TenSura S4 opening (motion design, palette, highlights). This project is a visual sign-off artifact ahead of the frontend theme overhaul, not a functional component library: there is no compiled bundle and no component API.

## Design language

- Base: OLED black (#000000 to #1c1c20), subtle diagonal hatch texture
- Accents, neon on dark: orange #ffa14a (default), acid #c8e04a, crimson #f26389, cyan #3fd4e0, blue #7ab8ff, green #3fe08c, pink #f47ad0, violet #a685f0; each with an AA-compliant light-mode counterpart (orange maps to #b03a0b, acid to olive #566800 on light, never raw acid as text on light surfaces)
- Vocabulary: hairline borders, flat panels, dashed frames, uppercase letterspaced micro-label chips. Geometry rule: one radius step per control family, never per pixel height: chips, icon buttons and concentric inner boxes 4px, buttons and inputs 6px, menus and popovers 8px, panels 10px, dialogs 12px. Only toggles (switch pattern recognition) and true indicator dots are round; anything meant to stay square carries no radius at all.
- Motion: 150-240ms direction-aware clip-path reveals (wipe + slide + fade, cubic-bezier(.7,0,.2,1)) and opacity flickers, all gated by a global reduce-motion mode

## Accessibility

The design language is WCAG 2.2 Level AA by construction: every text/background token pair meets at least 4.5:1 (ratios annotated on the swatch cards), primary-accent surfaces carry dark text at 5:1 or better in both modes, controls whose border is their only boundary use `--border-input` for the 3:1 that WCAG 1.4.11 asks for, `:focus-visible` gets a 2px accent outline, and all motion is 150-240ms and gated by a global reduce-motion mode honoring `prefers-reduced-motion` (WCAG 2.3.3).

## Token source of truth

Tokens live in `frontend/src/index.css` of the Encounty repo under `[data-theme]` / `[data-accent]` selectors. `base.css` here mirrors them, selector for selector, so the gallery cannot drift away from the app. `build.sh` copies it to `dist/styles.css`.

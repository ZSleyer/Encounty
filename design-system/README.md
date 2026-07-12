# Encounty Tempest

Review gallery for the Tempest design language of the Encounty app, derived from the TenSura S4 opening (motion design, palette, highlights). This project is a visual sign-off artifact ahead of the frontend theme overhaul, not a functional component library: there is no compiled bundle and no component API.

## Design language

- Base: dark desaturated slate blue-gray (#0d1117 to #1e2836), subtle diagonal hatch texture
- Accents, neon on dark: acid #c8e04a (default), crimson #f0507a, cyan #3fd4e0, violet #a685f0; each with an AA-compliant light-mode counterpart (acid maps to olive #566800 on light, never raw acid as text on light surfaces)
- Vocabulary: hairline borders, corner brackets on panels, dashed frames, uppercase letterspaced micro-label chips, corner-cut primary CTAs
- Motion: 150-180ms clip-path reveals and opacity flickers, hard easing cubic-bezier(.9,0,.1,1), all gated by a global reduce-motion mode

## Accessibility

The design language is WCAG 2.2 Level AA by construction: every text/background token pair meets at least 4.5:1 (ratios annotated on the swatch cards), primary-accent surfaces carry dark text at 5:1 or better in both modes, `:focus-visible` gets a 2px accent outline (box-shadow fallback on clip-path buttons), and all motion is 150-180ms and gated by a global reduce-motion mode honoring `prefers-reduced-motion` (WCAG 2.3.3).

## Token source of truth

Once implemented, tokens live in `frontend/src/index.css` of the Encounty repo under `[data-theme]` / `[data-accent]` selectors. `styles.css` here mirrors the planned values.

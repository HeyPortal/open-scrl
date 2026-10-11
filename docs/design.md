# Studio web design

Studio is the web app’s design on desktop and phones: a deep dark dotted
stage, lilac controls and floating glass panels. Blue, teal and pink join
lilac in format previews, grid starters and fallback project covers.
Selection and focus stay lilac; canvas alignment guides use blue.

Soft modern typography uses self-hosted Bricolage Grotesque for the Open-SCRL
wordmark, Onest for interface text and headings, and Instrument Serif for
saved-project titles. The phone wordmark is 28px. Instrument stays at weight
400 without synthesized bold. Document text keeps its bundled Inter face;
changing interface fonts does not change saved text layers or exports.

The home screen is one calm column on desktop and phones: a format row with
name and Create, expandable grid starters, then recent projects shown as
strips of their opening slides. A soft brand glow replaces the dotted stage
there; there is no marketing hero.

`src/index.css` imports `src/styles/studio/` directly. `tokens.css` defines
all global `:root` values and `color-scheme: dark`; `chrome.css`, `panels.css`,
`inspector.css`, `landing.css` and `mobile.css` style their respective areas.
Tailwind retains `bg`, `ink`, `accent`, `accent-ink`, `line`, `canvas-bg`,
`canvas-dot`, `rounded-panel`, `rounded-control` and `shadow-panel` names.
Alpha-bearing colors multiply the token’s base opacity by utility opacity.
Keep the single `canvasTheme` object aligned with these CSS tokens; Konva
uses its stable values without reading computed CSS during rendering.
Document colors, presets and simulated feeds are content; changing the shell
palette must not recolor them. Fallback project covers use brand tokens.

`AppLogo` uses `public/app-icon.png`, the same artwork as the Mac app and
GitHub README (`docs/images/logo.png`). The favicon, Apple
touch icon and PWA icons share it. Regenerate those PNGs from the README
icon when the branding changes. The maskable PWA icon includes dark padding
so the artwork fits inside the central safe circle.

`App.tsx` keeps independent lazy desktop, phone editor and phone home
entries. The desktop editor has a command island for project name, format,
undo/redo and action search, plus a save/preview/export island. The tool dock
opens a library card; its active button or Escape closes it. Selection opens
Properties with Design and Layers tabs. With no selection, Layers and Slide
design open that card. Closing Properties clears selection. The timeline
provides slide previews, animated badges, sorting and slide actions, plus
zoom, fit, wide view and quick Slide PNG export. The top-bar Export button
opens shared [export settings](web-export.md) in a desktop dialog; on phones
they appear in a full-height sheet with a fixed action footer.

Cards occupy measured flex space rather than covering the fitted canvas.
`useStageMeasurement` observes the canvas frame; each editor mounts shared
shortcuts, drag/drop fallback and `EditorShellServices` once. The desktop
selection toolbar follows rotated world bounds, owning slides, scrolling
and zoom, hides during editor activity or offscreen, and uses shared actions.
Its geometry assumes the canvas’s 32px desktop inset and leaves room for
the Transformer rotation handle above a layer.

The phone editor wraps the shared touch layout with glass islands in flow.
Keep safe areas, sheet geometry, synchronous remeasurement and all gesture,
hit-testing, draft and activity lifecycles intact. Photos uses the import
drop zone in both the desktop library and phone sheet. See [mobile.md](mobile.md)
for the touch workflow and [AGENTS.md](../AGENTS.md) for implementation rules.

The desktop and phone home screens follow [studio-home.md](redesign/studio-home.md);
the [polish follow-ups](redesign/follow-ups.md) remain separate work.

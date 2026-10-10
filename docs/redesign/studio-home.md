# Studio home screen redesign

The home screen (desktop `LandingPage`, phone `MobileHome`) is the first thing people see. It should feel like
the front of a creative studio, in the same visual language as the Studio editor: a dark stage with a faint
grid, floating glass islands, coral `#ff6a3d` accent, Instrument Serif titles (19px and up, weight 400, never
bold; see AGENTS.md "Fonts") and Inter for everything else.

Functionality does not change. Everything the current home screens can do stays reachable: name and format for
a new project, create and open, open an existing project, search, sort (Last edited / Date created / Name),
grid and list views on desktop, grid starters on the phone, empty and no-match states, the phone's collapsing
top bar, and the "saved on this device" privacy message. Keep existing accessible names that tests use
(for example "Project name", "Canvas format" radiogroup, "Create & open editor" on desktop, "Create carousel"
on the phone, "Search projects", "Sort projects", "Project view", project buttons named by project).
Grid starters may be added to desktop because they reuse an existing phone feature.

## Desktop

1. **Header island.** Floating glass pill across the top (inset like the editor islands): logo tile and
   "Open-SCRL" in serif on the left; on the right a quiet privacy chip ("Saved on this device") and a coral
   "New carousel" button that scrolls to and focuses the create panel.
2. **Hero / create panel.** One wide glass panel:
   - Left column: serif headline (about 44–52px), for example "Make something worth swiping.", one line of
     supporting text, the project-name field and the coral "Create & open editor" button.
   - Right column: the format picker as large tactile cards. Each shows a proportional frame (the real aspect
     ratio, softly lit), platform name and pixel size. The selected card gets a coral rim and glow. Six formats
     fit in a 3×2 grid.
   - Under the panel, a "Start from a grid" row of grid-starter tiles (reuse the phone's `GridStarters`
     behavior and the chosen format).
3. **Continue editing.** If there are projects, the most recently edited one gets a wide feature card: large
   preview on the left, serif name, format · slide count, relative "Edited 2 hours ago", and an "Open" button.
4. **All projects.** A sticky glass toolbar row with the serif section title and count pill, search, sort and the
   grid/list toggle. Grid cards have a 4:5 preview well on the dark stage, serif name, and a two-line meta
   (format · slides, then relative edited time). Hover lifts the card with a coral hairline. The list view is
   a single glass panel of 56px rows.
5. **Previews.** Prefer a real preview of each project's first slide, rendered lazily only for cards on screen
   and cached in memory, using the existing storage and preview-rendering code (for example `readProject` and
   `SlidePreviewCanvas`). It must stay out of the initial chunk and must not slow first paint. If that is not
   practical without changing storage or the document schema, keep the generated covers, framed in the real
   aspect ratio, and say so.
6. **Empty state.** No projects: an illustrated stack of three tilted frames with a coral glow, "Your first
   carousel starts here", and the create button. No search match: a compact message with a "Clear search" link.
7. **Footer.** One quiet line: open source, MIT, files never leave the device.

## Phone

1. **Top bar.** Glass bar with logo and serif title that compacts on scroll (keep the current collapsing
   behavior), safe-area aware.
2. **Create card.** Serif "New carousel", horizontally snapping format cards with proportional frames, name field,
   coral full-width "Create carousel" button. 44px minimum targets.
3. **Start from a grid.** The existing grid starters, restyled as glass tiles.
4. **Continue editing.** Feature card for the most recent project (preview, name, meta, relative time).
5. **Your projects.** Search, then rows with a preview thumbnail, serif name, format · slides and relative time.
6. **Floating "New" button.** When the create card has scrolled out of view, a coral pill "New carousel"
   floats above the bottom safe area and scrolls back to the create card.
7. Empty state like desktop, scaled down.

## Quality bar

AA contrast for text, visible focus rings, `prefers-reduced-motion` respected, no layout shift as previews load,
smooth at 60fps while scrolling on a mid-range phone (avoid stacking many `backdrop-filter` layers in scrolling
lists; use them on fixed chrome only).

## As built

Shared pieces live in `src/components/home/` (`projectDisplay`, `useHomeActions`, `ProjectPreview`,
`GridStarters`, `ContinueCard`, `HomeEmpty`, `home.css`); desktop-only pieces are in
`src/components/landing/` and `src/styles/studio/landing.css`; the phone home keeps
`src/components/mobile/home/`. Both screens create and open projects through `useHomeActions`, so
the grid starters behave identically (project created, then the grid applied to its first slide).

**Real previews shipped.** Each card, row and feature card shows the project's first slide.

- `ProjectPreview` registers its frame with one shared `IntersectionObserver` (320px margin) and
  asks `previewQueue` for a render when it comes near the viewport. Jobs run two at a time after
  `requestIdleCallback`, are dropped if the card unmounts first, and the resulting object URLs sit
  in a 96-entry in-memory LRU keyed by project id, edit time, slide and size. A failed render is
  cached as a failure, so a broken project is not retried on every scroll.
- `renderProjectPreview` (a lazy chunk, loaded when the first card becomes visible) reads the
  stored document with `readProject`, runs `migrateDocument` on a copy, builds the slide scene and
  paints it with the editor's own `paintSlidePreview`. It writes nothing, never touches the editor
  or asset stores and never takes an editor-activity hold, so it cannot block a PWA update.
- Frames are sized by CSS container queries from the format's aspect ratio, so nothing shifts when
  an image arrives. Until then a quiet shimmer shows; if rendering fails the tokenised generated
  cover stays. After an edit the old image stays up until the new one is ready.
- The desktop feature card also shows up to three following slides as a faded strip.
- Decoded bitmaps go through the shared `imageResourceManager`, so they count against its existing
  192 MiB budget and are evictable; they are not released when the home screen is left.

**Deviations from the plan above**

- Section title is "Your projects" (not "All projects"): tests and the phone already use that name.
- Phone order is create card, Continue editing, grid starters, projects, so a returning user's
  latest project is above the fold (the previous home also put projects before the starters).
- The feature card's accessible name is "Continue editing" and the project name is in its
  description. The same project is also in the list, and two buttons named after it would break
  existing locators; project cards and rows are "Open <name>".
- The empty-state heading keeps the accessible words "No carousels yet" as a small eyebrow above
  the serif "Your first carousel starts here".
- The default project name field is empty with an "Untitled" placeholder (as on the phone).
- Desktop format cards support arrow keys (roving tabindex); the desktop create button also keeps
  the `btn-primary` class that `e2e/fonts.spec.ts` selects.
- The three phone-home rules that lived in `src/styles/studio/mobile.css` moved into the home CSS.
- Relative times use `Intl.RelativeTimeFormat` ("5 minutes ago", "yesterday", "last week") and
  refresh every minute while the page is visible; the absolute date is the `title`.

# Studio home screen

The web home takes its structure from the Mac welcome screen: compact creation controls beside recent projects on desktop, and the same flow stacked on phones. There is no marketing hero or duplicate latest-project feature card.

## Typography

Soft modern pairs Bricolage Grotesque for the Open-SCRL wordmark with Onest for controls, labels and section headings. Instrument Serif remains an accent on saved-project titles, at weight 400 and 19px or larger. Fonts are self-hosted, including their Latin Extended subsets, and work offline. Document text continues to use its bundled Inter face independently of the interface fonts.

## Desktop

- The header carries the Mac app icon, wordmark, local-storage note and **New carousel** shortcut. The shortcut scrolls to and focuses the project-name field.
- The left column has six proportional format cards, a project-name field and **Create & open editor**. Format cards support arrow-key selection. An empty name creates **Untitled**.
- **Start from a grid** expands eight layouts below the creation controls. A chosen layout uses the selected format and name and applies the grid to the first slide.
- **Recent projects** appears alongside creation, sorted by last edit by default. Search, sorting and remembered grid/list views remain available. Each project appears once, with its first-slide preview, format, slide count and edited time.
- Empty and no-match states use short messages and an action to create or clear the search.

## Phone

The Mac icon and wordmark sit above a compact **New carousel** form. Swipe the format cards sideways, enter a name and tap **Create carousel**. Grid starters are expandable; recent projects follow as thumbnail rows. Search appears with more than three projects.

The compact top bar appears on scroll. When creation scrolls out of view, **New carousel** floats above the bottom safe area; it hides while the keyboard is open. These controls preserve the phone's existing scroll and keyboard behavior.

## Preview implementation

Shared pieces live in `src/components/home/`; desktop controls live in `src/components/landing/` and `src/styles/studio/landing.css`, while phone controls live in `src/components/mobile/home/`. Both screens create and open projects through `useHomeActions`.

`ProjectPreview` uses a shared `IntersectionObserver` with a 320px margin and requests a render only when a card is near the viewport. `previewQueue` runs two jobs at a time and caches object URLs in a 96-entry LRU. `renderProjectPreview` remains a lazy chunk: it reads and migrates the document, compiles the scene and paints with `paintSlidePreview`, without writing to storage or taking editor activity holds. Decoded images count against the shared image-resource budget. Preview frames retain the format's aspect ratio while images load.

Projects remain local to this browser. Storage, schema, canvas gestures and export rendering retain their existing contracts.

# Studio home screen

The web home is one calm column: create a carousel, then pick up a recent one. There is no marketing hero, no boxed side panel and no dotted backdrop. A soft lilac, blue and teal glow sits behind the top of the page. Recent projects show each carousel as a seamless strip of its opening slides, so the page shows what the app makes.

## Typography

Soft modern pairs Bricolage Grotesque for the Open-SCRL wordmark with Onest for controls, labels and section headings. Instrument Serif remains an accent on saved-project titles, at weight 400 and 19px or larger. Fonts are self-hosted, including their Latin Extended subsets, and work offline. Document text continues to use its bundled Inter face independently of the interface fonts.

## Desktop

- A sticky header carries the Mac app icon, wordmark and a "Saved on this device" note. It frosts once the page scrolls, and a **New carousel** shortcut appears only after the create row has scrolled away; it scrolls back and focuses the name field.
- **New carousel** is a row of six proportional format tiles (arrow keys move the selection), then the name field and **Create carousel** on one line. An empty name creates **Untitled**.
- **Start from a grid layout** expands eight layouts under the row. A chosen layout uses the selected format and name and applies the grid to the first slide.
- **Recent projects** follows, sorted by last edit by default, with search, sorting and remembered grid/list views. Cards show a strip of the first slides (portrait three, stories four, landscape one) drawn edge to edge, then the name and one line of format, slide count and edit time.
- Empty and no-match states use short messages; the empty state has no extra button because Create sits directly above.

## Phone

The Mac icon and wordmark sit over the same glow. **New carousel** has sideways-scrolling format tiles, the name field and a full-width **Create carousel**. Grid layouts are expandable; recent projects follow as rows with a two- or three-slide strip. Search appears with more than three projects.

The compact top bar appears on scroll. When creation scrolls out of view, **New carousel** floats above the bottom safe area; it hides while the keyboard is open. These controls preserve the phone's existing scroll and keyboard behavior.

## Preview implementation

Shared pieces live in `src/components/home/`; desktop controls live in `src/components/landing/` and `src/styles/studio/landing.css`, while phone controls live in `src/components/mobile/home/`. Both screens create and open projects through `useHomeActions`.

`ProjectPreview` uses a shared `IntersectionObserver` with a 320px margin and requests a render only when a card is near the viewport. `previewQueue` runs two jobs at a time and caches object URLs in a 96-entry LRU. `renderProjectPreview` remains a lazy chunk: it reads and migrates the document once, compiles each requested slide and paints them side by side into one strip image with `paintSlidePreview`, without writing to storage or taking editor activity holds. Decoded images count against the shared image-resource budget. Preview frames retain the format's aspect ratio while images load.

Projects remain local to this browser. Storage, schema, canvas gestures and export rendering retain their existing contracts.

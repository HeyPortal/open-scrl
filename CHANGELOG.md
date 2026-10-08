# Changelog

Every release of Open-SCRL for Mac, newest first. Each version is published on the
[Releases page](https://github.com/HeyPortal/open-scrl/releases) with its disk image,
checksums, and a copy of this changelog.

## 0.5.5 — 2026-10-08 (build 7)

Smoother scrolling and zooming on the canvas.

- The canvas no longer flashes white at the edges of slides while you scroll or zoom.
- Photos stay in place under slide outlines, slide headers, and selection handles while the canvas moves, instead of shifting against them.
- Scrolling and zooming keep up on large projects. On a 20-slide project of 13-megapixel photos, the canvas skipped about a third of its frames while scrolling zoomed in; it now draws nearly all of them.
- Blend Groups whose photos only touch at an edge no longer slow down every frame, and blend seams no longer shift slightly with each zoom step.
- Dragging a photo in a Blend Group is more responsive.

Exports are unchanged.

[Changes since 0.5.0](https://github.com/HeyPortal/open-scrl/compare/macos-v0.5.0...macos-v0.5.5)

## 0.5.0 — 2026-10-07 (build 6)

- Replace or fill any existing photo frame from Media or by dropping a photo onto it. The frame keeps its size, rotation, styling, and lock, and the crop resets.
- Drop several photos onto a frame to replace that photo and fill the slide's other visible empty frames in order. Extras stay in Media, and the placement message reports how many fit. Dropping onto empty canvas adds new photo layers.
- Use **Shuffle Photos** in the slide inspector to rearrange the current slide's visible filled frames. Duplicate photos are supported; the button is disabled when there is no different arrangement.
- Select two frames to **Swap Photos**, or choose a partner from a photo's inspector. Partners can be on another slide; choosing an empty frame moves the photo and leaves the source empty.
- Replacement, batch placement, shuffle, swap, and move each use one undo step. Frame locks and styling stay attached to their frames.
- Replacing a member of a Blend Group keeps its joins and clears the previous matching analysis. Blend Group members are excluded from shuffle and swap.

Addresses [#21](https://github.com/HeyPortal/open-scrl/issues/21), [#20](https://github.com/HeyPortal/open-scrl/issues/20), and [#22](https://github.com/HeyPortal/open-scrl/issues/22) through explicit swap and move controls. Long-press dragging and edge auto-scroll remain deferred.

[Changes since 0.4.1](https://github.com/HeyPortal/open-scrl/compare/macos-v0.4.1...macos-v0.5.0)

## 0.4.1 — 2026-10-07 (build 5)

### Blend several photos into one composition

- Select two or more photo or video layers and choose **Arrange ▸ Blend Photos** to create a Blend Group. Move or resize the photos together, add another photo, or tune an individual join from the inspector.
- **Automatic** chooses a blend style for you. **Seamless** aligns shared scene detail and matches colors near the join; **Soft** creates a gentler transition while preserving each photo's colors.
- Give a join a **Clean**, **Organic**, or **Glow** edge, then adjust its width, position, color matching, and alignment.
- Crop or replace one photo without losing the group. **Separate Photos** restores independent layers in one undo step.

### Style more, arrange less by hand

- Edit several layers at once: Shift-click or drag a selection box, then move, resize, rotate, duplicate, align, or distribute the selection. Group layers with **⌘G** and double-click a group to work on one member.
- Add outlines, shadows, highlights, and gradient fills to text, or use shrink-to-fit for longer captions.
- Frame photos with masks such as arches, blobs, stars, and hearts, with borders and shadows.
- Use radial or multi-stop gradient backgrounds, a photo background with blur and dim controls, or export a PNG with a transparent background.

### See the post before you publish it

- Open **Phone Preview** with **P** or **⌥⌘P** to see the carousel in a phone feed, a story layout for tall formats, or a profile grid with the 3:4 crop. Swipe or use the arrow keys to check each slide; press **F** for full screen.

### A smoother Mac workflow

- GPU-accelerated rendering powers the canvas, photo effects, and exports. Dragging, resizing, rotating, and cropping use a live preview, and each gesture is one undo step.
- Drag a slide from the filmstrip into Finder, Messages, or Mail as a full-resolution PNG. Animated slides use their first frame.
- Feel alignment snap into place with trackpad haptics.
- Follow longer exports with progress on the Dock icon, and optional notifications when a video export finishes in the background.

[Changes since 0.2.0](https://github.com/HeyPortal/open-scrl/compare/macos-v0.2.0...macos-v0.4.1)

## 0.2.0 — 2026-10-02 (build 2)

- Add, duplicate, and delete slides right on the canvas. **New Slide After**, **Duplicate**, and **Delete** buttons sit next to each slide's number above the canvas, on the selected slide and on any slide you point at. On a slide that's partly scrolled out of view, they stay at the visible edge; when you're zoomed out too far for them to fit, only the slide number shows.
- Deleting a slide you aren't editing keeps the slide you're working on selected.

[Changes since 0.1.0](https://github.com/HeyPortal/open-scrl/compare/macos-v0.1.0...macos-v0.2.0)

## 0.1.0 — 2026-10-01 (build 1)

The first release of the native Mac app.

- **Projects are files.** Each project is a single `.openscrl` file that holds its photos and videos. Autosave, Revert To, Open Recent, and Finder previews work like any Mac document.
- **Made for macOS 27.** A Liquid Glass toolbar and floating filmstrip, a tool sidebar for grids, media, text, shapes, and backgrounds, an inspector with **Design** and **Layers** tabs, full menu-bar commands, and a **⌘K** command palette.
- **Edit on the canvas.** Move, resize, and rotate with smart guides and slide-seam indicators. Option-drag to duplicate, double-click text to type in place, and double-click a photo to reposition its crop. Pinch or ⌘-scroll to zoom.
- **Carousels in seconds.** Drop photos or videos on the Dock icon to start a carousel with one slide per item. Panoramas spread across slides automatically. Choose from 25 photo grid layouts, and import from your Photos library, including HEIC photos.
- **Export and share.** Export every slide in posting order to a folder or ZIP, as PNG, JPEG, or HEIC at 1× or 2×. Slides with GIFs or videos become H.264 MP4s. **Share Carousel** sends every slide with AirDrop, Messages, or Mail.

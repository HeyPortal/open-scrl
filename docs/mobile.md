# The mobile layout

The web app has a touch-first layout for phones: its own home screen and editor. It opens the same projects as the desktop layout. This page describes how the phone layout works.

## When the mobile layout is used

The mobile layout is used when the browser window is 767 px wide or narrower, or when the screen is a touch screen 500 px tall or less (a phone turned sideways). Tablets in portrait, and wider windows, get the desktop editor. The check runs as the window changes size, so rotating a phone switches layouts without closing the open project.

## Home screen

- **New carousel**: pick a canvas size (IG Portrait, IG Square, IG Story / Reels, IG Landscape, TikTok, or Pinterest), type a name, and tap **Create carousel**. A blank name keeps the project called Untitled.
- **Start from a grid**: eight photo layouts, such as a 2 × 2 grid or a 1 + 2 layout. Tapping one creates a project in the chosen size with that grid already placed.
- **Your projects**: each row shows the name, canvas size, slide count, and when it was last edited. Tap a row to open it. A search box appears once you have more than three projects.

The footer reads "Projects are stored locally in this browser." Clearing the site's data in that browser deletes them.

## Editor layout

- **Top bar**: the back chevron returns to the home screen. The project name opens the **Project** sheet, which renames the project, sets the canvas format, and has **Back to projects**. A dot after the name shows while changes are saving or after a save has failed. **Undo** and **Redo** are icon buttons, and **Export** opens the export sheet.
- **Canvas**: the slides sit side by side with the selected one centered. A counter such as "2 / 5" appears below the canvas when there is room.
- **Slide strip**: a thumbnail for each slide, then a + button to add one. See [Slides](#slides).
- **Dock**: six tabs, **Photos**, **Grids**, **Text**, **Shapes**, **Canvas**, and **Layers**. Each opens a sheet. Tap the active tab again to close its sheet.
- **Selection bar**: replaces the dock while a layer is selected. See [Selecting and editing](#selecting-and-editing).

A sheet rises from the dock and the canvas shrinks to make room. The slide strip hides while a sheet is open. Sheets open at half height. Drag the handle or title bar up to expand a sheet to full height, or down to collapse it. Drag further down, or tap the X, to close it. Tapping the handle or title bar toggles between half and full height.

## Adding photos, grids, text, shapes, and backgrounds

- **Photos**: **Import media** opens the file picker for images, GIFs, and videos. **As slides** imports each file onto its own new slide, and panoramas span as many slides as they need. Tap a photo to add it to the current slide. The ⋯ button on a photo offers **Add to slide**, **Spread across N slides**, **New slide with this**, and **Remove from project**. When a photo frame is selected, the menu also offers to fill or replace it. Files stay on the device.
- **Grids**: tap a grid to apply it to the current slide. This replaces the slide's layers with empty photo frames. Open **Spacing** to set the gap and margin the grid uses. To fill an empty frame, select it and then tap a photo in **Photos**.
- **Text**: **Add text box** adds a box that reads "Double-tap to edit". The style presets below it work two ways. With a text layer selected, a preset replaces that layer's text, size, and weight. Otherwise it adds a new box. Inter is bundled with the app, including italics, so it uses the same face while editing and in exported images and videos. Existing Inter text also uses the bundled face; its line wrapping may change from the previous fallback font.
- **Shapes**: tap a shape to add it to the slide.
- **Canvas**: sets the background of the current slide to a color, gradient, photo, or none. **Apply to all N slides** copies it to every slide.

## Selecting and editing

Tap a layer on the canvas to select it. The selection bar starts with a label (Photo, Text, Shape, Group, or the number of layers) followed by the actions, which scroll sideways when they don't all fit:

- **Edit**, **Replace** (or **Add photo** on an empty frame), **Duplicate**, **Forward**, and **Backward**
- **Lock** (or **Unlock**), **Group** and **Ungroup** when they apply, and **Delete**
- **Done** clears the selection.

**Edit** opens a properties sheet titled Photo, Text, Shape, Layer, or "N layers". It holds the desktop inspector's controls with larger targets. In a photo's section, **Replace** (or **Choose photo** for an empty frame) opens **Photos**.

To replace a photo, select it and tap **Replace**. The Photos sheet then reads "Tap a photo to replace" the frame. Tapping another photo swaps it in. Tapping the photo already there duplicates it. **Add new instead** cancels the replace and adds a new layer.

On the canvas, one finger selects one layer at a time. To select several, open **Layers**, tap **Select**, and tap the layers you want.

## Canvas gestures

- **Tap** a layer to select it. Tap empty canvas to clear the selection and select the slide under your finger.
- **Drag** a layer to move it, with snapping. Dragging an unselected layer selects it first.
- **Drag** empty canvas to pan. At fit zoom, a slow swipe settles on the nearest slide, and a quick flick moves one slide.
- **Pinch** on empty canvas to zoom around your fingers. Pinching together past the fit view shows several slides side by side. Pinching back to near fit snaps to fit.
- **Two fingers on a selected layer**: if one unlocked layer is selected and your fingers start on or just around it, pinching scales it, twisting rotates it (snapping to 45° when within 4°), and moving both fingers moves it. Releasing commits the whole change as a single undo step. Two fingers that start elsewhere zoom the canvas instead.
- **Double-tap** a text layer to edit it in place. The box grows with the text. Tap **Done** above it, or tap outside it, to finish. Touch has no Escape key, so **Done** is the way out.
- **Double-tap** empty canvas while zoomed in to return to the fit view. At fit zoom, a double-tap does nothing extra.

The browser's own pinch-zoom is turned off on the canvas, so pinching only changes the canvas.

## Slides

- **Select**: tap a thumbnail. The strip keeps the selected one centered.
- **Add**: the + at the end of the strip adds a blank slide after the selected one and selects it.
- **Duplicate, move, or delete**: tap the selected thumbnail to open its menu with **Duplicate**, **Move left**, **Move right**, and **Delete**. Move left and Move right are dimmed at the ends, and Delete is off when only one slide is left. Slides are reordered from this menu, not by dragging.

## Layers

The **Layers** sheet lists the current slide's layers, top layer first. Tap a row to select it, and drag its grip to reorder. Each row has lock and visibility buttons. The selected row also shows **Duplicate**, **Delete**, and **Edit properties**. Group rows have a chevron to expand or collapse them. The **Select** button in the sheet header turns on multi-select.

## Export and phone preview

**Export** in the top bar opens the export sheet, which shows the slide count, format, and pixel size. Everything is rendered on the device.

- **Export carousel** downloads one ZIP named after the project with `_instagram` added. It holds `01.png`, `02.png`, and so on for still slides, and `01.mp4` for any slide with a GIF or video. A progress bar shows while it works.
- **Save this slide** downloads the selected slide as a PNG named after the project and its slide number.
- **Preview on phone** shows the project in a phone frame, in Feed (Story for story formats) or Profile grid. Swipe to move between slides, and close the preview with its close button.

Images are exported at the canvas size (for example 1080 × 1350 for IG Portrait). Files download through the browser. Nothing is saved to Photos.

## Landscape

On a phone turned sideways, the sheet opens as a panel on the right, about 46% of the screen width and no wider than 380 px, with the canvas on the left. The top bar and dock shrink, and the slide counter is hidden because there is no room for it.

## Known limitations

- Projects can't be renamed or deleted from the home screen. Rename an open project from the **Project** sheet.
- Exports download as files. They are not saved to Photos.
- Two-finger transform works on one unlocked layer at a time. With several layers selected, two fingers zoom the canvas.
- Selecting several layers on touch is done through the **Layers** sheet, not by dragging a box on the canvas.

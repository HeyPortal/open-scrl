# Mac changelog

## 0.5.0 — 2026-10-07 (build 6)

- Replace or fill any existing photo frame from Media or by dropping a photo onto it. The frame keeps its size, rotation, styling, and lock, and the crop resets.
- Drop several photos onto a frame to replace that photo and fill the slide's other visible empty frames in order. Extras stay in Media, and the placement message reports how many fit. Dropping onto empty canvas adds new photo layers.
- Use **Shuffle Photos** in the slide inspector to rearrange the current slide's visible filled frames. Duplicate photos are supported; the button is disabled when there is no different arrangement.
- Select two frames to **Swap Photos**, or choose a partner from a photo's inspector. Partners can be on another slide; choosing an empty frame moves the photo and leaves the source empty.
- Replacement, batch placement, shuffle, swap, and move each use one undo step. Frame locks and styling stay attached to their frames.
- Replacing a member of a Blend Group keeps its joins and clears the previous matching analysis. Blend Group members are excluded from shuffle and swap.

Addresses [#21](https://github.com/HeyPortal/open-scrl/issues/21), [#20](https://github.com/HeyPortal/open-scrl/issues/20), and [#22](https://github.com/HeyPortal/open-scrl/issues/22) through explicit swap and move controls. Long-press dragging and edge auto-scroll remain deferred.

[Changes since 0.4.1](https://github.com/HeyPortal/open-scrl/compare/macos-v0.4.1...macos-v0.5.0) · [Earlier release notes](https://github.com/HeyPortal/open-scrl/releases/tag/macos-v0.4.1)

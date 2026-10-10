# Studio follow-ups

Remaining polish work for the Studio web design. These items are separate
from making Studio the only design and from the home redesign.

- Desktop: when the rightmost slide scrolls under it, the collapsed Properties pill overlaps the top-right of
  the slide band. Fixing it needs a stage inset in `Canvas`.
- Phone menus: `src/components/mobile/mobile.css` hard-codes a 14px radius and 15px text for `.menu` and
  `.menu-item`; align them with the Studio menu look in `src/styles/studio/overlays.css`.

Photo Flip would require a document-model feature, since the schema has no
flip property. It is outside this design work.

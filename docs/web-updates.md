# Web app updates and offline tools

The web app downloads a new version in the background and offers **Reload to
update** after media imports, exports, canvas gestures, and in-place text edits
finish and the latest document saves. Choosing **Later** keeps the current page open. Reload checks
again for new work and saves again before activating the update. If another tab
activates an update, this tab still waits for its work and offers its own reload.

A failed save keeps the editor open. Use **Retry saving** before updating; the
update becomes available once saving succeeds.

The app and editor are cached for offline use after the initial installation.
HEIC conversion, ZIP packaging, and the export worker are downloaded when first
used and then cached for up to 30 days. First use of those tools needs a network
connection. HEIC conversion uses a lazy browser adapter with its own decoder
worker, followed by the existing thumbnail and asset import worker.

The build uses Vite 8, React plugin 6, and PWA plugin 2. It preserves the previous
browser compilation targets. Bundled development and the experimental native
React Compiler remain disabled. Production PWA lifecycle checks run with
`npm run test:pwa`; the development browser tests do not register service workers.

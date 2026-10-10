# Performance and backend review

Reviewed the local-first storage, document persistence/history, media import,
image-resource lifecycle, scene compilation, export pipelines, and build setup.
There is no server/API backend in this repository; persistent data is managed
through IndexedDB and OPFS, with workers for media processing.

## Changes implemented

- **Project migration:** merge legacy and current project summaries by ID. Previously,
  saving the first migrated project caused all remaining legacy projects to disappear
  from the project list. Current summaries take precedence and retain recency sorting.
- **Scene compilation:** calculate global bounds directly from the slide index and
  layer being visited. Previously every layer searched slide membership again, with
  another search for each emitted item. Compilation now takes one pass through slides
  and layer references while retaining stacking, visibility, and spanning layers.
- **Export lifecycle:** reject already-aborted exports, terminate workers immediately
  on cancellation, reject worker errors/deserialization failures, and clean up abort
  listeners and handlers on completion or failure. Synchronous message-post failures
  also release the worker.
- **Export compatibility:** HTML canvas encoding now works when `OffscreenCanvas` is
  absent; the previous `instanceof OffscreenCanvas` caused a ReferenceError.
- **Storage fallback:** failed OPFS file creation, stream creation, writes, and closes
  now return control to the existing IndexedDB fallback. Open streams are aborted.
  Reads prefer committed fallback blobs over empty/stale OPFS files left by a failed
  write. Successful thumbnail replacement removes any obsolete IndexedDB fallback.
  This adds a small IndexedDB lookup for OPFS-backed blob reads.

## Measurement

A local Node microbenchmark compared the previous and updated scene compiler on
100 slides containing 5,000 visible shape layers, filtering a three-slide viewport.
Both produced identical serialized output. After five warm-up iterations, median
latency over 25 iterations was **9.246 ms before and 0.045 ms after**.
This isolates compilation; it does not measure total editor rendering, decoding,
or low-end device performance. It is not an end-to-end speedup claim.

## Follow-up priorities addressed

All four priorities from the initial review have now been investigated and fixed.

1. **Cross-tab asset mutations:** last-reference checks, project links, metadata,
   and IndexedDB blob writes/deletes now share appropriate transactions. Imports
   check the unique hash again inside the committing transaction. Each staged
   original and thumbnail has a unique filename, so losing imports and delayed
   deletion cannot remove another operation's files. Thumbnail replacement uses
   the same staging approach and rechecks that its asset still exists. Project
   scope migration now checks metadata and its marker in the same transaction.
   Legacy original reads no longer perform opportunistic writes that could
   resurrect a deleted asset; existing legacy originals remain readable in
   IndexedDB. A transaction helper explicitly aborts on synchronous request
   scheduling exceptions as well as asynchronous request failures.
2. **Import-worker recovery:** active requests are tracked centrally. Runtime and
   message-deserialization failures reject all affected requests and release their
   concurrency slots. The next queued or new import creates a fresh worker.
   Construction and synchronous posting failures also release queue slots. Failed
   files are reported through the existing import results rather than retried in
   an unbounded loop. Worker bitmaps close even if thumbnail generation fails.
3. **Image ownership:** each successful acquisition returns an individual lease
   with an idempotent release method. Canvas effect cleanup releases only a lease
   it actually owns; acquisition that completes after cancellation releases that
   lease immediately. A stale lease cannot decrement a replacement bitmap's
   reference count. Removing an asset invalidates pending decodes, closes their
   eventual bitmaps, and cannot erase newer work for the same asset ID.
4. **Persistence and recovery:** concurrent flush callers share one promise, which
   drains edits arriving during the active save. Debounced failures are handled
   without unhandled rejections; explicit retries remain possible. Document writes
   are serialized across autosave and navigation, and summary updates merge into
   current state. Save failures retain the active project and display a persistent
   retry control. Startup and media-library failures have retry controls as well.
   Failed database-open promises are cleared so retries can establish a connection.

## Validation

- `npm run verify`: passed type checking, lint, all **59 tests across 22 files**,
  production build, and bundle checks. Initial entry is approximately **81 KiB gzip**.
- `npm run test:e2e`: all **12 Chromium tests passed**.
- `git diff --check`: passed. The save-error banner was also visually inspected.
- Regression tests force simultaneous commits from separate repository instances,
  delayed filesystem deletion followed by reimport, linking during deletion,
  thumbnail completion after deletion, and synchronous partial-write failure.
- Worker tests exercise multiple failed requests, queued recovery, failed worker
  construction, and failed message posting. Image tests exercise shared decodes,
  repeated release, pending-decode invalidation, and replacement ownership.
- Persistence tests cover slow saves, edits during a save, explicit failure retry,
  disposal, serialized document snapshots, summary preservation, navigation failure,
  and asynchronous database-open recovery.
- Chromium tests cover two tabs importing the same file, preservation of the other
  tab's asset after unlinking, failed startup with retry, and failed autosave with
  retry followed by a page reload, and media-library retry. Existing editor/export
  browser tests also pass.

## Mobile reliability follow-up — 2026-10-10

The phone layout shares the existing document, asset, and export systems. Its
touch hit testing now follows live layer geometry rather than a bitmap hit map,
including text above photos and layers moved across slide boundaries. Interrupted
drags and two-finger transforms are discarded; interrupted handle resizing keeps
the last visible size and releases the handle so the layer stays touchable.

Phone gestures and inline text drafts now hold the app-update activity guard
through commit or cancellation. Production checks verify that an accepted update
waits for active mobile work and persists it before reload. Escape and project
switches discard drafts, while a same-project field unmount preserves typed text.
A loading screen stays visible while the app and bundled fonts initialize.
These are reliability fixes; no phone performance speedup was measured.

The merged mobile/runtime acceptance passed 348 unit tests in 50 files,
64 Chromium browser tests, and 13 production PWA tests, with a 97.6 KiB gzip
entry below the 120 KiB limit. Those figures supplement the historical storage
review above. Physical Android Chrome checks verified the touch and cross-slide
fixes before the stack integration; the upgraded runtime was checked through
Chromium touch emulation. See [mobile workflows](docs/mobile.md) and
[runtime integration evidence](docs/web-stack-upgrade.md).

## Scope and limitations

Browser verification covers Chromium. Safari/Firefox and actual disk exhaustion
were not exercised; storage failures are injected in tests. OPFS and IndexedDB are
separate storage systems: unique staged files and transactions prevent the tested
interleaving races, but an abrupt browser/process crash can still leave orphaned
staging files. There is no crash-recovery garbage collector in this change.

The changes coordinate asset storage across tabs. They do not add collaborative
editing or conflict resolution when two tabs edit the same project. Import-worker
recovery handles reported errors; it does not add a timeout for a worker that runs
indefinitely without reporting failure. Legacy originals already in IndexedDB stay
there instead of being copied during a read. The existing image tiers, lazy editor
boundary, sequential bulk imports, and incremental ZIP writer are retained.

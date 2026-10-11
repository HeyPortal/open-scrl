# Browser testing

Bun installs dependencies and launches the browser-test scripts. Playwright and
Vite run on Node through their installed CLI shebangs; the application runs in
Chromium. Use the versions pinned in `package.json` and `bun.lock`, and keep
Node 22.12 or later installed. Do not substitute Bun's own `bun test` runner or
force the tool CLIs onto Bun with `--bun`.

## Run the suites

```bash
bun install --frozen-lockfile
bunx playwright install --with-deps chromium
bun run verify
SCRL_E2E_PORT=5186 bun run test:e2e
PWA_PORT=5187 bun run test:pwa
```

The editor suite starts Vite, using two workers locally and in CI. The production
PWA suite builds `dist/` and starts the Bun test server with one worker because
the tests change its service-worker revision. Both suites use fresh browser
contexts per test, retain normal motion, and default to zero retries. CI rejects
focused tests and flaky results, even if retries are requested on the command
line. Run builds and PWA checks sequentially because they both write `dist/`.

The editor suite can reuse a local server at its configured port; CI always
starts its own. Use an unused `SCRL_E2E_PORT` when working in multiple checkouts.
The PWA suite always starts its own production server.

To run a file or repeat a specific test, pass Playwright arguments directly to
the Bun script:

```bash
SCRL_E2E_PORT=5186 bun run test:e2e e2e/home.spec.ts
SCRL_E2E_PORT=5186 bun run test:e2e e2e/home.spec.ts \
  --grep 'floating New carousel' --repeat-each 20 --workers 2 --retries 0
PWA_PORT=5187 bun run test:pwa --grep 'offline'
```

## Inspect failures

Screenshots, error context, attachments, and retained traces are written under
`test-results/e2e/` and `test-results/pwa/`. HTML reports are written under
`playwright-report/e2e/` and `playwright-report/pwa/`. Running one suite preserves
the other suite's artifacts. CI uploads both artifact roots when a check fails.

```bash
bun run test:report playwright-report/e2e
bun run test:report playwright-report/pwa
bun run test:trace test-results/e2e/<failed-test>/trace.zip
```

Playwright's built-in failure output may suggest `npx playwright show-trace`.
Use the equivalent `bun run test:trace` command above; no npm installation is
needed.

## Write reliable tests

Import `test` and `expect` from `e2e/fixtures/test.ts` (or `../fixtures/test` in
the PWA directory). The automatic fixture captures uncaught browser errors from
every tab and popup and checks them after each test. Errors also appear in a
`browser-errors` attachment. Handled import, storage, and export failures remain
testable through their existing UI recovery paths. `bun run typecheck` checks
all browser specs, fixtures, and both Playwright configs.

Use locator assertions for rendered content and `expect.poll` for geometry or
asynchronous store state. Visibility does not imply that an entrance transition
has finished: the floating New carousel pill can be visible before it reaches
its required clearance. Measure against the actual viewport and retain the
clearance requirement while polling. Avoid fixed sleeps and looser bounds to
make a test pass.

Tests of animation behavior should control the real CSS animation's progress
through the Web Animations API, then let it complete normally. Sampling fixed
progress points checks intermediate layout and monotonic movement without
depending on how many frames a busy CI browser paints. Other interaction tests
continue to exercise normal animations and Playwright's actionability checks.

Keep canvas gesture tests on the actual `window.Konva` singleton, with CDP for
Chromium touch sequences. Do not import generated Vite dependency filenames.
Touch emulation verifies browser behavior; physical-phone checks should be
reported separately when available.

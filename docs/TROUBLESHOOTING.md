# Troubleshooting

_(Added 2026-11-06 as part of the AUDIT-30 traceability set. Every string, threshold,
port and command in this file was read out of the current tree; the line references
point at the code that produces the behavior. If your observation does not match
what is written here, the code is the authority — check the cited file.)_

## 1. What this application is, so expectations stay honest

A static, client-only browser application: Vite build, Three.js rendering, and a
physics Web Worker (`src/workers/physics.worker.ts`). There is no server, no account
system, no database, and no persistence — `src/` contains no `localStorage`,
`sessionStorage`, `indexedDB`, or cookie usage. It sends no telemetry and cannot
report anything to a maintainer about your session, which is why §6 matters.

Accuracy is documented per-path with measured windows in
[`docs/VALIDATION_LOG.md`](./docs/VALIDATION_LOG.md), and out-of-range ephemeris
dates are refused rather than approximated. Nothing here is flight-rated.

## 2. Reading the diagnostics readout

The `<pre id="readout">` block is assembled in `src/ui/panel.ts:1405-1443`. What
each line means, and what a bad value tells you:

| Line | Meaning | If it looks wrong |
| :--- | :--- | :--- |
| `Date (UTC)` / `Terrestrial TT +…s (… leap-s, TT-TAI 32.184s)` / `Barycentric TDB+…s` | The full UTC→TAI→TT→TDB chain applied to the simulation instant (`src/physics/time.ts`) | A constant-looking TT offset across leap-second boundaries means the table was bypassed; the chain is asserted in `tests/time.test.ts` |
| `Sun-SSB dist`, `Sun speed` | Solar-system-barycenter wobble of the Sun | Zero while in N-body mode means the worker is not advancing |
| `\|ΔE/E\|`, `\|ΔL/L\|`, `\|ΔCM\|` | Relative energy, angular-momentum and center-of-mass drift since the last rebase | Growing steadily with time is expected for a symplectic integrator over long arcs; a jump on a single step points at a force-model or step-size change |
| `Integrity      OK` / `Integrity      VIOLATION: energy, …` | The invariant gate in `src/observability/invariants.ts:31-33` (`1e-6` on each of the three metrics) | These limits are labeled **UNVERIFIED operational thresholds** in the source (`:27`) and tracked as OPEN-001 — a violation is a signal to investigate, not proof of a broken build |
| `Health         ALL OK` / `PARTIAL` | `formatModuleHealth` over the health registry (`src/ui/panel.ts:93`, `src/observability/health.ts`) | `PARTIAL` means at least one module still reports `unknown` — that subsystem has not had a chance to report yet, which is normal right after load and suspicious minutes in |
| `Render         … FPS (…) · quality Q0..2` | Frame rate plus the adaptive quality level; `0` is full (`src/render/viewer.ts:615`) | Persistent `Q2` means the renderer is dropping pixel ratio and galaxy star counts to keep up |
| `SIMULATION BUSY` | The solver could not finish the requested advance inside its step budget (`maxDt` / `maxSteps`, `src/sim/engine.ts:12-16`) | Lower the speed slider, shorten the target date jump, or switch to a coarser integrator |
| `WORKER FAULT — reload the page (sim parked safely)` | The physics worker threw and was **parked** instead of respawn-looping (`src/sim/simClient.ts:162,171`, surfaced at `src/main.ts:668`, gated at `:380`) | Reload. Then capture the console: the fault is not recoverable in-page by design |

## 3. Symptom → cause → what to check

| Symptom | Verified cause | What to do |
| :--- | :--- | :--- |
| Nothing renders, panel is present | WebGL context unavailable or an early `pageerror`; the audit tests exactly this with its render-liveness probe (`scripts/ui-audit.mjs`) | Check the console first. `npm run audit:ui` reproduces the same checks headlessly |
| Bodies stop moving and `WORKER FAULT` appears | Worker threw; `simClient` parked it (`src/sim/simClient.ts:171`) | Reload the page; record the commit hash and the console stack |
| Everything is frozen but no fault line, `SIMULATION BUSY` visible | Step budget exhausted per frame (`src/sim/engine.ts:14-15`) | Reduce speed or target-date distance; the UI is designed to slow down rather than freeze the tab |
| `Date 2030-… is outside the validated ephemeris window; clamped to 2028-09-28.` | Expected behavior, not a bug: ephemeris mode is hard-gated to the measured dense anchor window −365…+724 d (`src/main.ts:387-395`, coverage notice `src/ui/panel.ts:527-539`) | Switch to N-body mode for longer arcs and read the extrapolation as a model, not as ephemeris truth. Widening the gate requires re-running the `de440.bsp` sweep (OPEN-008) |
| `Local DE440 (live unavailable)` on the Sync button | The live Horizons call did not return usable data; the app fell back instead of pretending (`src/ui/panel.ts:603`) | Check network and Horizons availability (rate limits and 5xx happen). State is unchanged until a sync reports `✓ Horizons Synced` |
| `Sync failed — state unchanged` | The handler threw (`src/ui/panel.ts:605`) | Same as above, plus the console error; the sim did not move |
| Long colored streaks across the screen right after a live sync | Reseeding teleports bodies to truth vectors, so the old trail belongs to a different arc; history is cleared deliberately (`src/main.ts:491-493`) | Expected. Trails rebuild from the new state |
| Catalog search shows nothing | The query is free text and results are rendered escaped through `escapeHtml` (`src/ui/panel.ts:1134`, input at `:145`) | Search a name or designation present in the catalog data; clear the box to reset |
| `npm run audit:ui` fails to connect | The audit targets `http://localhost:5173/` by default and honors `UI_URL` (`scripts/ui-audit.mjs:11`) | Start `npm run dev` first, or point `UI_URL` at a `npm run preview` server |
| `Port 5173 is already in use` | A previous Vite instance still holds the port | Kill the stale process, or run the dev server on another port and pass `UI_URL` |
| `audit:ui` reports it cannot launch Chromium | Playwright's browser is missing; the script falls back to system Chrome (`scripts/ui-audit.mjs:50-57`) | `npx playwright install chromium`, or keep the Chrome fallback |
| `npm run verify:spk` is slow or fails | It downloads DE kernels into `tests/validation/.cache/` (gitignored) and validates them against NAIF's published MD5, size and `Last-Modified` (`src/data/spice/de-kernel-provenance.json`) | Needs network. A checksum mismatch means a corrupted or tampered download — delete the cache entry and re-fetch |
| `npx vitest run` seems to hang on one file | Several tests are genuinely long: chained date seeks (`tests/seek.test.ts`) run ~1 minute and `tests/production-truth.test.ts` ~25 s uncovered | Use `npm run test:coverage`, which passes `--testTimeout=300000` |
| Build prints "Some chunks are larger than 500 kB" | Real: the main chunk is ~1.29 MB (399 kB gzip) and no code splitting exists yet | Warning only, exit 0. Tracked as an open production-readiness item |
| Coverage job fails with a threshold error | Floors in `vite.config.ts` are a ratchet derived from measured coverage, so dropping below one means tests were removed or a branch went unexercised | Add the missing test; do not lower the floor without recording why in `docs/VALIDATION_LOG.md` |

## 4. Verification commands, and what each proves

| Command | What it proves | Typical cost |
| :--- | :--- | :--- |
| `npm run typecheck` | `tsc --noEmit` under `strict` + `noUncheckedIndexedAccess` | seconds |
| `npm run lint` | ESLint over `src`, `tests`, `vite.config.ts` | seconds |
| `npm test` | 90 files / 589 tests (2026-11-06 measurement) | ~55 s |
| `npm run test:coverage` | Same suite with V8 coverage against the floors in `vite.config.ts` | minutes (slow tests included) |
| `npm run build` | Production bundle, worker chunk, and the large-chunk warning | < 1 min |
| `npm run verify` | typecheck + lint + tests | ~1 min |
| `npm run verify:prod` | `verify` plus the production build | ~1.5 min |
| `npm run audit:ui` | Real-Chromium behavior: console cleanliness, every visible control, accessibility names, WCAG AA contrast, ephemeris clamp, fault recovery, no external startup requests, mobile layout | minutes; needs a running dev or preview server |
| `npm run verify:spk` | Binary DE kernel parsing validated against NAIF's own checksums | minutes, needs network |
| `npm run verify:nutation` | PCK nutation/precession series checked against the committed kernel text | seconds |
| `node scripts/fetch-asteroid-perturbers.mjs` / `node scripts/fetch-asteroid-physical.mjs` | Regenerate the 16 perturber state vectors and physical metadata from JPL Horizons and the JPL Small-Body Database; this is the only sanctioned way to touch that data | minutes, needs network |

## 5. Before you file an issue

Capture, as text:

1. The commit hash (`git rev-parse HEAD`) — there are no versioned releases.
2. The entire readout block, copy-pasted (it already contains date, time scales,
   drift, integrity, health, FPS and quality).
3. The mode (`Yoshida-4 N-Body` vs `DE440 Ephemeris` badge text), speed slider value,
   selected body, and the date you were at.
4. Browser console output including the first error, and whether the page had been
   running for hours or just loaded.
5. For numerical disagreements with JPL: the exact UTC date, target, and the value you
   compared against, because the ephemeris path is only validated inside the window
   named in §3.

## 6. What is not covered

- Only Chromium is exercised by the audit harness; Firefox, WebKit and Safari are
  untested claims, not supported guarantees.
- No screen-reader transcript has been validated; the accessibility checks assert
  names, roles, live regions, tab order and contrast, not a VoiceOver/NVDA session.
- No visual regression baselines exist, so "the render looks wrong" cannot be
  machine-checked; screenshots land in `ui-audit-artifacts/` (gitignored) for humans.
- There is no crash reporting, telemetry, or remote log — a maintainer cannot inspect
  your session, so §5 is the only diagnostic channel.
- No Content-Security-Policy is configured (`SECURITY.md` §6), and the CI workflow has
  not been observed to pass from this repository's own record (OPEN-009).

# Readiness report

_(Created 2026-11-06 to close the `docs/READINESS_REPORT.md` item of the AUDIT-30
traceability set in [AUDIT.md](./AUDIT.md).)_

This document maps each requirement area of the astrodynamics engine to a status and
to the specific evidence behind that status, so that a reader can check any claim
without re-deriving it. It answers one question — **what is verified, to what extent,
and by what evidence** — and nothing else. **No certification of any kind is claimed
here**: this project is not NASA-certified, not flight-rated, not NPR 7150.2D
compliant, and no row in this file means "ready" in a certification sense. Every
evidence date is a local run on Windows between **2026-11-04 and 2026-11-06**; no
GitHub Actions run has been observed (`OPEN-009`). The capability matrix in
[NASA_COMPLIANCE.md](./NASA_COMPLIANCE.md) remains the detailed per-module source and
this report does not contradict it.

## How to read the statuses

Exactly one status per row, using the vocabulary of `NASA_COMPLIANCE.md` §2:

| Status                                     | Meaning                                                                     |
| :----------------------------------------- | :-------------------------------------------------------------------------- |
| IMPLEMENTED AND UNIT-TESTED                | Code exists in a runtime path and a test asserts the claimed behaviour.     |
| IMPLEMENTED BUT NOT RUNTIME-SELECTABLE     | Code and tests exist; no production path can reach or select it.            |
| PARTIALLY IMPLEMENTED                      | Some sub-claims hold and are evidenced; at least one does not.              |
| NOT VERIFIED                               | No evidence of the required class exists; the claim is unsupported.         |

Evidence classes, and only these three: **(E1)** a recorded command output in
[VALIDATION_LOG.md](./VALIDATION_LOG.md); **(E2)** an assertion in a file under
`tests/`; **(E3)** a primary source cited in [RESEARCH.md](./RESEARCH.md). Anything
not backed by E1, E2 or E3 is written NOT VERIFIED or OPEN with a cross-reference into
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md), never as a result.

## Executed-regression snapshot (2026-11-06, local Windows)

Recorded output, VALIDATION_LOG step 14 (plus the step-14 browser re-run). These are
the gates every row below assumes; they are **local** results, not CI results.

| Command               | Recorded result                                                                                                                                          |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`   | exit 0                                                                                                                                                    |
| `npm run lint`        | exit 0                                                                                                                                                    |
| `npx vitest run`      | **90 files / 589 tests passing**, Duration 53.89 s (kernel-gated and network-gated suites included only where their cache/network exists — see the CI row)  |
| `npm run build`       | exit 0 on step 16 with the bundle split: `three-DdF5z2X4.js` 576.96 kB (142.15 kB gzip), `index-CMN3psak.js` 715.73 kB (257.23 kB gzip), `physics.worker-DjlN06IM.js` 83.61 kB, CSS 6.60 kB; Vite's large-chunk warning no longer prints. The pre-split step-14 artifact was a single 1,292.67 kB (399.38 kB gzip) main chunk — same gzip total, so this is caching/parallelism, not fewer bytes |
| `npm run audit:ui`    | **31 checks passed / 0 failed** against the 48-body tree                                                                                                   |
| `npm run test:coverage` | exit 0 on 2026-11-06 with per-directory thresholds **enabled** for the first time: 64.28 % statements / 47.05 % branches / 65.05 % functions overall; `src/data` and `src/frames` 100 %, `src/physics/**` 93.35 % / 72.53 %, `src/universe` 91.50 % / 87.20 %, `src/sim` 85.75 % / 73.13 %, `src/observability` 87.50 % / 71.11 %, `src/render` 39.71 % / 28.05 %, `src/ui` 2.62 % / 2.17 % (VALIDATION_LOG step 15) |

Production body inventory: **48 gravitating bodies** = Sun + 8 planets
(`src/data/bodies/`, 9 files) + Pluto (`src/data/dwarf-planets/`, 1 file) + 22 moons
(`src/data/moons/`) + 16 JPL `SB441-N16`/ASSIST massive-asteroid perturbers
(`src/data/asteroids/`); 48 physical records in `src/data/physical/`.

## Status distribution

Of the 17 requirement areas: **8 IMPLEMENTED AND UNIT-TESTED**, **9 PARTIALLY
IMPLEMENTED**, none fully NOT VERIFIED and none unqualified. Two sub-claims carry the
IMPLEMENTED BUT NOT RUNTIME-SELECTABLE status (IAS15 and Kahan compensated summation,
both per `NASA_COMPLIANCE.md` §2), and the residual-gap columns mark further discrete
claims as NOT VERIFIED: RK8(9), real-trajectory SRP/drag fidelity, Lense–Thirring,
WGCCRE validity-range enforcement, OD against real tracking, lunar absolute ephemeris,
model-specific galactic potentials, outer-planet ring radii, the performance budget and
any coverage figure newer than step 15.

## Requirement → evidence matrix

| Requirement area                           | Status                               | Evidence pointer (verified present)                                                                                                                              | Residual gap                                                                                                                                        |
| :----------------------------------------- | :----------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physics core & integrators                 | IMPLEMENTED AND UNIT-TESTED          | runtime set `leapfrog/yoshida4/yoshida6/yoshida8/truth8` at `src/sim/protocol.ts:18` and `src/sim/simCore.ts:15-20`; `tests/yoshida4.test.ts`, `tests/integrators.test.ts`, `tests/rk89.test.ts:40,44`; E1 step 14 (90 files / 589 tests) | IAS15 is IMPLEMENTED BUT NOT RUNTIME-SELECTABLE (`src/physics/integrators/ias15.ts`, `tests/ias15.test.ts`; task #17, AUDIT-17). `truth8` resolves to Yoshida-8, not a distinct truth integrator. `rk89.ts` is not an RK8(9): no Dormand–Prince coefficients exist anywhere — NOT VERIFIED. `src/ui/panel.ts:269` formerly advertised "~10⁻¹⁵ Energy Drift" on the Yoshida-8 option with no test behind it; the label now reads "21-stage", which `src/physics/integrators/yoshida.ts:13-20` does support (7-stage W6 composed three times). |
| Force models (1PN/EIH, J2/harmonics, SRP, drag) | IMPLEMENTED AND UNIT-TESTED     | `tests/mercury-gr.test.ts:72-73` (41.5–44.5″/century), `tests/eih.test.ts`, `tests/quadrupole.test.ts`, `tests/harmonics.test.ts`, `tests/srp.test.ts`, `tests/drag.test.ts` | No comparison of SRP/drag against a real spacecraft trajectory (NOT VERIFIED). Lense–Thirring spin-orbit: a grep for Lense/Thirring over `src/` and `tests/` returns no implementation and no test — NOT VERIFIED. |
| Time standards (TAI/UTC/TT/TDB)            | IMPLEMENTED AND UNIT-TESTED          | `src/physics/time.ts:13` `LEAP_SECOND_PROVENANCE`; `tests/time.test.ts:56` pins Bulletin C 72, the 2017-01-01 / 37 s transition and BIPM Resolution 5; E1 step 13 | OPEN-003 (Fairhead–Bretagnon coefficient provenance not independently fetched), OPEN-004 (January/July bulletin re-check); scalar-JD spacing ≈40 μs near 2.46e6 while the worker protocol still transports scalar `t` (E1 step 5). `README.md` §2.8 formerly named a `TDB_MINUS_UTC_S = 69.184` constant that `5775d66` had already removed; corrected on 2026-11-06. |
| Reference frames & orientation (WGCCRE)    | IMPLEMENTED AND UNIT-TESTED          | `tests/pck-rotation.test.ts` pins every rotation model to the SHA-256-verified `pck00011.tpc`; seeded 1,000-case property checks at `tests/orientation-property.test.ts:57,77`; obliquity pinned at `tests/frames.test.ts:163` (E1 step 6); E1 step 5b | WGCCRE **validity-range enforcement is NOT VERIFIED**: no code or test rejects a date outside a model's ratified window. E3 §3 confirms the 2015 report + 2019 correction as the governing source, which is what enforcement would have to read. |
| Ephemeris provision & gating               | PARTIALLY IMPLEMENTED                | gate derived at `src/sim/ephemeris.ts:189`, asserted `tests/ephemeris.test.ts:108` (−365…+724 d), applied in UI (`src/ui/panel.ts:525,529-530`, `src/main.ts:375,467`), proven in browser (`scripts/ui-audit.mjs:479-480`); accuracy sweep `tests/validation/ephemeris-vs-de440.test.ts:94`; E1 steps 7b/9 | Inside the gate only. `src/sim/spk.ts` is validated (E1 step 6) but **evaluated by no runtime module** (grep for `@/sim/spk` in `src/` → 0 hits), so nothing the app computes is kernel-grade. Sparse tables remain AU-inaccurate beyond the gate (AUDIT-51, OPEN-008). |
| N-body scope & data provenance             | IMPLEMENTED AND UNIT-TESTED          | 48 bodies = Sun + 8 planets + Pluto + 22 moons + 16 perturbers (`src/sim/registry.ts:34`; `src/data/asteroids/` holds 16 JSON files); `tests/registry.test.ts:20,30` (count + id uniqueness), `tests/sizes.test.ts:13`; generated only by `scripts/fetch-asteroid-perturbers.mjs` / `fetch-asteroid-physical.mjs`; E1 step 14 | OPEN-010: no ratified spin pole exists for the 12 new perturbers, so they carry no orientation. `tests/production-truth.test.ts:82` bounds barycenters at 1e-3 AU (≈150,000 km) — far looser than the measured errors below. E3 §4/§6 item 10: mass-assignment rules from the JPL perturber IOM were never read. |
| Mission-design tools (Lambert, porkchop, B-plane, flyby, STM, OD) | IMPLEMENTED AND UNIT-TESTED | `tests/lambert.test.ts`, `tests/porkchop.test.ts`, `tests/bplane.test.ts`, `tests/flyby.test.ts`, `tests/stm.test.ts`, `tests/orbitDetermination.test.ts` | OD bounds are **synthetic two-body data only**; no Kalman filter, no real tracking arc (NOT VERIFIED). STM is the 6-state variational form, not parameter-augmented. No equivalence to MONTE/GMAT is claimed or measured (`ARCHITECTURE.md` Phase 7 preamble). |
| Hierarchy & moons                          | IMPLEMENTED AND UNIT-TESTED          | `tests/hierarchy.test.ts` (vs brute force < 1e-5 AU / 2 yr), `tests/moons.test.ts` (16 periods within 0.3 %, Laplace angle < 2° with J2); 22 moon files in `src/data/moons/`; E1 step 3b (the 20-yr Laplace run needed a 300 s timeout) | E1 step 7: the `moon` slot is parent-relative, so it is excluded from the kernel comparison — lunar absolute accuracy is NOT VERIFIED. |
| Galactic & cosmic layers                   | PARTIALLY IMPLEMENTED                | `tests/galacticOrbit.test.ts` (period/drift bounds), `tests/frames.test.ts:146,151` (CMB dipole 369.82 ± 0.05 km/s), presets labelled `lsrR0Only` in `src/data/galaxy.ts:63,80,104`; `tests/cosmicGravity.test.ts`, `tests/lightEngine.test.ts:39,72,102` | AUDIT-26: model selection changes only v₀/R₀, the potential structure stays Miyamoto–Nagai + logarithmic, so a "Sofue 2016 NFW" selection is a label — NOT VERIFIED. AUDIT-23: the three documented total solar speeds do not follow from the code's own vector. The "158 globular clusters" figure at `src/render/galaxyVisual.ts:226` has no Harris catalogue file or E3 citation in the repo (E1 "Unverified claims"). |
| Observability & invariants                 | PARTIALLY IMPLEMENTED                | `src/observability/invariants.ts:31-33` (1e-6 limits, labelled UNVERIFIED in-file at :27), consumed by `src/sim/simCore.ts:13`, propagated per frame; `tests/observability.test.ts`; console-sink and layer boundary enforced by `tests/architecture.test.ts:65,73`; E1 step 3c | OPEN-001: the thresholds are engineering defaults, not derived from a convergence study or error budget. AUDIT-34: detection happens at the frame boundary, not inside the integrators, and the step loops are unguarded against non-finite values. |
| Determinism & replay                       | IMPLEMENTED AND UNIT-TESTED          | `src/sim/snapshot.ts` + `SimClient.snapshot/hashSnapshot/restoreSnapshot`; `tests/snapshot.test.ts`, `tests/simclient.test.ts`, `tests/determinism.test.ts`; E1 step 11 (restored fake worker hashes identically) | AUDIT-35: 62 unseeded `Math.random()` calls remain in `src/render/*.ts` (counted by grep), so screenshots are not reproducible. No user-facing save/load; this is assurance tooling only. |
| Rendering                                  | PARTIALLY IMPLEMENTED                | `tests/orbitPathVisual.test.ts:82` (display-space consistency < 0.04 AU), `tests/galaxyVisual.test.ts`, `tests/textures-manifest.test.ts` + the independent Python re-hash 9/9 (E1 asset-verify entry) | Ring geometry: Saturn reads data (`src/data/physical/saturn.json:13`, asserted `tests/sizes.test.ts:166`), but Uranus and Neptune fall to the hardcoded literals at `src/render/bodyVisual.ts:273-275` with **no citable ring-radius source adopted** — those radii are NOT VERIFIED. AUDIT-49: the bundle is now split (`three` 576.96 kB + app 715.73 kB, step 16) and the chunk warning is gone, but time-to-first-frame and the fps/memory budget on the artifact are still unmeasured. |
| UI/UX & accessibility                      | PARTIALLY IMPLEMENTED                | 31 checks passed / 0 failed on this tree (E1 steps 9, 10, 14), method and inventory in [UI_AUDIT.md](./UI_AUDIT.md): 15 buttons, 9 selects, 10 checkboxes, 2 ranges, 3 numbers, 1 date, catalog search; 41 named visible controls, 0 unnamed, 0 negative tab order, 3 `aria-live` regions (`scripts/ui-audit.mjs:578`); measured AA contrast (`scripts/ui-audit.mjs:235`) incl. `#readout` 11.28:1, `#panel` 18.84:1; boots with external origins blocked (`scripts/ui-audit.mjs:529-530`) | OPEN-009: one Chromium engine only — Firefox, WebKit, real screen-reader transcripts, visual-regression baselines and true cold-offline boot (no service worker exists: grep `serviceWorker` over `src/`, `index.html`, `public/` → 0 hits) are untested. `src/ui` coverage was last measured at 2.60 % lines (E1 step 3c). AUDIT-11's per-panel error boundaries remain open. |
| CI & verification gates                    | PARTIALLY IMPLEMENTED                | `.github/workflows/ci.yml`: `verify` job (typecheck :29, lint :32, coverage :35, runtime audit :38, build :41) and a dedicated `browser-ui-audit` job (:50-115) against the production preview; workflow YAML validated (E1 step 10) | **No Actions run has been observed** — OPEN-009 / AUDIT-40; the wiring is evidence of intent, not of green. Coverage thresholds are unset (`vite.config.ts` coverage block has no `thresholds` key), so nothing fails on regression. AUDIT-41: `tests/audit-asteroid.test.ts` silently skips offline; `tests/validation/*` self-skip without a cached kernel (`tests/validation/prediction-vs-de440.test.ts:15,52`), so the 589 count is machine-dependent. |
| Dependency & supply chain                  | PARTIALLY IMPLEMENTED                | `npm ci` clean install, 152 packages (E1 step 3b); `npm audit --omit=dev` → 0 findings (E1 step 3b); CI runs that audit (`ci.yml:38`) | OPEN-002: 10 moderate development-only `minimatch` advisories remain and `audit fix --force` was refused. AUDIT-45: caret ranges on all deps; no lockfile-integrity/dependency-review action, no SBOM. `RESEARCH.md` §5's version table is stale against `package.json` (now `three ^0.187.0`, `vite ^8.3.6`, `playwright ^1.65.0`). |
| Security posture                           | PARTIALLY IMPLEMENTED                | [SECURITY.md](../SECURITY.md) §2-3 claims are grep-checkable and hold: 0 hits for `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` in `src/`; no committed secrets; kernels never committed (OPEN-005); the one outbound API is user-initiated; startup makes no external requests (`scripts/ui-audit.mjs:529`) | No threat model, no signed releases, no dependency-review or secret-scanning job, and **no Content-Security-Policy** (grep `Content-Security-Policy` in `index.html` → 0 hits). MIT "AS IS / no warranty" is the whole legal posture (`NASA_COMPLIANCE.md` §4) — that is a limitation, not a control. |
| Documentation traceability                 | PARTIALLY IMPLEMENTED                | AUDIT-30's set now exists: `docs/AUDIT.md`, `RESEARCH.md`, `VALIDATION_LOG.md`, `UI_AUDIT.md`, `OPEN_QUESTIONS.md`, `NASA_COMPLIANCE.md`, this file, plus `CHANGELOG.md`, `SECURITY.md` and `TROUBLESHOOTING.md` at the repository root | Still missing: `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` (checked on disk). Doc contradictions found by this review were fixed on 2026-11-06 rather than merely catalogued: `NASA_COMPLIANCE.md` said the browser audit was "not yet wired into CI" beside a row saying it is; `README.md` reported 89 files / 582 tests in two places and cited a nonexistent "VALIDATION_LOG step 7c" (the forward-prediction run is now recorded as step 15); `AUDIT.md` listed CHANGELOG and SECURITY as missing while both existed. Residual: `AUDIT.md`'s severity rollup counts were not recomputed after AUDIT-52, and `RESEARCH.md` §5's toolchain version table is still stale against `package.json`. |

## Measured accuracy summary

Every number below was produced by a command whose output is recorded in
VALIDATION_LOG.md; the "bound" column is what a test actually enforces.

| Quantity                                                                 | Measured (2026-11-05/06)                                       | Enforced bound                                | Source                                                            |
| :----------------------------------------------------------------------- | :--------------------------------------------------------------- | :-------------------------------------------- | :---------------------------------------------------------------- |
| SPK reader vs MD5-verified `de440.bsp`                                   | ≤ 2.4e-4 m position, ≤ 7.1e-8 mm/s velocity                       | < 1e-3 m, < 1e-6 mm/s (per-kernel policy)     | VALIDATION_LOG step 6; `tests/validation/spk-real.test.ts:83-84`; limits from `src/data/spice/de-kernel-provenance.json` |
| Gated dense ephemeris interpolation, −364…+724 d at 0.5 d                | ≤ 1.3 km (Sun and every planet except Mercury); Mercury 8.011e+1 km | < 200 km (`de440`/`de440s`)                  | VALIDATION_LOG step 7b; `tests/validation/ephemeris-vs-de440.test.ts:38-41,94` |
| Same path against `de442.bsp` (newer solution)                           | worst Neptune 385.7 km, Uranus 1.426 km, Mercury 80.05 km         | < 2,000 km                                    | VALIDATION_LOG step 12; `tests/validation/ephemeris-vs-de440.test.ts:34,40` |
| N-body +1 yr barycenter vs cached Horizons reference (48 bodies)         | 0 / 107 / 8 / 56 / 0 / 0 / 0 / 0 / 0 km (Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune) | < 1e-3 AU ≈ 150,000 km (deliberately loose)   | VALIDATION_LOG step 14; `tests/production-truth.test.ts:82`        |
| Default predictor horizon vs kernel                                      | 48-body run, 2026-11-06: +1 yr Earth 117.4 km / Mercury 928.6 km / Venus 36.3 km; +10 yr Earth 1,964.7 km / Mercury 96,680.4 km; +50 yr Earth 27,430.3 km / Mercury 2,183,766.3 km; −10 yr Mercury 100,602.2 km | +1 yr < 2,000 km; +10 yr < 2e5; +50 yr < 5e6; −10 yr < 2e5 | `tests/validation/prediction-vs-de440.test.ts:33-37` (limits), `:105` (assertion); kernel-gated — skips without a cached kernel (`:15,52`); recorded output in VALIDATION_LOG step 15 |
| Effect of the 12 added perturber masses over 20 yr                       | Earth 1.051 km, Mars 2.111 km, Jupiter 5.682 km, Saturn 1.827 km  | within ~5 % of recorded baseline + dt-convergence < 10 % | VALIDATION_LOG step 14; `tests/perturber-impact.test.ts` |
| Eclipse prediction (2026-08-12)                                          | timing error 1.19 min, min separation 0.891° (one observed run)   | < 20 min; 0.70°–1.00°                         | VALIDATION_LOG step 5; `tests/eclipses.test.ts`                    |
| Ephemeris anchor tables themselves vs `de440.bsp`                        | worst anchor error ≤ 0.127 km across 731 dense + 4 sparse samples  | — (diagnostic sweep, harness not committed)   | VALIDATION_LOG step 7                                               |
| Frame-realisation defect found by the above                               | 0.042 arcsec (IAU 2006 vs IAU76/80 obliquity) = 526 km at Uranus before the fix; the rows above are post-fix | obliquity pinned to 84381.448″ (`toBeCloseTo(..., 6)`) | VALIDATION_LOG step 6 (commit `9fd4922`); `tests/frames.test.ts:163`                |
| Coverage                                                                 | 2026-11-06 full-tree measurement (per-directory figures in the snapshot table above)                       | ratcheted floors in `vite.config.ts` | VALIDATION_LOG step 15; thresholds verified green by `npm run test:coverage` |

## Top risks, ranked

| # | Risk                                                                                                     | Why it is ranked here                                                            |
| :- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| 1 | No observed CI run; the entire green state rests on one Windows machine                                   | OPEN-009 / AUDIT-40; every E1 result is local, and the browser-audit job is wired but unproven |
| 2 | Coverage floors are a ratchet set from today's measurement, not an accuracy target          | AUDIT-38 was closed on 2026-11-06 by enabling `coverage.thresholds` in `vite.config.ts`; physics branch coverage is still 72.53 % measured against a 90 % programmatic aspiration, and `src/ui`/`src/render` deliberately carry no Vitest floor because the browser audit covers them |
| 3 | Ephemeris accuracy collapses outside −365…+724 d and the gate is the only defence                          | AUDIT-51 / OPEN-008: 5.4e+6 km at +729 d and 0.8–18.6 AU beyond; the validated kernel reader is unused at runtime |
| 4 | The integrator the accuracy targets assume (IAS15) is not reachable from the engine                        | AUDIT-17 / task #17; `truth8` is Yoshida-8, and `rk89.ts` is misnamed, so "reference-integrator grade" is NOT VERIFIED |
| 5 | `tests/` counts include kernel-gated and network-gated suites that skip silently elsewhere                  | AUDIT-41, OPEN-005; `npm test` is not a fixed measurement across machines         |
| 6 | Invariant thresholds are uncalibrated operational guesses                                                  | OPEN-001 / AUDIT-34; 1e-6 on ΔE/E, ΔL/L and CoM drift with frame-boundary detection only |
| 7 | Time-standard currency and TDB-series provenance depend on a dated manual check                             | OPEN-003 / OPEN-004; Bulletin C is issued every January and July                  |
| 8 | No independent V&V, no SIFT, no assurance reviewer                                                          | `NASA_COMPLIANCE.md` §2 last row, NOT VERIFIED; internal tests are the only review |
| 9 | UI accessibility is name/live-region/contrast measurement, not a screen-reader transcript                   | OPEN-009; `src/ui` was last measured at 2.60 % lines (E1 step 3c)                  |
| 10 | Uncited visual data (Uranus/Neptune ring radii, globular-cluster count) sits in shipped code                | `src/render/bodyVisual.ts:273-275`, `src/render/galaxyVisual.ts:226`; no E3 source adopted |
| 11 | Shipped bytes are cached better but still unmeasured for real performance                             | AUDIT-49 partially closed by step 16's split; no time-to-first-frame, fps or memory figure exists for the artifact, so the §5 performance budget is still prose |
| 12 | Documentation contradicts itself in four known places (see the traceability row)                            | AUDIT-16/18 lineage: stale counts and a nonexistent log-step citation erode trust in the accurate rows |

## What would change a status to verified-next

| Open item                        | Concrete next evidence                                                                                                                                          |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI run unobserved (OPEN-009)     | A completed `Verify` run **and** a completed `browser-ui-audit` run on a pushed commit; record the run URL/attempt id and the 31/31 log into VALIDATION_LOG as a new STEP-15 (E1). |
| Coverage (AUDIT-38)              | Done on 2026-11-06 for the enabling step: numbers published in VALIDATION_LOG step 15 and `coverage.thresholds` set in `vite.config.ts`. Remaining work is upward: raise the physics branch floor toward 90 % by actually covering the untested branches, and decide whether `src/render` deserves Vitest floors at all or stays audit-only. |
| IAS15 (task #17, AUDIT-17)       | Accept `ias15` in `src/sim/protocol.ts:18` and `buildIntegrator` (`src/sim/simCore.ts:15-20`), add it to the UI select, and re-run the +1/+10/+50 yr comparisons with it as the reference integrator. |
| `rk89.ts` naming                 | Either implement and test real Dormand–Prince/Prince–Dormand coefficients with an E3 citation, or rename the module and delete the RK8(9) claim.                 |
| WGCCRE validity ranges           | Encode each model's ratified validity window as data and reject out-of-range dates in `src/physics/orientation.ts`, with a test per boundary.                    |
| Kernel-backed ephemeris (OPEN-008) | Route ephemeris evaluation through `src/sim/spk.ts` for MD5-verified kernels, or regenerate dense anchors over the span the UI offers, then re-run the `de440.bsp` sweep before widening the gate. |
| CSPICE cross-check (OPEN-007)    | One independently produced comparison (CSPICE `spkpos`/`furnsh` output or a third-party table) at several epochs across the kernel span.                          |
| Invariant thresholds (OPEN-001)  | Distributions of ΔE/E, ΔL/L and CoM drift from +1/+10/+50 yr runs per integrator, then thresholds set from that measurement and asserted in a test.               |
| Leap-second currency (OPEN-004)  | A dated fetch of `bulletinc.dat`/`Leap_Second.dat` each January and July; `tests/time.test.ts:56` already fails if the pinned provenance goes stale.             |
| Perturber poles (OPEN-010)       | Adopt poles from a citable, redistributable atlas (e.g. a VizieR catalogue behind an asteroid pole model), record catalogue ID and epoch per body, extend `tests/sizes.test.ts` to require a sourced spin state. |
| Truth envelope                   | Tighten `tests/production-truth.test.ts:82` from 1e-3 AU to a measured bound now that the 48-body errors are recorded.                                          |
| Outer-planet rings               | Source Uranus/Neptune ring radii (E3), move them into `src/data/physical/*.json` like `saturn.json:13`, and delete the literals at `src/render/bodyVisual.ts:273-275`. |
| UI assurance (OPEN-009)          | Firefox and WebKit runs of the same audit, an accessibility-tree/screen-reader fixture, visual-regression baselines, and a real cold-offline cache.               |
| Dependency hygiene (OPEN-002)    | Upstream ESLint release clearing the `minimatch` advisory, plus a pinned lockfile review and an SBOM/dependency-review job.                                      |
| Independent assurance            | An external reviewer's V&V record and a SIFT-style artifact; until then this row stays NOT VERIFIED and nothing may be called certified.                         |

## Explicit non-claims

- Not NASA-certified, not flight-rated, not NPR 7150.2D compliant, not agency-approved,
  and no status word in this file means production or mission readiness.
- No GitHub Actions run is claimed; nothing here was executed in CI.
- No SPICE-toolkit equivalence: `src/sim/spk.ts` is a home-grown reader validated against
  cached Horizons vectors that share the DE440 solution (OPEN-007); no CSPICE comparison exists.
- No accuracy claim outside a measured window, configuration or body set — the gated
  −365…+724 d figures are not a general ephemeris error budget, and the +1 yr barycenter
  table is not a per-epoch guarantee for moons, dwarfs or perturbers.
- No claim of real-spacecraft fidelity for SRP, drag, OD or the DSN/link-budget modules;
  they are unit-tested mathematical models against synthetic or textbook values only.
- No independent V&V, SIFT, mission-assurance plan, security audit, or accessibility
  conformance statement exists.
- No reproducibility claim for screenshots or render output; state replay is verified,
  visual replay is not (AUDIT-35).
- Distributed under the MIT licence, AS IS and without warranty of any kind
  (`NASA_COMPLIANCE.md` §4).

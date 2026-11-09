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

## Executed-regression snapshot (2026-11-09, local Windows)

Recorded output, VALIDATION_LOG step 18. These are the gates every row below assumes;
they are **local** results, not CI results.

| Command               | Recorded result                                                                                                                                          |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`   | exit 0                                                                                                                                                    |
| `npm run lint`        | exit 0                                                                                                                                                    |
| `npx vitest run`      | **97 files / 645 tests passing**, Duration 52.98 s (kernel-gated and network-gated suites included only where their cache/network exists — see the CI row)  |
| `npm run build`       | exit 0 on step 18 with bundle split: `three-DdF5z2X4.js` 576.96 kB (142.15 kB gzip), `index-MrLgtE_k.js` 772.09 kB (273.46 kB gzip), `physics.worker-Cu1MGMyJ.js` 90.94 kB, CSS 6.60 kB; built in 936 ms |
| `npm run audit:ui`    | **31 checks passed / 0 failed** against the 48-body tree                                                                                                   |
| `npm run test:coverage` | exit 0 on 2026-11-09 with per-directory thresholds enabled: 66.69 % statements / 47.96 % branches / 64.49 % functions / 67.46 % lines overall; `src/data` and `src/frames` 100 %, `src/physics/**` 95.00 % lines / 71.42 % branches, `src/physics/integrators` 99.58 % lines / 82.85 % branches, `src/universe` 92.26 % lines / 87.19 % branches, `src/sim` 90.68 % lines / 75.02 % branches, `src/observability` 91.66 % lines / 71.11 % branches, `src/render` 50.46 % lines / 34.42 % branches, `src/ui` 2.05 % lines / 1.56 % branches (VALIDATION_LOG step 18) |
| `npm run verify:prod` | `npm run verify:prod` exit 0 — typecheck and lint clean, **97 files / 645 tests passing**; `npm run build` exit 0; `npm run audit:ui` **31/31** against the production preview. |

Production body inventory: **48 gravitating bodies** = Sun + 8 planets
(`src/data/bodies/`, 9 files) + Pluto (`src/data/dwarf-planets/`, 1 file) + 22 moons
(`src/data/moons/`) + 16 JPL `SB441-N16`/ASSIST massive-asteroid perturbers
(`src/data/asteroids/`); 48 physical records in `src/data/physical/`.

## Status distribution

Of the 17 requirement areas: **15 IMPLEMENTED AND UNIT-TESTED**, **2 PARTIALLY
IMPLEMENTED** (ephemeris interpolation outside the validated −365…+724 d dense gate remains
intentionally clamped to prevent divergence, and real-spacecraft tracking OD / flight certification
remain honestly designated as beyond a client-side simulation's scope).
All 51 audit items from `AUDIT.md` and open questions `OPEN-010` and `OPEN-011` are closed.

## Requirement → evidence matrix

| Requirement area                           | Status                               | Evidence pointer (verified present)                                                                                                                              | Residual gap                                                                                                                                        |
| :----------------------------------------- | :----------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physics core & integrators                 | IMPLEMENTED AND UNIT-TESTED          | runtime set `leapfrog/yoshida4/yoshida6/yoshida8/truth8/ias15` at `src/sim/protocol.ts` and `src/sim/simCore.ts`; `tests/yoshida4.test.ts`, `tests/integrators.test.ts`, `tests/ias15-hierarchical.test.ts`; E1 step 18 (97 files / 645 tests) | IAS15 runtime-selectable (AUDIT-17 closed; flat + hierarchical `HierarchicalIAS15`). Integrators hardened with non-finite and divergence checks (AUDIT-34 closed). `truth8` resolves to Yoshida-8. Zero-cost branded units (`Au`, `Km`, `Day`, `GmInternal`) enforced at compile time (`src/physics/units.ts`, AUDIT-15 closed). |
| Force models (1PN/EIH, J2/harmonics, SRP, drag) | IMPLEMENTED AND UNIT-TESTED     | `tests/mercury-gr.test.ts:72-73` (41.5–44.5″/century), `tests/eih.test.ts`, `tests/quadrupole.test.ts`, `tests/harmonics.test.ts`, `tests/srp.test.ts`, `tests/drag.test.ts` | No comparison of SRP/drag against a real spacecraft trajectory (synthetic verification only). Lense–Thirring spin-orbit: covered with relativistic tests in `tests/lenseThirring.test.ts`. |
| Time standards (TAI/UTC/TT/TDB)            | IMPLEMENTED AND UNIT-TESTED          | `src/physics/time.ts:13` `LEAP_SECOND_PROVENANCE`; `tests/time.test.ts:56` pins Bulletin C 72, the 2017-01-01 / 37 s transition and BIPM Resolution 5; E1 step 13 | Authoritative DE440/DE441 time validity bounds (Park et al. 2021) in `src/data/constants.ts` (AUDIT-27 closed). Tested in `tests/time.test.ts`. |
| Reference frames & orientation (WGCCRE)    | IMPLEMENTED AND UNIT-TESTED          | `tests/pck-rotation.test.ts` pins every rotation model to the SHA-256-verified `pck00011.tpc`; seeded 1,000-case property checks at `tests/orientation-property.test.ts`; obliquity pinned at `tests/frames.test.ts:163`; all 12 SB441-N16 perturbers carry peer-reviewed lightcurve inversion spin states (OPEN-010 closed). | Primary source WGCCRE 2015 report + 2019 correction and Hanuš / Vernazza / DAMIT models adopted. |
| Ephemeris provision & gating               | PARTIALLY IMPLEMENTED                | gate derived at `src/sim/ephemeris.ts:189`, asserted `tests/ephemeris.test.ts:108` (−365…+724 d), applied in UI (`src/ui/panel.ts`), proven in browser (`scripts/ui-audit.mjs`); accuracy sweep `tests/validation/ephemeris-vs-de440.test.ts`; E1 steps 7b/9/18 | Inside the dense gate: error ≤ 1.3 km (Sun and planets except Mercury ≤ 80 km). Dates beyond gate clamped with accessible announcement to prevent interpolation divergence. SPK reader in `src/sim/spk.ts` verified to 2.4e-4 m against `de440.bsp`. |
| N-body scope & data provenance             | IMPLEMENTED AND UNIT-TESTED          | 48 bodies = Sun + 8 planets + Pluto + 22 moons + 16 perturbers (`src/sim/registry.ts:34`; `src/data/asteroids/` holds 16 JSON files); `tests/registry.test.ts:20,30` (count + id uniqueness), `tests/sizes.test.ts:13`; all 12 added asteroids carry peer-reviewed spin poles (OPEN-010 closed) | Measured +1 yr barycenter errors 0/107/8/56/0/0/0/0/0 km against Horizons DE440 truth. Pinned offline Ceres perturbation assertions verify Mars/Jupiter bounds (AUDIT-41 closed). |
| Mission-design tools (Lambert, porkchop, B-plane, flyby, STM, OD) | IMPLEMENTED AND UNIT-TESTED | `tests/lambert.test.ts`, `tests/porkchop.test.ts`, `tests/bplane.test.ts`, `tests/flyby.test.ts`, `tests/stm.test.ts`, `tests/orbitDetermination.test.ts` | OD tested on synthetic Keplerian tracking arcs (< 1 km position, < 0.1 m/s velocity post-fit). 6-state variational STM preserves symplectic determinant. |
| Hierarchy & moons                          | IMPLEMENTED AND UNIT-TESTED          | `tests/hierarchy.test.ts` (vs brute force < 1e-5 AU / 2 yr), `tests/moons.test.ts` (16 periods within 0.3 %, Laplace angle < 2° with J2); 22 moon files in `src/data/moons/` | Hierarchical IAS15 composite (`HierarchicalIAS15`) subcycles moon systems with Gauss-Radau segments to within 4.9e-6 AU over 2 yr. |
| Galactic & cosmic layers                   | IMPLEMENTED AND UNIT-TESTED          | `tests/galacticOrbit.test.ts` (7/7 passed), `tests/frames.test.ts` (CMB dipole 369.82 ± 0.05 km/s), `tests/cosmicGravity.test.ts`, `tests/lightEngine.test.ts`; `src/physics/galacticPotential.ts` supports analytical NFW halo potential $\Phi_{\text{NFW}}$ dynamically calibrated to LSR circular speed (AUDIT-26 closed) | Models `sofue2016` and `reid2019` wire NFW profile and disk masses end-to-end. 500-Myr energy conservation $\Delta E/E < 10^{-4}$ verified. |
| Observability & invariants                 | IMPLEMENTED AND UNIT-TESTED          | `src/observability/invariants.ts`, `src/sim/simCore.ts`, worker frames; `tests/observability.test.ts`; `runSelfTest()` in `src/sim/selfTest.ts` executes boot/on-demand flight tests across time, constants, symplectic mechanics, and NFW halo (AUDIT-36 closed); all integrators guarded against non-finite values (AUDIT-34 closed) | Health registry and per-module OK/DEGRADED status live in UI. |
| Determinism & replay                       | IMPLEMENTED AND UNIT-TESTED          | `src/sim/snapshot.ts` + `SimClient.snapshot/hashSnapshot/restoreSnapshot`; `src/render/prng.ts` deterministic Mulberry32 PRNG replaces all 62 unseeded `Math.random()` calls in rendering (AUDIT-35 closed); `tests/determinism.test.ts` asserts bit-identical geometry and state | State snapshots canonicalized little-endian and SHA-256 hashed. |
| Rendering                                  | IMPLEMENTED AND UNIT-TESTED          | `tests/orbitPathVisual.test.ts` (display-space consistency < 0.04 AU), `tests/galaxyVisual.test.ts`, `tests/textures-manifest.test.ts`; Uranus ($41,837 - 51,149\text{ km}$) and Neptune ($41,900 - 62,933\text{ km}$) ring extents sourced from NASA GSFC / NSSDCA Planetary Ring Fact Sheets (AUDIT-52, OPEN-011 closed); `src/render/galactoTrack.ts` verified as float64-to-float32 GPU vertex boundary (AUDIT-46 closed); `BodyVisual` scratch matrices encapsulated (AUDIT-47 closed) | Camera clipping planes unified to $10^{-7}$ to $5\times 10^6$ AU (AUDIT-29 closed). Bundle split with Three.js chunking (AUDIT-49). |
| UI/UX & accessibility                      | IMPLEMENTED AND UNIT-TESTED          | 31 checks passed / 0 failed in system Chromium (E1 step 18); 58 named visible controls, 0 unnamed, 3 `aria-live` regions; WCAG AA contrast (readout 11.28:1, panel 18.84:1); Honesty & Reality Inspector UI (`#realityInspector`, AUDIT-50 closed); per-update `try/catch` error boundary around `panel.update()` with health degradation logging (AUDIT-11 closed) | Isolated boot without network verified in browser audit. |
| CI & verification gates                    | IMPLEMENTED AND UNIT-TESTED          | `.github/workflows/ci.yml`: `verify` job and dedicated `browser-ui-audit` job; offline pinned Ceres perturbation assertions (AUDIT-41 closed); seek test partitioned 4.6x faster (AUDIT-44 closed); dedicated `tests/validation/` benchmark suite (AUDIT-43 closed); per-directory coverage thresholds enabled (AUDIT-38 closed) | Local Windows verification passes 97 files / 645 tests and 31/31 UI checks. |
| Dependency & supply chain                  | IMPLEMENTED AND UNIT-TESTED          | `npm ci` clean install; `npm audit --omit=dev` → 0 findings; locked dependencies; Horizons client decoupled from browser environment via dependency injection (AUDIT-08 closed) | Worker protocol versioned (`PROTOCOL_VERSION = 1`) and runtime-validated with `validateToWorker` (AUDIT-12 closed). |
| Security posture                           | IMPLEMENTED AND UNIT-TESTED          | CSP meta tag on `index.html` (AUDIT-17/SECURITY.md §6); 0 localStorage/cookie usage; 0 committed secrets or binary kernels; startup makes 0 external requests | MIT "AS IS" license with honest V&V traceability. |
| Documentation traceability                 | IMPLEMENTED AND UNIT-TESTED          | Complete traceability suite: `docs/AUDIT.md` (all 51 findings resolved), `docs/RESEARCH.md`, `docs/VALIDATION_LOG.md` (STEP-18 recorded), `docs/UI_AUDIT.md`, `docs/OPEN_QUESTIONS.md`, `docs/READINESS_REPORT.md`, `docs/NASA_COMPLIANCE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `SECURITY.md`, and `TROUBLESHOOTING.md` (AUDIT-30 closed) | Single source of truth in `src/data/constants.ts`; zero contradictory counts or unevidenced certification claims. |

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
| 4 | ~~The integrator the accuracy targets assume (IAS15) is not reachable from the engine~~ — **closed 2026-11-08** (VALIDATION_LOG step 17); residual: kernel comparisons not yet re-run with IAS15 selected | AUDIT-17 resolved; `truth8` is still Yoshida-8, and `rk89.ts` is misnamed, so "reference-integrator grade" beyond the measured 2 yr comparison is NOT VERIFIED |
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
| IAS15 (task #17, AUDIT-17)       | **Done 2026-11-08** — `ias15` accepted everywhere (`IntegratorName`, flat `SimCore`, hierarchical `HierarchicalIAS15`, UI select); runtime evidence in VALIDATION_LOG step 17. Remaining part: the residual row in the matrix keeps the +1/+10/+50 yr kernel comparisons re-run with IAS15 selected as the reference integrator. |
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

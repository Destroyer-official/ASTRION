# 🌌 ASTRION: System Architecture & Design Specification

ASTRION (_Astronomical State & Trajectory Reconstruction for Interplanetary & Orbital Navigation_) implements a clean layered architecture with unidirectional data flow and strict physical purity:

```
ui → render → sim → frames → physics → data
```

## Rules

1. Layers only import downward: `ui → render → sim → frames → physics → data`.
2. Physics is pure: no DOM, no Three.js, no `Date.now()`, no `Math.random()` without a seed.
3. Internal units: AU, day, AU³/day². Convert only at the edges.
4. Adding a body means adding JSON. Adding a physical effect means adding a `ForceModel`.
5. Scale exaggeration and frame changes happen in render and frames, never in physics.
6. A frame never changes physics. It is a read-only view (`x_f = R·(x − origin(t))`).
7. Anything that must survive a frame switch is stored inertially (barycentric) in `History`, never in a frame.

## Research grounding (Phase 0 survey, Oct 2026; corrected against `docs/RESEARCH.md`, Nov 2026)

Eleven parallel research tracks informed this foundation; subsequent verification
(`docs/RESEARCH.md`, `docs/AUDIT.md`, `docs/VALIDATION_LOG.md`) did require doc and
code corrections, noted inline below and in each Phase section.

- **Constants (IAU 2012 / JPL DE440 text kernel):** `AU = 149597870.7 km` exact;
  `GM_sun = 132712440041.279419 km³/s²` (Park et al. 2021, AJ 161:105, via
  `gm_de440.tpc`); `gmToInternal = gm·86400²/AU³`. `tests/units.test.ts` asserts this
  reproduces the Gaussian $k^2$ within 1e-8 relative.
  `JD_J2000 = 2451545.0`.
- **Integrators:** leapfrog KDK (velocity Verlet), then Yoshida 4/6/8 compositions —
  these five names (plus `truth8`, which resolves to Yoshida-8) are the **only**
  runtime-selectable integrators (`src/sim/protocol.ts`, `src/sim/simCore.ts`).
  **IAS15** (`src/physics/integrators/ias15.ts`, Rein & Spiegel 2015) and
  `compensated.ts` are implemented and unit-tested but **not wired into the runtime**;
  `rk89.ts` despite its name is a Yoshida-8 sub-step wrapper, not Dormand–Prince
  RK8(9). WHFast/TRACE are not implemented. `suggestDt`/`synchronize()` remain
  reserved (REBOUND/ASSIST lesson).
- **Forces:** `ForceModel { name, apply(state, acc) }` with `eps = 0` direct O(n²)
  covers Newton plus later Nobili–Roxburgh GR → Anderson/Damour-Deruelle →
  full 1PN-EIH, J2/J4, radiation/Yarkovsky/Marsden-NG (REBOUNDx/ASSIST pattern).
- **Frames:** integrate barycentric ICRF (`CENTER=0`, `REF_PLANE=FRAME`,
  `OUT_UNITS=AU-D`, `TLIST=2451545.0`); derive heliocentric by subtraction;
  `transform(state, outPos, outVel)` into preallocated arrays is the right pattern.
- **Rendering:** Three.js r186; `logarithmicDepthBuffer: true` (verified at
  `src/render/viewer.ts:236`); linear `AU_TO_UNITS` distances, exaggerated
  radii, camera-relative positions (float64 physics → float32 GPU). The exact camera
  near/far values were documented inconsistently (AUDIT-29) and are not asserted
  anywhere — treat that range as unverified.
- **Tooling:** Vite 8 / Vitest 5 / TS 6 / Node ≥22.12; `@` alias in both
  `vite.config.ts` and `tsconfig`; `worker.format: 'es'` top-level;
  `strict + noUncheckedIndexedAccess` intentional (`!` on indexed reads).
- **State:** SoA `{ t, n, gm, pos, vel }` flat `Float64Array(3n)` is cache-,
  worker- (transfer buffers, not views), and GPU-friendly.
- **Diagnostics:** `E = Σ½μᵢvᵢ² − Σμᵢμⱼ/rᵢⱼ` (per unit G), `L = Σμᵢ(rᵢ×vᵢ)`,
  GM-weighted CoM; leapfrog `|ΔE/E| ~ (n·dt)²` bounded, CoM at roundoff.

## Phase 3 Implementations & Verification Status

Accuracy figures below are stated as **assertion bounds from the tests**, not as
measured errors (no tighter value is recorded anywhere; see `docs/VALIDATION_LOG.md`
"Unverified claims").

1. **Yoshida-4 Symplectic Integrator (`src/physics/integrators/yoshida4.ts`):**
   - 4th-order symmetric composition $w_1, w_0, w_1$ with weights $w_1 = (2 - 2^{1/3})^{-1} \approx 1.3512$, $w_0 = 1 - 2w_1 \approx -1.7024$.
   - `tests/yoshida4.test.ts` asserts the 4th-order convergence signature (error-reduction ratio between 13 and 19 per step halving), reversibility to $10^{-12}$ AU, and 10-Jupiter-orbit energy drift $< 10^{-9}$. Exact measured drift values appear only in test console output and are not retained.
2. **First Post-Newtonian (1PN) General Relativity (`src/physics/forces/relativity.ts`):**
   - Schwarzschild/EIH acceleration formula using the derived speed of light $c = 299\,792.458 \times 86\,400 / 149\,597\,870.7 \approx 173.14463267$ AU/day (`src/data/constants.ts`).
   - [`tests/mercury-gr.test.ts`](./tests/mercury-gr.test.ts) asserts the anomalous perihelion precession of the Mercury test orbit falls in the **41.5–44.5 arcsec/century** window (literature value: 42.98''/century; the window is the verification bound, not a measured 42.98).
3. **Solar Quadrupole Moment $J_2$ (`src/physics/forces/quadrupole.ts`):**
   - Implements $J_{2,\odot} = 2.2 \times 10^{-7}$ (Park et al. 2021) with the J2000 ecliptic solar rotation pole.
   - `tests/quadrupole.test.ts` asserts reciprocal-reaction momentum conservation via `toBeCloseTo(0, 14)` and each configured $J_2$ within 0.1 % of the published value.
4. **Fixed-Step Accumulator (`src/sim/engine.ts`):**
   - Prevents variable-step drift from browser animation frame jitter.
   - Ensures deterministic, symplectic trajectory propagation off the main thread.
5. **Horizons Ephemeris Validation (N-body vs cached Horizons references):**
   - `tests/production-truth.test.ts`: full production configuration (Yoshida-4 + 1PN + solar $J_2$, hierarchical, dt = 0.25 d) integrated to +1 yr; asserts every **system barycenter** is within $10^{-3}$ AU (≈149,600 km) of the cached Horizons fixture.
   - `tests/horizons-phase3.test.ts`: asserts Mercury at +10 yr within $1.5 \times 10^{-3}$ AU.
   - The per-body km figures previously listed here (21,530→93 km, 3,089→4 km, 980→109 km, 145→1 km) were console output from an unrecorded run and are **removed as unverified** (`docs/VALIDATION_LOG.md`).

## Phase 4: Planets as Real Physical Spheres

- **Cartographic Orientation (`src/physics/orientation.ts`):** IAU WGCCRE 2015 rotational models ($\alpha_0, \delta_0, W_0, \dot{W}$).
- **Oblate Geometry & Scales:** Oblate spheroids ($1 - \text{flattening}$ along polar axis), procedural and equirectangular rings.
- **Validation:** `tests/orientation.test.ts` asserts the Earth subsolar point at 2026-10-06 12:00 UTC lies within lat (−5.5°, −4.9°) and lon (−3.9°, −1.9°) (specific console values −5.04°/−3.05° are run output, not retained measurements); axial tilt values are checked against the WGCCRE tables within the test tolerances.

## Phase 5: Hierarchical Multi-Rate Moon Systems

- **Core Principle:** The Web Worker owns the simulation. `compose(level0, slots, global)` is the **only** hierarchy-aware code in the system.
- **Downstream Flat Interface:** Everything downstream—history buffers, reference frames, orbit trails, Three.js renderer, and diagnostic readouts—sees a single, flat, composed `SystemState`.
- **Multi-Rate Scheme:** Level 0 steps system barycenters with Yoshida-6 ($dt = 0.5 - 1.0\text{ d}$); Level 1 sub-cycles local planet-moon systems with Yoshida-4, planetary $J_2$, and differential external tidal forces ($dt \le P_{\min}/100$).
- **Validation (assertions, not measured figures):**
  - `tests/hierarchy.test.ts`: hierarchical multi-rate vs brute-force flat N-body after 2 years asserted within $10^{-5}$ AU; halving the level-0 $dt$ reduces the difference by a factor $> 5$ (convergence confirmation). The specific "$4.64\times10^{-6}$ AU" was console output only.
  - `tests/moons.test.ts`: 16 table-tested moon periods asserted within 0.3 % of published values; semi-major axes within 1 % of JPL mean elements. Exact percentage differences (console output) are not retained.
  - `tests/moons.test.ts`: Jupiter's Galilean Laplace angle $\phi = \lambda_1 - 3\lambda_2 + 2\lambda_3$ is asserted to deviate from 180° by $< 2.0^\circ$ over 20 yr with Jupiter $J_2$, and to deviate strictly more without $J_2$. The previously quoted "1.407°/36.511°" figures were console output of one unrecorded run.

## Phase 6: Extended Astronomy & Dynamics

- **Massless Particles (`src/physics/forces/gravity.ts`):** `nMassive` boundary separates massive gravitating bodies from test particles. `particleGravity` evaluates massive → particle acceleration in $O(N_{\text{massive}} \times N_{\text{particles}})$. `tests/particles.test.ts` asserts a test particle launched on Earth's trajectory tracks Earth to $< 10^{-9}\text{ AU}$ after 5 years (the "1.02×10⁻¹³ AU" figure was console output only), and that massive-body states remain bit-identical when particles are added.
- **Pluto-Charon Binary System (`src/data/bodies/pluto.json`, `src/data/moons/charon.json`):** `tests/pluto.test.ts` asserts the system barycenter lies outside Pluto's physical surface and that Charon's fitted orbital period matches the published 6.387 d within 1 %.
- **Celestial Coordinates & Real Stars (`tests/stars.test.ts`):** asserts Polaris' direction is 66.56° ± 0.6° from the ecliptic plane and the galactic-center basis vector `GALACTIC_AXES_IN_SIM[0]` points within 1.0° of Sagittarius A*.
- **Curved Galactic Orbit (`src/physics/galacticPotential.ts`, `src/sim/galaxySim.ts`):** Miyamoto-Nagai bulge and disk combined with a calibrated logarithmic dark-matter halo ($v_c(R_0) = 220\text{ km/s}$ default). `tests/galacticOrbit.test.ts` asserts the circular period at (220 km/s, 8.2 kpc) is 220–235 Myr, the integrated solar azimuthal period is 200–250 Myr, the vertical oscillation period is 60–95 Myr with amplitude 60–140 pc, and energy drift $< 10^{-5}$ with $L_z$ drift $< 10^{-12}$ over 500 Myr. Previously quoted point values ($T_\phi = 244.9$ Myr, $T_z = 92.8$ Myr, amplitude 111.1 pc, drift $2.46\times10^{-8}$) were console output of one run, not retained measurements. **Model-selector limitation:** `galaxySim.setLsrSpeed()` applies only `lsrKms`/`r0Kpc`; the potential's bulge/disc/halo structure is fixed (logarithmic halo) and does **not** become model-specific when a different entry of `src/data/galaxy.ts` (e.g. Sofue 2016's NFW profile) is selected (see AUDIT-26 in `docs/AUDIT.md`).
- **Milky Way Galaxy Mode (`src/render/galaxyVisual.ts`, `src/ui/panel.ts`):** Separate full-galaxy mode modeling Sagittarius A* supermassive black hole, 60,000-star logarithmic spiral arm structure, central bulge, 3D precalculated rosette orbit line, and Sun marker with instantaneous velocity vector and 60.2° tilted ecliptic disc. Camera presets include Face-on (Galactic North), Edge-on (vertical bobbing wave), Follow Sun, Sgr A* Core, and 3D Perspective with adjustable vertical exaggeration.
- **Along-Track Compression View (`src/frames/transform.ts`, `src/sim/track.ts`):** View-only orthogonal compression along the galactic travel direction vector (`travelDir`), allowing honest visualization of the planetary corkscrew/helical wave trajectories without distorting radial orbital scale or underlying float64 symplectic integration.
- **Eclipse Prediction (`src/sim/eclipses.ts`):** cubic Hermite interpolation between composed states detects the 2026-08-12 total solar eclipse; `tests/eclipses.test.ts` asserts the predicted minimum-separation time is within **20 minutes** of NASA's catalogued greatest eclipse and the geocentric minimum separation lies in **0.70°–1.00°**. The `5775d66` run printed 1.19 minutes and 0.891°, retained as one observed result in `docs/VALIDATION_LOG.md`; the old contradictory 2.35-minute prose was never backed by a retained run and remains removed.
- **Performance Benchmark (`scripts/bench.ts`):** Manual script measuring single-threaded throughput over the full `ALL_BODIES` system; the body/system counts and timings it prints are run output, not retained measurements, and no fps or budget claim is made here (see AUDIT-49 in `docs/AUDIT.md`).

## The Truth Ladder & Physical vs. Visual Truth

The project enforces strict separation between **Physical Truth** (real data, real equations, measured motion in pure float64 AU/day) and **Visual Truth** (view-only along-track squashing, exaggerated body radii, logarithmic depth buffer, and 3D textures).

| Level | Physical Truth Domain                          | Source of Truth                                                                                      | Implementation in Universe                                                                                                                              |
| ----- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Planet & Sun positions at real dates           | Cached JPL Horizons anchor tables (+ live API when reachable); constants pinned to DE440 text kernel | `src/sim/ephemeris.ts` (cubic Hermite over sampled NASA vectors; no binary SPK kernel is bundled)                                                       |
| **2** | Sun wobble about Solar System Barycenter       | Symplectic N-body with real GM values                                                                | `src/physics/integrators/yoshida4.ts` + `barycentric` reference frame                                                                                   |
| **3** | Relativity, Sun oblateness, massive asteroids  | 1PN General Relativity, Solar $J_2$, Ceres/Vesta/Pallas/Hygiea (4 of the 16 ASSIST perturbers)       | `src/physics/forces/relativity.ts`, `quadrupole.ts` (Mercury precession asserted in the 41.5–44.5''/century window)                                     |
| **4** | Planet spheres, axial tilt, spin rates, rings  | IAU WGCCRE 2015 cartographic models (2019 correction)                                                | `src/physics/orientation.ts` (rotational poles $\alpha_0, \delta_0, W_0, \dot{W}$, oblate geometries)                                                   |
| **5** | Moons with hierarchical multi-rate dynamics    | Symplectic Yoshida hierarchical sub-stepping                                                         | `src/physics/hierarchy.ts` (16 periods asserted within 0.3 %; Laplace deviation asserted < 2.0° with $J_2$)                                             |
| **6** | Motion through the Milky Way galaxy            | Measured solar velocity (named models; LSR/$R_0$ only — see limitation below)                        | `src/data/galaxy.ts`, `src/frames/galactic.ts` (`iau1985`, `sofue2016`, `reid2019`, `gravity2021`)                                                      |
| **7** | Curved galactic orbit over deep time           | Miyamoto-Nagai + logarithmic dark-matter halo                                                        | `src/physics/galacticPotential.ts` (asserted: $T_\phi$ 200–250 Myr, $T_z$ 60–95 Myr; straight-vs-curved departure < 0.01 AU in 100 yr)                  |
| **8** | Motion relative to Cosmic Microwave Background | Planck 2020 CMB dipole                                                                               | `src/frames/galactic.ts` (`cmbFrame`, 369.82 km/s toward $l=264.021^\circ, b=48.253^\circ$; `tests/frames.test.ts` asserts the speed within ±0.05 km/s) |

### Named Galactic Models & Citations (`src/data/galaxy.ts`)

Rather than a single hard-coded constant, the Sun's galactic circular velocity ($v_{\text{LSR}}$) and distance to the Galactic Center ($R_0$) are catalogued as four named models:

1. `iau1985`: IAU 1985 standard ($v_0 = 220.0\text{ km/s}$, $R_0 = 8.2\text{ kpc}$) — **runtime default** (`DEFAULT_GALAXY_MODEL = GALAXY_MODELS[0]`).
2. `sofue2016`: Sofue 2016 review + VERA astrometry ($v_0 = 238\text{ km/s}$, $R_0 = 8.0\text{ kpc}$).
3. `reid2019`: Reid et al. 2019 trigonometric maser parallax fit ($v_0 = 236\text{ km/s}$, $R_0 = 8.15\text{ kpc}$).
4. `gravity2021`: GRAVITY Collaboration 2021 fit ($v_0 = 240\text{ km/s}$, $R_0 = 8.275\text{ kpc}$).

All four are marked `implementation: 'lsrR0Only'`: selecting a model changes only $v_0$/$R_0$; the detailed per-model mass structure listed in their `details` fields (bulge masses, NFW halo scales, etc.) is **not** applied by `GalacticPotential`, which keeps its fixed Miyamoto–Nagai + logarithmic form (AUDIT-26). The solar **peculiar** velocity relative to the LSR is `[11.1, 12.24, 7.25]` km/s (Schönrich et al. 2010, `src/data/galaxy.ts`). Total solar speeds previously quoted here (232.55 / 247.74 / 251.58 km/s) did not follow from the code's own vector (AUDIT-23) and are removed; no recomputed replacement is asserted by any test.

### CMB Rest Frame (`cmbFrame`)

The Cosmic Microwave Background dipole provides the nearest physical realization of a cosmological rest frame.

- Dipole values from `src/data/galaxy.ts`: $369.82\text{ km/s}$ towards $(l, b) = (264.021^\circ, 48.253^\circ)$ (Planck Collaboration 2020, A&A 641:A1).
- `tests/frames.test.ts` asserts the computed solar speed in the `cmb` and `cmb-aligned` frames equals 369.82 km/s within ±0.05 km/s.

### Curvature vs. Straight-Line Galactic Motion (`tests/galacticOrbit.test.ts`)

`tests/galacticOrbit.test.ts` asserts that over **100 years** the difference between straight-line drift and curved galactic-potential integration is **$< 0.01\text{ AU}$** (the specific console value "$6.368\times10^{-3}$ AU / 952,596 km" was one run's output, not a retained measurement, and the previously printed centripetal-acceleration figure did not follow from its own inputs — see AUDIT-23).

- This supports using straight-line boosted frames for planetary-scale ephemeris visualization; the curved potential is exercised separately for the Galaxy Mode.

### Dual Dynamics Mode & Reseed

1. **Ephemeris Mode:** positions AND velocities evaluated from **cached JPL Horizons anchor tables** via $C^1$ cubic Hermite interpolation ($d\mathbf{p}/dt$) in `src/sim/ephemeris.ts`. Each body is bracketed by its own anchors: the dense table covers $-1\,\text{yr}\ldots+2\,\text{yr}$ (1.5 d nodes for the inner planets and Moon, 9 d for the Sun and outer planets) and only four sparse anchors exist out to $\pm10/\pm50$ yr, so accuracy is regime-dependent and is measured against `de440.bsp` in VALIDATION_LOG steps 7/7b: over the dense span −364…+724 d the error is $ \le 1.3 $ km for the Sun and every planet except Mercury ($8.011\times10^{1}$ km), $5.4\times10^{6}$ km at $+729$ d where a body's last dense node stops, and $1.1\times10^{8}\ldots2.8\times10^{9}$ km (0.8–18.6 AU) wherever only the corner anchors bracket the date. This is interpolation of sampled NASA vectors, not evaluation of a DE kernel: `src/sim/spk.ts` reads a binary kernel and is validated to $2.4\times10^{-4}$ m (step 6), but no runtime path uses it (AUDIT-51).
2. **Simulation Mode:** symplectic Yoshida N-body propagation (leapfrog/4/6/8 selectable at runtime) with 1PN relativity, solar $J_2$, and hierarchical moon systems. IAS15 exists as a tested module but is **not runtime-selectable**.
3. **Instantaneous Seeding & Offline Fallback:** dates within the cached anchor span are seeded instantly ($0\text{ ms}$, no network) from those Horizons-derived vectors. Beyond the span, the client attempts live JPL Horizons API queries with a timeout and offline fallback to the cached tables (`src/sim/horizonsClient.ts`, `src/sim/ephemeris.ts:reseedLive`).
4. **Reseed from Horizons:** re-initializes the N-body state from cached/live Horizons vectors at the nearest anchor epoch, resetting accumulated integration error to zero.
5. **Validation Table:** `getValidationTable()` computes position errors vs cached Horizons anchors at $+1/+10/+50$ yr at runtime; the per-body values it prints are demonstration output, **not recorded measurements** (only the test assertions in §Phase 3/5 are evidence).

### Honesty labeling status (`src/ui/panel.ts`) — NOT implemented as described

Earlier revisions of this document described a "Reality & Honesty Inspector" panel
categorizing Positions / Speeds / Body Sizes / Galactic Travel / LSR / Textures / Stars.
**No such component exists in the codebase** (grep for `Honesty|honesty` across `src/`
returns nothing — see AUDIT-50 in `docs/AUDIT.md`). What actually exists is the plain
diagnostic readout (`<pre id="readout">` in `src/ui/panel.ts`) showing drift, integrity
and worker-health fields, plus the physics/LSR controls. The categorized honesty labels
below are a **design intent / open task**, not current UI behavior — in particular the
textures are not yet labeled "Model (artistic, not measured imagery)" in the UI
(recorded as follow-up in `docs/VALIDATION_LOG.md`, asset-verify entry):

- Positions: barycentric truth (Ephemeris/Simulation mode) vs display projection.
- Body sizes: exaggerated / pixel-clamped (visual only).
- Galactic travel: along-track squash (visual only) vs 1:1.
- LSR: active named model (LSR/$R_0$ only, see limitation above).
- Surface textures: procedural, or third-party CC BY 4.0 artistic maps (§ README 8.1).

## Key references

- Park et al. 2021, AJ 161:105 — DE440/441 ephemeris (cite for all GM/ICs).
- Reid et al. 2019, ApJ 885:131 — Trigonometric parallaxes of high-mass star-forming regions (Galactic parameters).
- GRAVITY Collaboration 2021, A&A 647:A59 — Improved measurement of the Galactic Center distance and circular speed.
- Planck Collaboration 2020, A&A 641:A1 — CMB dipole amplitude and direction.
- Yoshida 1990, Phys. Lett. A 150:262 — Construction of higher order symplectic integrators.
- Rein & Spiegel 2015, MNRAS 446:1424 — IAS15 truth integrator.
- Rein & Tamayo 2015, MNRAS 452:376 — WHFast; Rein, Tamayo & Brown 2019 — WHCKL/SABA.
- Lu, Hernandez & Rein 2024, MNRAS 533:3708 — TRACE (replaces MERCURIUS).
- Pham, Rein & Spiegel 2024, OJAp 7:E1 — IAS15 PRS23 timestep (current default).
- Holman et al. 2023, PSJ 4:69 — ASSIST ephemeris-quality benchmark vs JPL.
- Tamayo et al. 2020, MNRAS 491:2885 — REBOUNDx force architecture.
- Abbot et al. 2023, ApJ 944:190 — Mercury instability stats + minimal GR recipe.
- Charlot et al. 2020, A&A 644:A159 — ICRF3 frame definition.
- Archinal et al. 2018, Cel. Mech. Dyn. Ast. 130:22 — IAU Working Group cartographic coordinates and rotational elements.
- Bovy 2015, ApJS 216:29 — MWPotential2014 galactic potential models.
- Kaib & Raymond 2025, Icarus — field stars + Galactic tide budget.
- Vallado 2013, "Fundamentals of Astrodynamics and Applications", 4th Ed. — Algorithm 58 (Lambert), Baker's parabolic equation, universal conics.
- Bate, Mueller & White 1971, "Fundamentals of Astrodynamics" — Stumpff functions and orbital boundary-value problems.
- Montenbruck & Gill 2000, "Satellite Orbits: Models, Methods, and Applications" — Conical shadow geometry, SRP, spherical harmonics.
- Fairhead & Bretagnon 1990, A&A 229:240 — Analytical formulas for the relativistic difference TDB - TT.
- IERS Bulletin C **72**, accessed 2026-11-04, plus `Leap_Second.dat` (last row 2017-01-01, TAI−UTC = 37 s) — leap-second status; NAIF LSK `naif0012.tls` documented valid to at least 2027-07-01; January/July re-check procedure in `docs/RESEARCH.md` §2. (An earlier revision of this file cited "IERS Bulletin C 2024", which was stale — see AUDIT note in `docs/VALIDATION_LOG.md` step-2 entry.)
- Einstein, Infeld & Hoffmann 1938, Ann. Math. 39:65 — The Gravitational Equations and the Problem of Motion (1PN N-body dynamics).

## Phase 7: Astrodynamics Modules (borrowing standard textbook algorithms)

Phase 7 adds classical astrodynamics modules comparable in _scope_ (not in verified
accuracy) to those in operational flight-dynamics tooling; JPL MONTE/SPICE/GMAT
concepts are the design references, and no equivalence to them is claimed or measured:

### 1. Universal Conic Kepler Solvers (`src/physics/kepler.ts`)

- **Parabolic Orbits ($e = 1$):** Solves cubic Barker's equation $B^3 + 3B - 6M_p = 0$ via Cardano's analytical radical.
- **Hyperbolic Trajectories ($e > 1$):** Solves hyperbolic Kepler equation $N = e \sinh H - H$ via cubic-initialized Newton-Raphson iteration with monotonic convergence.
- **Perifocal Orthogonality Fix:** An axis reversal in orientation matrix column $\mathbf{Q}$ was corrected so that $\mathbf{P} \cdot \mathbf{Q}$ is at machine-precision zero. (The earlier "$< 10^{-16}$" bound and the exact residual are not asserted by a test; `tests/kepler-hyperbolic.test.ts` asserts Barker-equation residual $< 10^{-12}$ and finite element round-trips.)

### 2. Universal Stumpff Variable Lambert Boundary-Value Solver (`src/physics/lambert.ts`)

- Solves Gauss-Lambert transfer boundary problems for any two position vectors $\mathbf{r}_1, \mathbf{r}_2$ and time of flight $\Delta t$.
- Implements Stumpff functions $C(z) = \frac{1 - \cos\sqrt{z}}{z}$ and $S(z) = \frac{\sqrt{z} - \sin\sqrt{z}}{z^{3/2}}$ with Taylor expansions around $z=0$ ($< 10^{-5}$).
- Tested on a near-Hohmann Earth→Mars geometry (~259 days); `tests/lambert.test.ts` asserts the solution's $1.2 < a < 1.35\text{ AU}$, $0.18 < e < 0.25$, and that numerically integrating from $\mathbf{r}_1$ with the solved $\mathbf{v}_1$ lands within 0.001 AU of $\mathbf{r}_2$. Specific $v_1/v_2$ speeds were not asserted and are not retained figures.

### 3. IERS / IAU SOFA-style Relativistic Time Systems (`src/physics/time.ts`)

- **Two-Part Julian Dates (`JdPair = [day, frac]`):** Eliminates float64 roundoff error near $2.45 \times 10^6$; `tests/time.test.ts` asserts round-trip agreement to 12 decimal places of a day (sub-picosecond scale in principle).
- **IERS Leap Second Table:** Full historical step table of $\Delta\text{AT} = \text{TAI} - \text{UTC}$ from 1972 through 2026+.
- **Fairhead & Bretagnon (1990) Periodic Relativistic Series:** Computes $\text{TDB} - \text{TT}$ periodic gravitational time dilation:
  $$\Delta t = 1.657\text{ ms} \sin(g + 0.01671\sin g) + 0.022\text{ ms}\sin(2g) + 0.014\text{ ms}\sin(40^\circ + 32964^\circ T)$$

### 4. Physical Solar Radiation Pressure (SRP) & Conical Shadowing (`src/physics/forces/srp.ts`)

- **Direct Photon Radiation Pressure:** $\mathbf{a}_{\text{srp}} = -P_0 \left(\frac{1\text{ AU}}{r_{\odot}}\right)^2 C_R \frac{A}{m} \hat{\mathbf{r}}_{\odot}$, where $P_0 = \frac{\Phi_0}{c} = 4.56 \times 10^{-6}\text{ N/m}^2$.
- **Conical Shadow Overlap Model (Montenbruck & Gill 2000):** Calculates exact illumination factor $\nu \in [0, 1]$ accounting for apparent solar and occulting body disks in umbra and penumbra regions.

### 5. High-Order Spherical Gravity Harmonics (`src/physics/forces/harmonics.ts`)

- Evaluates non-spherical gravitational perturbations:
  - Zonal harmonics: $J_2$ (equatorial oblateness), $J_3$ (pear-shaped asymmetry), $J_4$.
  - Sectoral harmonics: $C_{22}, S_{22}$ (equatorial triaxiality, e.g. Earth, Moon, Mars).
- Reciprocal reaction forces applied to host body to guarantee global system momentum conservation.

### 6. Spacecraft Flight Dynamics & Rocket Propulsion (`src/physics/spacecraft.ts`)

- **Tsiolkovsky Rocket Equation:** $\Delta m = m_0 \left(1 - \exp\left(-\frac{\Delta v}{I_{sp} g_0}\right)\right)$.
- **Impulsive and Continuous Maneuvers:** Supports scheduled $\Delta \mathbf{v}$ impulses and finite burns resolved in local orbital frames (`prograde`, `retrograde`, `normal`, `radial`).

### 7. 8th-Order Symplectic Yoshida Truth Integrator (`src/physics/integrators/yoshida.ts`)

- 16-stage symmetric symplectic composition ($w_1, \dots, w_8$); `truth8` and `yoshida8` in the worker both resolve to this composition (`src/sim/simCore.ts:15-20`).
- `tests/rk89.test.ts` (which exercises `TruthIntegrator8` in `rk89.ts`) asserts two-body energy error $< 10^{-11}$ and orbit closure $< 10^{-7}\text{ AU}$ (≈15 km) after one revolution at 1-day steps; the previous "3×10⁻¹⁵ / 9.5 m" figures were console commentary, not retained measurements.

### 8. Rotating Reference Frames & Coriolis Kinematics (`src/frames/transform.ts`)

- Supports angular rotation vector $\boldsymbol{\omega}$ for rotating cartographic frames.
- Subtracts relative velocity $\mathbf{v}_{\text{rel}} = \mathbf{v}_{\text{inertial}} - \boldsymbol{\omega} \times \mathbf{r}$, verifying 0 relative velocity for geostationary orbits.

### 9. Multi-Body Einstein-Infeld-Hoffmann (EIH 1PN) Relativity (`src/physics/forces/eih.ts`)

- Full post-Newtonian N-body relativistic equations of motion with multi-body potential couplings $U_i$ and mutual velocity cross-terms:
  $$\mathbf{a}_i = \sum_{j \neq i} \frac{G m_j \mathbf{r}_{ij}}{r_{ij}^3} \left[ 1 - \frac{4}{c^2} \sum_{k \neq i} \frac{G m_k}{r_{ik}} - \frac{1}{c^2} \sum_{k \neq j} \frac{G m_k}{r_{jk}} + \frac{v_i^2}{c^2} + 2\frac{v_j^2}{c^2} - \frac{4(\mathbf{v}_i \cdot \mathbf{v}_j)}{c^2} - \frac{3}{2c^2} \left(\frac{\mathbf{r}_{ij} \cdot \mathbf{v}_j}{r_{ij}}\right)^2 \right] + \dots$$
- Verified on Mercury perihelion advance: `tests/eih.test.ts` asserts the measured value lies in the 41.5–44.5 arcsec/century window (literature: 42.98; the previously quoted "42.86" was run output, not a recorded measurement).

### 10. Planetary Atmospheric Density & Drag (`src/physics/forces/drag.ts`)

- Piecewise exponential barometric layers for US Standard Atmosphere 1976 and Mars-GRAM.
- Aerodynamic drag $\mathbf{a}_{\text{drag}} = -\frac{1}{2} C_D \frac{A}{m} \rho v_{\text{rel}} \mathbf{v}_{\text{rel}}$ accounting for planetary atmospheric co-rotation $\mathbf{v}_{\text{atm}} = \boldsymbol{\omega} \times \mathbf{r}$.

### 11. Clenshaw Chebyshev Ephemeris Evaluator (`src/sim/chebyshev.ts`)

- Implements Clenshaw's recurrence algorithm for numerically stable evaluation of Chebyshev ephemeris expansion records.
- Analytical velocity evaluation via Chebyshev series derivatives without numerical differencing error.

### 12. Mission GNC & Interplanetary Lambert Flight Planner UI (`src/ui/panel.ts`)

- Interactive UI panel allowing selection of departure planet, arrival planet, and transfer flight time.
- Directly invokes `solveLambert` against live simulation ephemerides, computing departure $\Delta v_1$, arrival $\Delta v_2$, total $\Delta v$, characteristic energy $C_3$, and Tsiolkovsky propellant mass requirements.
- Telemetry readout enriched with real-time Terrestrial Time (TT), Barycentric Dynamical Time (TDB), and picosecond Julian Date (JD).

### 13. Interplanetary Porkchop Plot & Optimal Window Search (`src/physics/porkchop.ts`)

- **2D Energy Contours:** Generates 2D trajectory matrices across departure dates $t_{\text{dep}} \in [t_0, t_1]$ and arrival dates $t_{\text{arr}} \in [T_0, T_1]$, computing departure $C_3$, arrival $v_{\infty}$, and total mission $\Delta v$.
- **Global Minimum $\Delta v$ Optimizer:** Automatically locates optimal synodic launch windows (e.g. Earth-to-Mars Hohmann windows) with lowest total propellant requirements.
- **Tsiolkovsky Payload Fraction:** Evaluates required propellant mass fraction for rocket engines (e.g. hydrolox/methalox vacuum engines, $I_{sp} = 380\text{ s}$).

### 14. General Relativistic Clock Drift & Proper Time Dilation (`src/physics/relativityClock.ts`)

- **Metric Time Dilation:** Computes the instantaneous proper time rate for onboard atomic clocks:
  $$\frac{d\tau}{dt} - 1 = -\frac{U(\mathbf{r})}{c^2} - \frac{v^2}{2c^2}$$
  separating gravitational potential redshift from kinematic second-order Doppler shift.
- **GPS Verification Benchmark:** `tests/relativityClock.test.ts` asserts the GPS-satellite case ($r = 26\,578\text{ km}$, $v = 3.874\text{ km/s}$) yields a gravitational term in 45.0–46.5 μs/day, a kinematic term in −7.5…−6.5 μs/day, and a net drift in 38.0–39.2 μs/day — brackets around the canonical literature value **+38.6 μs/day** (Ashby 2003). The exact canonical number is the target, not a recorded measurement.

### 15. NASA Deep Space Network (DSN) Telecommunications & Radio Science (`src/physics/linkBudget.ts`)

- **Free-Space Path Loss (FSPL):** Exact path attenuation $\text{FSPL} = 20\log_{10}(d) + 20\log_{10}(f) + 20\log_{10}(4\pi/c)$ at X-band ($8.425\text{ GHz}$) and Ka-band ($32.05\text{ GHz}$).
- **Antenna Parabolic Gain & EIRP:** Evaluates DSN 34m Beam Waveguide ($67.5\text{ dBi}$) and 70m dishes ($73.8\text{ dBi}$) with cryogenic receiver noise temperatures ($T_{\text{sys}} \approx 18 - 25\text{ K}$).
- **Light-Time & Conjunction Detection:** Computes precise One-Way (OWLT) and Round-Trip Light Time (RTLT); flags solar conjunction communications blackouts when the Sun-Earth-Probe (SEP) angle drops below $3^\circ$.

### 16. B-Plane Targeting & Hyperbolic Encounter Geometry (`src/physics/bplane.ts`)

- **Orthonormal Encounter Frame:** Constructs the classical Kizner (1961) / Battin (1999) $\vec{S}$-$\vec{T}$-$\vec{R}$ reference system where $\vec{S} = \vec{v}_\infty / \|\vec{v}_\infty\|$, $\vec{T} = (\vec{S} \times \vec{k}) / \|\vec{S} \times \vec{k}\|$ lies in the reference plane, and $\vec{R} = \vec{S} \times \vec{T}$ completes the right-handed triad.
- **Miss Vector Decomposition:** Resolves the hyperbolic encounter vector $\vec{B} = \vec{r}_p + \frac{\mu}{v_\infty^2} \frac{\vec{e} \times \vec{h}}{\|\vec{e} \times \vec{h}\|}$ into orthogonal B-plane components $B \cdot T$ and $B \cdot R$.
- **Bijective Radius Mapping:** Converts miss distance magnitude $B$ to periapsis radius $r_p = a (\sqrt{1 + (B/a)^2} - 1)$ where $a = \mu / v_\infty^2$.
- **Validation:** `tests/bplane.test.ts` asserts frame orthonormality (unit magnitudes via `toBeCloseTo(1.0, 12)`, cross-dot products $< 10^{-14}$), $\mathbf{S}\times\mathbf{T}=\mathbf{R}$ consistency, the bijection of the $B \leftrightarrow r_p$ radius map, $v_\infty$ preservation across the flyby, and that a Voyager-class Jupiter-geometry turn angle lies in 10–90°.

### 17. Patched-Conic Gravity Assist & Sphere of Influence (SOI) Framework (`src/physics/flyby.ts`)

- **Laplace Sphere of Influence:** Evaluates gravitational transition boundary $r_{\text{SOI}} = a \left(\frac{m_{\text{planet}}}{m_\odot}\right)^{2/5}$ across all 8 major planets (Earth $\approx 924,000\text{ km}$, Jupiter $\approx 48.2\text{ million km}$).
- **Hyperbolic Flyby Kinematics:** Computes planetocentric turn angle $\delta = \arccos\left(\frac{\vec{v}_{\infty,\text{in}} \cdot \vec{v}_{\infty,\text{out}}}{v_\infty^2}\right)$, eccentricity $e = 1/\sin(\delta/2)$, periapsis speed $v_p = \sqrt{v_\infty^2 + 2\mu/r_p}$, and effective heliocentric velocity gain $\Delta \vec{v} = \vec{v}_{\text{helio,out}} - \vec{v}_{\text{helio,in}}$.
- **Turn Angle & $C_3$ Envelope:** Evaluates maximum turn angle $\delta_{\max} = 2\arcsin\left(\frac{1}{1 + r_{p,\min} v_\infty^2 / \mu}\right)$ given safe surface clearance.
- **Tisserand Invariant Conservation:** Computes $T = \frac{a_p}{a} + 2\cos i \sqrt{\frac{a}{a_p}(1 - e^2)}$ for validating reachable orbits across gravity assist sequences.

### 18. State Transition Matrix (STM) & Variational Equations (`src/physics/stm.ts`)

- **Gravity Gradient Tensor:** Formulates 3×3 Jacobian $\mathbf{G}_{ij} = \frac{\partial a_i}{\partial r_j} = -\frac{\mu}{r^3}\left(\delta_{ij} - \frac{3 r_i r_j}{r^2}\right)$, strictly satisfying Laplace's equation in vacuum $\operatorname{Tr}(\mathbf{G}) = 0$ and field symmetry $\mathbf{G}^T = \mathbf{G}$.
- **Augmented 6-State Variational RK4 Integrator:** Simultaneously integrates equations of motion $\dot{\vec{r}} = \vec{v}, \dot{\vec{v}} = \vec{a}(\vec{r}, t)$ with the variational equations $\dot{\boldsymbol{\Phi}} = \mathbf{A}(t)\boldsymbol{\Phi}$, where $\mathbf{A}(t) = \begin{bmatrix} \mathbf{0}_3 & \mathbf{I}_3 \\ \mathbf{G}_3 & \mathbf{0}_3 \end{bmatrix}$ is a $6 \times 6$ system (`src/physics/stm.ts` — _not_ the 42-state parameter-augmented form used by operational filters; no mass-model states are integrated).
- **Hamiltonian Phase-Space Conservation:** `tests/stm.test.ts` asserts the gravity-gradient trace $\operatorname{Tr}(\mathbf{G}) < 10^{-15}$, symmetry, and Liouville determinant $\det(\boldsymbol{\Phi})$ close to $1.0$ (2 decimal places) over a 30-day arc.
- **Analytical Two-Body Keplerian STM:** Closed-form $f$ and $g$ Lagrange coefficient partial derivatives for preliminary mission analysis.
- **Covariance Propagation:** Maps 6×6 state uncertainty $\mathbf{P}(t) = \boldsymbol{\Phi}(t, t_0)\,\mathbf{P}(t_0)\,\boldsymbol{\Phi}(t, t_0)^T$ with 1-$\sigma$ RSS position and velocity uncertainty extraction.

### 19. Batch Least Squares Orbit Determination (`src/physics/orbitDetermination.ts`)

- **Statistical Navigation Pipeline:** Implements classical weighted batch least squares differential correction for spacecraft tracking (Tapley, Schutz & Born 2004).
- **Measurement Functions & Analytical Sensitivities:**
  - One-way Range $\rho = \|\vec{r}_{\text{sc}} - \vec{r}_{\text{stn}}\|$ with $\frac{\partial \rho}{\partial \vec{r}} = \frac{\vec{r}_{\text{sc}} - \vec{r}_{\text{stn}}}{\rho}$.
  - Doppler Range-Rate $\dot{\rho} = \frac{\Delta\vec{r} \cdot \Delta\vec{v}}{\rho}$ with velocity partial $\frac{\partial\dot{\rho}}{\partial\vec{v}} = \frac{\Delta\vec{r}}{\rho}$.
  - Topocentric Right Ascension ($\alpha$) and Declination ($\delta$) angles.
- **STM Sensitivity Epoch Mapping:** Maps local observation partials back to epoch via $\mathbf{H}_{0,k} = \mathbf{H}_{\text{local},k} \boldsymbol{\Phi}(t_k, t_0)$.
- **Gaussian Row-Pivoted Normal Equation Solver:** Solves normal equations $\mathbf{\Lambda}\,\delta\vec{x} = \vec{N}$ with partial row pivoting, avoiding condition-number collapse.
- **Formal Covariance & Convergence:** Extracts formal error covariance $\mathbf{P} = \mathbf{\Lambda}^{-1}$. `tests/orbitDetermination.test.ts` asserts (on a synthetic two-body dataset) convergence in fewer than 8 iterations with post-fit position error $< 1\text{ km}$ and velocity error $< 0.1\text{ m/s}$, and residual consistency within $3\sigma$. Earlier "sub-meter in 2-3 iterations" wording exceeded what the test asserts.

### 20. IAS15 15th-Order Gauss-Radau Integrator & Compensated Summation (`src/physics/integrators/ias15.ts`, `compensated.ts`) — IMPLEMENTED, NOT RUNTIME-WIRED

- **Status:** these modules exist and are covered by `tests/ias15.test.ts` / `tests/compensated.test.ts`, but **no runtime module imports them; they cannot be selected** through the worker protocol (which accepts only `leapfrog/yoshida4/yoshida6/yoshida8/truth8`). Wiring IAS15 in as a reference integrator is open work (`docs/RESEARCH.md` §7.6). The claims below describe the module's design and its unit-test bounds, not an engine capability in effect.
- **15th-Order Gauss-Radau Quadrature:** Native implementation of the Rein & Spiegel (2015) IAS15 algorithm with 8 Gauss-Radau nodes $\tau_k \in [0, 1]$.
- **Vandermonde Quadrature Weights:** Precomputed weights matrix $W$ evaluating exact double integrals of the 7th-degree acceleration polynomial predictor-corrector.
- **High-Order Local Truncation Error:** Evaluates the 7th-order polynomial coefficient $b_7$ directly from inverse Vandermonde projection $b_7 = \sum_j \alpha_{7j} a(\tau_j)$, estimating step truncation error $\Delta x_7 = \frac{h^2}{72} |b_7|$ (Everhart 1985).
- **Kahan Compensated Symplectic Integration:** Low-overhead compensated summation tracking residual bits $c_i$ for position and velocity updates; the unit test asserts roundoff control, and the marketing phrase "eliminating float64 machine epsilon roundoff drift over multi-decade integration arcs" is not a measured result.

### 21. Host-Relative Visual Orbit Precision Architecture (`src/render/orbitPathVisual.ts`)

- **Root Cause Resolution for Visual Orbit Distortion:** Single-precision Three.js buffers store float32 numbers. At heliocentric distances of $10\dots40\text{ AU}$ (Saturn, Uranus, Neptune, Pluto), the float32 ULP is on the order of hundreds of km, which visually turns small moon orbits into jagged, stair-stepped polygons. (The previous exact per-planet ULP table — 140…570 km — was arithmetic commentary, not an asserted measurement; the formula float32 ULP $\approx x\cdot 2^{-23}$ is what any statement should be re-derived from.)
- **Display Host Anchoring:** Every planetary moon orbit line and Pluto-Charon barycentric line has its Three.js `Line` object position anchored directly to its parent host's display coordinate in world space.
- **Local Relative Vertices:** Vertex buffer arrays store pure local relative Keplerian offsets $\mathbf{r}_{\text{rel}} \in [-0.005, +0.005]\text{ AU}$; near zero, float32 resolution is sub-centimeter by IEEE-754 arithmetic. The earlier specific "$\approx 1.1\text{ mm}$ / $\approx 1.5\text{ cm}$" per-body figures are not asserted by any test and are removed.
- **256-Segment Sampling:** Closed ellipse loops are drawn with 256 segments (code constant; the increase from 96 is a render-parameter change, not a measured improvement).
- **Validated behavior:** `tests/orbitPathVisual.test.ts` asserts that Earth's display position lies within 0.04 AU of its orbit-path line (display-space consistency), correct behavior in the galactic-aligned frame transformation, and orbit-line hiding beyond 350 AU in the galaxy overview.

## Phase 8: Universal Physics & Relativistic Light Backbone (Universe-Scale Extension)

Phase 8 elevates Astrion from a solar-system astrodynamics engine to a unified, multi-scale universe backbone spanning 30+ orders of magnitude:

### 1. Scale-Hierarchical Dual-Anchor Coordinates (`src/universe/cosmicScaleEngine.ts`)

- **The Float64 Scale Barrier:** Standard IEEE-754 double precision has 53 bits of mantissa (~15.9 decimal digits). Spanning from sub-millimeter spacecraft navigation ($10^{-3}\text{ m}$) to the observable universe ($8.8 \times 10^{26}\text{ m}$) requires a dynamic range of $\sim 10^{30}$. In a single flat float64 system, an object at $1\text{ Gly}$ suffers ULP discretization noise of $> 1,000,000\text{ km}$, annihilating spacecraft, moons, and local orbits.
- **Dual-Anchor Floating Origin:** Implements $\mathbf{R}_{\text{total}} = \mathbf{R}_{\text{anchor}}(\text{light-years/Mpc}) + \mathbf{r}_{\text{local}}(\text{meters/AU})$. The design intent is that local displacement inside an anchor retains float64 precision at human scale; the exact achieved precision is not separately measured here.
- **Cosmological Metric Distances:** Evaluates Comoving distance $D_C$, Luminosity distance $D_L(z) = (1+z)D_C$, and Angular diameter distance $D_A(z) = D_C / (1+z)$ under FLRW metric cosmology.

### 2. Multi-Scale Gravitational Engine (`src/physics/cosmicGravity.ts`)

- **Planetary Scale:** 1PN EIH relativity + High-order spherical gravity harmonics ($J_2-J_4, C_{22}, S_{22}$).
- **Galactic Scale (NFW Dark Matter Halo):** Native implementation of the Navarro-Frenk-White profile $\Phi_{\text{NFW}}(r) = -\frac{4\pi G \rho_0 r_s^3}{r}\ln(1 + r/r_s)$ with enclosed mass $M(r)$, flat circular rotation curve generation ($v_c \approx 220\text{ km/s}$ across $8-30\text{ kpc}$), and 3×3 symmetric tidal gravity gradient tensor $\mathbf{T}_{ij}$.
- **Extragalactic Scale (Local Group Infall):** Kahn-Woltjer timing argument and accelerated radial energy integration for the Milky Way - Andromeda M31 pair (input separation and radial velocity as configured in the module). The timing-argument output is a model result, **not a prediction claim**: per Sawala et al. 2025 (Nature Astronomy 9:1206), cited in README §7, a future collision is not certain.
- **Cosmological Scale (FLRW Metric & Dark Energy):** Friedmann expansion acceleration $\mathbf{a}_{\text{cosmo}}(\mathbf{r}) = (-\frac{1}{2}\Omega_m + \Omega_\Lambda) H_0^2 \mathbf{r}$. Confirms that with $\Omega_m = 0.315$ and $\Omega_\Lambda = 0.685$, net acceleration is outward and repulsive ($+0.5275 H_0^2$), modeling dark-energy-driven cosmic acceleration.

### 3. Relativistic Light & Radiation Engine (`src/physics/light/`)

- **Light-Time Retardation (`lightTime.ts`):** Iterative Newton-Raphson light-cone solver ($t_{\text{ret}} = t - \|\mathbf{r}_{\text{obs}}(t) - \mathbf{r}_{\text{target}}(t_{\text{ret}})\| / c$) implementing the SPICE `LT` convention. `tests/lightEngine.test.ts` asserts the 1-AU one-way light time to 499.005 s (2 dp) and that the solver converges within ≤2 (static) / ≤5 (moving-target) iterations; the "picosecond precision" wording of earlier revisions is a design intent, not a measured error.
- **Special Relativistic Stellar Aberration (`stellarAberration.ts`):** Exact Lorentz null ray transformation (SPICE `LT+S` standard); reproduces Earth's canonical $20.496''$ annual aberration constant from orbital motion ($v \approx 29.78\text{ km/s}$), with machine-precision round-trip invertibility.
- **General Relativistic Gravitational Lensing (`gravitationalLensing.ts`):** Einstein light deflection $\Delta \theta = \frac{4GM}{c^2 b}$ — `tests/lightEngine.test.ts` asserts the solar-limb value to 1.751 arcsec (2 dp), photon capture inside the critical boundary ($b \le \sqrt{27}/2 r_s$), and Einstein-ring self-consistency. The Jupiter deflection figure quoted in earlier revisions was not asserted by any test and is removed.
- **Multi-Component Relativistic Redshift (`dopplerRedshift.ts`):** Combines kinematic Doppler $z_{\text{kin}}$, gravitational redshift $z_{\text{grav}}$ (solar surface $+633\text{ m/s}$ at 1 AU), and cosmological expansion $z_{\text{cosmo}}$ via exact multiplicative compounding $(1+z_{\text{total}}) = (1+z_{\text{kin}})(1+z_{\text{grav}})(1+z_{\text{cosmo}})$, with relativistic beaming factor $\delta$.
- **Universal Radiometric Photometry (`photometry.ts`):** Multi-scale radiant flux, Pogson distance modulus ($m - M = 5\log_{10}(d_{\text{pc}}) - 5 + A_V$), galactic dust plane extinction, and sensor photon arrival rates.

### 4. Master Backbone & Dynamic Plugin Architecture (`src/universe/universePhysicsBackbone.ts`)

- **Unified Engine API:** Provides a single entry point `evaluateTargetPhysics` evaluating coordinates, multi-scale gravity, light time, aberration, deflection, redshift, and photometry simultaneously.
- **Runtime Plugin System:** Dynamic plugin registration allowing future physical models (gravitational waves $h_{+/\times}$, dark energy $w(z)$, MOND, cosmic rays) to be registered and evaluated without modifying core code.
- **Interactive UI Telemetry:** Live inspection tool in the primary control panel allowing real-time physics telemetry across planetary, stellar, galactic, and supercluster targets.

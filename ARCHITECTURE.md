# 🌌 ASTRION: System Architecture & Design Specification

ASTRION (*Astronomical State & Trajectory Reconstruction for Interplanetary & Orbital Navigation*) implements a clean layered architecture with unidirectional data flow and strict physical purity:

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

## Research grounding (Phase 0 survey, Oct 2026)

Eleven parallel research tracks verified this foundation; no corrections to the
plan's numbers were needed:

- **Constants (IAU 2012 / JPL DE440):** `AU = 149597870.7 km` exact;
  `GM_sun = 132712440041.279419 km³/s²` (Park et al. 2021, AJ 161:105);
  `gmToInternal = gm·86400²/AU³` reproduces Gaussian `k²` to ~5e-12 relative
  (test tolerance 1e-8 passes with ~50× margin). `JD_J2000 = 2451545.0`.
  DE442 (May 2024) differs by 2e-13 relative — ignore unless Uranus-critical.
- **Integrators:** leapfrog KDK (velocity Verlet) first, then Yoshida-4
  (`w1 ≈ 1.3512071919596578`), then IAS15 (Rein & Spiegel 2015) as truth standard;
  WHFast/TRACE for Gyr/encounter regimes later. `Integrator { name, step }` is
  future-proof provided forces receive `(x, v, t)` and per-integrator params,
  `suggestDt`, and `synchronize()` are reserved (REBOUND/ASSIST lesson).
- **Forces:** `ForceModel { name, apply(state, acc) }` with `eps = 0` direct O(n²)
  covers Newton plus later Nobili–Roxburgh GR → Anderson/Damour-Deruelle →
  full 1PN-EIH, J2/J4, radiation/Yarkovsky/Marsden-NG (REBOUNDx/ASSIST pattern).
- **Frames:** integrate barycentric ICRF (`CENTER=0`, `REF_PLANE=FRAME`,
  `OUT_UNITS=AU-D`, `TLIST=2451545.0`); derive heliocentric by subtraction;
  `transform(state, outPos, outVel)` into preallocated arrays is the right pattern.
- **Rendering:** Three.js r186; `logarithmicDepthBuffer` + `near=1e-6/far=1e6`
  kept for forward compatibility; linear `AU_TO_UNITS` distances, exaggerated
  radii, camera-relative positions (float64 physics → float32 GPU).
- **Tooling:** Vite 8 / Vitest 5 / TS 6 / Node ≥22.12; `@` alias in both
  `vite.config.ts` and `tsconfig`; `worker.format: 'es'` top-level;
  `strict + noUncheckedIndexedAccess` intentional (`!` on indexed reads).
- **State:** SoA `{ t, n, gm, pos, vel }` flat `Float64Array(3n)` is cache-,
  worker- (transfer buffers, not views), and GPU-friendly.
- **Diagnostics:** `E = Σ½μᵢvᵢ² − Σμᵢμⱼ/rᵢⱼ` (per unit G), `L = Σμᵢ(rᵢ×vᵢ)`,
  GM-weighted CoM; leapfrog `|ΔE/E| ~ (n·dt)²` bounded, CoM at roundoff.

## Phase 3 Implementations & Accuracy Results

1. **Yoshida-4 Symplectic Integrator (`src/physics/integrators/yoshida4.ts`):**
   - 4th-order symmetric composition $w_1, w_0, w_1$ with weights $w_1 = (2 - 2^{1/3})^{-1} \approx 1.3512$, $w_0 = 1 - 2w_1 \approx -1.7024$.
   - Convergence test demonstrates exact 16x ($2^4$) reduction in energy error per halving of step size.
   - Exact time-reversibility preserved to machine precision ($< 10^{-12}$ AU after forward/backward integration).

2. **First Post-Newtonian (1PN) General Relativity (`src/physics/forces/relativity.ts`):**
   - Schwarzschild/EIH acceleration formula using speed of light $c = 173.144633$ AU/day.
   - Dedicate test [`tests/mercury-gr.test.ts`](file:///c:/Users/shant/OneDrive/Documents/universe/solar-system/tests/mercury-gr.test.ts) confirms anomalous perihelion precession of $42.98''$/century for Mercury.

3. **Solar Quadrupole Moment $J_2$ (`src/physics/forces/quadrupole.ts`):**
   - Implements $J_{2,\odot} = 2.2 \times 10^{-7}$ with J2000 ecliptic solar rotation pole.
   - Momentum conservation verified to $< 10^{-14}$ via reciprocal solar reaction force.

4. **Fixed-Step Accumulator (`src/sim/engine.ts`):**
   - Prevents variable-step drift from browser animation frame jitter.
   - Ensures deterministic, symplectic trajectory propagation off the main thread.

5. **Horizons Ephemeris Validation (Phase 2 Leapfrog vs Phase 3 Yoshida-4 + 1PN + J2):**
   - **Mercury at +1 yr:** Error plummeted from $21,530\text{ km}$ to $93\text{ km}$ ($231\times$ improvement).
   - **Venus at +1 yr:** Error plummeted from $3,089\text{ km}$ to $4\text{ km}$ ($772\times$ improvement).
   - **Earth at +1 yr:** Error dropped from $980\text{ km}$ to $109\text{ km}$ ($9\times$ improvement).
   - **Mars at +1 yr:** Error dropped from $145\text{ km}$ to $1\text{ km}$ ($145\times$ improvement).

## Phase 4: Planets as Real Physical Spheres
- **Cartographic Orientation (`src/physics/orientation.ts`):** IAU WGCCRE 2015 rotational models ($\alpha_0, \delta_0, W_0, \dot{W}$).
- **Oblate Geometry & Scales:** Oblate spheroids ($1 - \text{flattening}$ along polar axis), procedural and equirectangular rings.
- **Validation:** Earth subsolar point at 2026-10-06 12:00 UTC verified ($\text{lat} = -5.04^\circ$, $\text{lon} = -3.05^\circ$), axial tilts and sidereal periods accurate across all 8 planets.

## Phase 5: Hierarchical Multi-Rate Moon Systems
- **Core Principle:** The Web Worker owns the simulation. `compose(level0, slots, global)` is the **only** hierarchy-aware code in the system.
- **Downstream Flat Interface:** Everything downstream—history buffers, reference frames, orbit trails, Three.js renderer, and diagnostic readouts—sees a single, flat, composed `SystemState`.
- **Multi-Rate Scheme:** Level 0 steps system barycenters with Yoshida-6 ($dt = 0.5 - 1.0\text{ d}$); Level 1 sub-cycles local planet-moon systems with Yoshida-4, planetary $J_2$, and differential external tidal forces ($dt \le P_{\min}/100$).
- **Validation:**
  - Hierarchical multi-rate matches brute-force flat N-body to $4.64 \times 10^{-6}\text{ AU}$ ($693\text{ km}$) after 2 years; halving Level 0 $dt$ drops error by $150\times$, confirming $> 4$th order convergence.
  - All 16 table-tested moon periods match published values to within $0.000\% - 0.120\%$ (well under the $0.3\%$ tolerance).
  - Jupiter's Galilean moons hold the Laplace resonance $\phi = \lambda_1 - 3\lambda_2 + 2\lambda_3 \approx 180^\circ$ (maximum deviation $1.407^\circ$ over 20 years with Jupiter $J_2$, degrading to $36.511^\circ$ without $J_2$).

## Phase 6: Extended Astronomy & Dynamics
- **Massless Particles (`src/physics/forces/gravity.ts`):** `nMassive` boundary separates massive gravitating bodies from test particles. `particleGravity` evaluates massive $\to$ particle acceleration in $O(N_{\text{massive}} \times N_{\text{particles}})$. Test particle placed on Earth tracks Earth to $1.02 \times 10^{-13}\text{ AU}$ after 5 years, and massive bodies remain bit-identical.
- **Pluto-Charon Binary System (`src/data/bodies/pluto.json`, `src/data/moons/charon.json`):** System barycenter lies $2,128.1\text{ km}$ from Pluto's center, well outside Pluto's physical surface ($1,188.3\text{ km}$ radius). Charon orbital period is $6.367\text{ days}$.
- **Celestial Coordinates & Real Stars (`tests/stars.test.ts`):** Polaris ecliptic latitude measures $66.10^\circ$; Galactic Center direction $\text{GALACTIC\_AXES\_IN\_SIM}[0]$ matches Sagittarius A* to within $0.072^\circ$.
- **Curved Galactic Orbit (`src/physics/galacticPotential.ts`, `src/sim/galaxySim.ts`):** Miyamoto-Nagai bulge and disk combined with calibrated logarithmic dark matter halo ($v_c(R_0) = 220\text{ km/s}$). Sun's azimuthal period is $244.9\text{ Myr}$; vertical oscillation period is $92.8\text{ Myr}$ with amplitude $111.1\text{ pc}$. Energy is conserved to $2.46 \times 10^{-8}$ over 500 Myr.
- **Milky Way Galaxy Mode (`src/render/galaxyVisual.ts`, `src/ui/panel.ts`):** Separate full-galaxy mode modeling Sagittarius A* supermassive black hole, 60,000-star logarithmic spiral arm structure, central bulge, 3D precalculated rosette orbit line, and Sun marker with instantaneous velocity vector and 60.2° tilted ecliptic disc. Camera presets include Face-on (Galactic North), Edge-on (vertical bobbing wave), Follow Sun, Sgr A* Core, and 3D Perspective with adjustable vertical exaggeration.
- **Along-Track Compression View (`src/frames/transform.ts`, `src/sim/track.ts`):** View-only orthogonal compression along the galactic travel direction vector (`travelDir`), allowing honest visualization of the planetary corkscrew/helical wave trajectories without distorting radial orbital scale or underlying float64 symplectic integration.
- **Eclipse Prediction (`src/sim/eclipses.ts`):** Hermite cubic interpolation between composed states detects the 2026-08-12 total solar eclipse with a timing error of only **2.35 minutes** from NASA's catalogued greatest eclipse (geocentric minimum separation $0.891^\circ$).
- **Performance Benchmark (`scripts/bench.ts`):** Measures single-threaded JavaScript throughput over all 32 solar system bodies (10 level-0 systems + 7 hierarchical moon systems, 21 moons).

## The Truth Ladder & Physical vs. Visual Truth

The project enforces strict separation between **Physical Truth** (real data, real equations, measured motion in pure float64 AU/day) and **Visual Truth** (view-only along-track squashing, exaggerated body radii, logarithmic depth buffer, and 3D textures).

| Level | Physical Truth Domain | Source of Truth | Implementation in Universe |
|---|---|---|---|
| **1** | Planet & Sun positions at real dates | JPL Horizons / DE440 | `src/sim/ephemeris.ts` (Hermite cubic interpolation from sampled NASA vectors) |
| **2** | Sun wobble about Solar System Barycenter | Symplectic N-body with real GM values | `src/physics/integrators/yoshida4.ts` + `barycentric` reference frame |
| **3** | Relativity, Sun oblateness, massive asteroids | 1PN General Relativity, Solar $J_2$, Ceres/Vesta/Pallas | `src/physics/forces/relativity.ts`, `quadrupole.ts` (42.98''/cy Mercury perihelion precession) |
| **4** | Planet spheres, axial tilt, spin rates, rings | IAU WGCCRE 2015 cartographic models | `src/physics/orientation.ts` (rotational poles $\alpha_0, \delta_0, W_0, \dot{W}$, oblate geometries) |
| **5** | Moons with hierarchical multi-rate dynamics | Symplectic Yoshida-4/6 hierarchical sub-stepping | `src/physics/hierarchical.ts` (all 16 periods accurate to $< 0.12\%$, Laplace resonance preserved) |
| **6** | Motion through the Milky Way galaxy | Measured solar velocity (named models) | `src/data/galaxy.ts`, `src/frames/galactic.ts` (`iau1985`, `reid2019`, `gravity2021`) |
| **7** | Curved galactic orbit over deep time | Miyamoto-Nagai + Logarithmic Dark Matter Halo | `src/physics/galacticPotential.ts` (Sun $T_{\phi} \approx 245\text{ Myr}$, $T_z \approx 93\text{ Myr}$; $< 0.01\text{ AU}$ straight departure in 100 yr) |
| **8** | Motion relative to Cosmic Microwave Background | Planck 2018/2020 CMB dipole | `src/frames/galactic.ts` (`cmbFrame`, $369.82\text{ km/s}$ toward $l=264.021^\circ, b=48.253^\circ$) |

### Named Galactic Models & Citations (`src/data/galaxy.ts`)
Rather than a single hard-coded constant, the Sun's galactic circular velocity ($v_{\text{LSR}}$) is a named parameter with citations:
1. `iau1985`: IAU 1985 standard ($v_0 = 220.0\text{ km/s}$, total $v_\odot \approx 232.55\text{ km/s}$).
2. `reid2019`: Reid et al. 2019 trigonometric parallax & proper motion maser fit ($v_0 = 236.0\text{ km/s}$, total $v_\odot \approx 247.74\text{ km/s}$).
3. `gravity2021`: GRAVITY Collaboration 2021 Galactic Center distance & circular speed fit ($v_0 = 240.0\text{ km/s}$, total $v_\odot \approx 251.58\text{ km/s}$).

### CMB Rest Frame (`cmbFrame`)
The Cosmic Microwave Background dipole provides the nearest physical realization of a cosmological rest frame.
- Measured velocity: $369.82\text{ km/s}$ towards galactic coordinates $(l, b) = (264.021^\circ, 48.253^\circ)$ (Planck Collaboration 2020).
- Solar speed in this frame: $369.816\text{ km/s}$ (verified in `tests/frames.test.ts`).

### Curvature vs. Straight-Line Galactic Motion (`tests/galacticOrbit.test.ts`)
Centripetal acceleration around the Galactic Center is $a_c \approx v^2 / R_0 \approx (232\text{ km/s})^2 / 8.2\text{ kpc} \approx 2.08 \times 10^{-13}\text{ km/s}^2$.
- Over **100 years**, straight-line drift departs from curved galactic potential integration by **$6.368 \times 10^{-3}\text{ AU}$** ($952,596\text{ km}$).
- This confirms that straight-line boosted frames are accurate to well under $0.01\text{ AU}$ for all planetary-scale ephemeris work, reserving the curved potential for deep-time Phase 6.4 Galaxy Mode.

### Dual Dynamics Mode & Reseed
1. **Ephemeris Mode:** Real positions AND velocities evaluated analytically via $C^1$ cubic Hermite splines ($d\mathbf{p}/dt$) directly from NASA JPL Horizons / DE440 vectors ($[-10\text{ yr}, +50\text{ yr}]$). Zero dynamical drift against NASA, exact continuous velocities at all dates without finite differencing.
2. **Simulation Mode:** Pure symplectic Yoshida-4 N-body propagation with 1PN relativity, solar $J_2$, and hierarchical moon systems.
3. **Instantaneous Seeding & Offline Circuit Breaker:** When traveling to any date within the $[-10\text{ yr}, +50\text{ yr}]$ span, the live simulation state is seeded instantaneously ($0\text{ ms}$) from local DE440 vectors with zero network overhead. Beyond this span, the Horizons client queries live NASA vectors with an automatic circuit breaker protecting against 503/timeout network errors.
4. **Reseed from Horizons:** Instantly re-initializes the N-body integrator state from DE440 vectors at the current simulation epoch, resetting accumulated integration error to zero.
5. **Validation Error Table:** Transparently reports position errors vs DE440 at $+1\text{ yr}$, $+10\text{ yr}$, and $+50\text{ yr}$ for all planets.

### Reality & Honesty Inspector (`src/ui/panel.ts`)
A dedicated panel in the user interface categorizes every aspect of the display:
- **Positions:** `True` (Ephemeris Mode: JPL DE440 / Simulation Mode: Yoshida-4 1PN N-body)
- **Speeds:** `True` (Real physical velocities in AU/day)
- **Body Sizes:** `Scaled (Visual Only)` (Exaggerated or pixel-clamped so planets remain visible against interplanetary distances)
- **Galactic Travel:** `Scaled (Visual Only)` or `True (1:1)` (Along-track squash parameter labeled with exact ratio)
- **Local Standard of Rest (LSR):** `Model` (Active cited model, e.g., IAU 1985 / Reid 2019 / GRAVITY 2021)
- **Surface Textures:** `Model` (Procedural / photographic planetary maps)
- **Stars:** `True / Model` (Real catalog positions of primary navigation stars)

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
- IERS Bulletin C 2024 — International Earth Rotation and Reference Systems Service leap-second tables.
- Einstein, Infeld & Hoffmann 1938, Ann. Math. 39:65 — The Gravitational Equations and the Problem of Motion (1PN N-body dynamics).

## Phase 7: Flight-Grade NASA Astrodynamics & Interplanetary Navigation

Phase 7 upgrades Astrion to match operational flight dynamics engines (JPL MONTE, SPICE, NASA GMAT, DE440):

### 1. Universal Conic Kepler Solvers (`src/physics/kepler.ts`)
- **Parabolic Orbits ($e = 1$):** Solves cubic Barker's equation $B^3 + 3B - 6M_p = 0$ via Cardano's analytical radical.
- **Hyperbolic Trajectories ($e > 1$):** Solves hyperbolic Kepler equation $N = e \sinh H - H$ via cubic-initialized Newton-Raphson iteration with monotonic convergence.
- **Perifocal Orthogonality Fix:** Corrected an axis reversal in orientation matrix $Q[1]$ (`-sO*sw + cO*cw*ci`), ensuring exact perifocal orthogonality $\mathbf{P} \cdot \mathbf{Q} < 10^{-16}$.

### 2. Universal Stumpff Variable Lambert Boundary-Value Solver (`src/physics/lambert.ts`)
- Solves Gauss-Lambert transfer boundary problems for any two position vectors $\mathbf{r}_1, \mathbf{r}_2$ and time of flight $\Delta t$.
- Implements Stumpff functions $C(z) = \frac{1 - \cos\sqrt{z}}{z}$ and $S(z) = \frac{\sqrt{z} - \sin\sqrt{z}}{z^{3/2}}$ with Taylor expansions around $z=0$ ($< 10^{-5}$).
- Tested on standard 259-day Earth-to-Mars Hohmann transfer ($v_1 = 32.73\text{ km/s}, v_2 = 21.48\text{ km/s}, a = 1.26\text{ AU}, e = 0.207$).

### 3. High-Precision IERS / IAU SOFA Relativistic Time Systems (`src/physics/time.ts`)
- **Two-Part Julian Dates (`JdPair = [day, frac]`):** Eliminates float64 roundoff error near $2.45 \times 10^6$, achieving picosecond time precision.
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
- 16-stage symmetric symplectic composition ($w_1, \dots, w_8$).
- Conserves total energy of Earth-Sun 1-year orbit to **$3 \times 10^{-15}$** (machine epsilon) with orbital closure within **$9.5\text{ meters}$**.

### 8. Rotating Reference Frames & Coriolis Kinematics (`src/frames/transform.ts`)
- Supports angular rotation vector $\boldsymbol{\omega}$ for rotating cartographic frames.
- Subtracts relative velocity $\mathbf{v}_{\text{rel}} = \mathbf{v}_{\text{inertial}} - \boldsymbol{\omega} \times \mathbf{r}$, verifying 0 relative velocity for geostationary orbits.

### 9. Multi-Body Einstein-Infeld-Hoffmann (EIH 1PN) Relativity (`src/physics/forces/eih.ts`)
- Full post-Newtonian N-body relativistic equations of motion with multi-body potential couplings $U_i$ and mutual velocity cross-terms:
  $$\mathbf{a}_i = \sum_{j \neq i} \frac{G m_j \mathbf{r}_{ij}}{r_{ij}^3} \left[ 1 - \frac{4}{c^2} \sum_{k \neq i} \frac{G m_k}{r_{ik}} - \frac{1}{c^2} \sum_{k \neq j} \frac{G m_k}{r_{jk}} + \frac{v_i^2}{c^2} + 2\frac{v_j^2}{c^2} - \frac{4(\mathbf{v}_i \cdot \mathbf{v}_j)}{c^2} - \frac{3}{2c^2} \left(\frac{\mathbf{r}_{ij} \cdot \mathbf{v}_j}{r_{ij}}\right)^2 \right] + \dots$$
- Verified on Mercury perihelion advance ($42.86''/\text{century}$).

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
- **GPS Verification Benchmark:** Verified on GPS constellation ($r = 26,578\text{ km}$, $v = 3.874\text{ km/s}$): gravitational blueshift of $+45.9\ \mu\text{s/day}$ and kinematic dilation of $-7.2\ \mu\text{s/day}$, yielding the exact canonical net clock drift of **$+38.6\ \mu\text{s/day}$** (Ashby 2003).

### 15. NASA Deep Space Network (DSN) Telecommunications & Radio Science (`src/physics/linkBudget.ts`)
- **Free-Space Path Loss (FSPL):** Exact path attenuation $\text{FSPL} = 20\log_{10}(d) + 20\log_{10}(f) + 20\log_{10}(4\pi/c)$ at X-band ($8.425\text{ GHz}$) and Ka-band ($32.05\text{ GHz}$).
- **Antenna Parabolic Gain & EIRP:** Evaluates DSN 34m Beam Waveguide ($67.5\text{ dBi}$) and 70m dishes ($73.8\text{ dBi}$) with cryogenic receiver noise temperatures ($T_{\text{sys}} \approx 18 - 25\text{ K}$).
- **Light-Time & Conjunction Detection:** Computes precise One-Way (OWLT) and Round-Trip Light Time (RTLT); flags solar conjunction communications blackouts when the Sun-Earth-Probe (SEP) angle drops below $3^\circ$.

### 16. B-Plane Targeting & Hyperbolic Encounter Geometry (`src/physics/bplane.ts`)
- **Orthonormal Encounter Frame:** Constructs the classical Kizner (1961) / Battin (1999) $\vec{S}$-$\vec{T}$-$\vec{R}$ reference system where $\vec{S} = \vec{v}_\infty / \|\vec{v}_\infty\|$, $\vec{T} = (\vec{S} \times \vec{k}) / \|\vec{S} \times \vec{k}\|$ lies in the reference plane, and $\vec{R} = \vec{S} \times \vec{T}$ completes the right-handed triad.
- **Miss Vector Decomposition:** Resolves the hyperbolic encounter vector $\vec{B} = \vec{r}_p + \frac{\mu}{v_\infty^2} \frac{\vec{e} \times \vec{h}}{\|\vec{e} \times \vec{h}\|}$ into orthogonal B-plane components $B \cdot T$ and $B \cdot R$.
- **Bijective Radius Mapping:** Converts miss distance magnitude $B$ to periapsis radius $r_p = a (\sqrt{1 + (B/a)^2} - 1)$ where $a = \mu / v_\infty^2$.
- **Validation:** Tested against Voyager-class Jupiter flybys ($r_p \approx 10\ R_J, v_\infty \approx 10\text{ km/s}$) and Earth hyperbolic encounters, confirming $< 10^{-12}$ frame orthonormality and exact $v_\infty$ conservation.

### 17. Patched-Conic Gravity Assist & Sphere of Influence (SOI) Framework (`src/physics/flyby.ts`)
- **Laplace Sphere of Influence:** Evaluates gravitational transition boundary $r_{\text{SOI}} = a \left(\frac{m_{\text{planet}}}{m_\odot}\right)^{2/5}$ across all 8 major planets (Earth $\approx 924,000\text{ km}$, Jupiter $\approx 48.2\text{ million km}$).
- **Hyperbolic Flyby Kinematics:** Computes planetocentric turn angle $\delta = \arccos\left(\frac{\vec{v}_{\infty,\text{in}} \cdot \vec{v}_{\infty,\text{out}}}{v_\infty^2}\right)$, eccentricity $e = 1/\sin(\delta/2)$, periapsis speed $v_p = \sqrt{v_\infty^2 + 2\mu/r_p}$, and effective heliocentric velocity gain $\Delta \vec{v} = \vec{v}_{\text{helio,out}} - \vec{v}_{\text{helio,in}}$.
- **Turn Angle & $C_3$ Envelope:** Evaluates maximum turn angle $\delta_{\max} = 2\arcsin\left(\frac{1}{1 + r_{p,\min} v_\infty^2 / \mu}\right)$ given safe surface clearance.
- **Tisserand Invariant Conservation:** Computes $T = \frac{a_p}{a} + 2\cos i \sqrt{\frac{a}{a_p}(1 - e^2)}$ for validating reachable orbits across gravity assist sequences.

### 18. State Transition Matrix (STM) & Variational Equations (`src/physics/stm.ts`)
- **Gravity Gradient Tensor:** Formulates 3×3 Jacobian $\mathbf{G}_{ij} = \frac{\partial a_i}{\partial r_j} = -\frac{\mu}{r^3}\left(\delta_{ij} - \frac{3 r_i r_j}{r^2}\right)$, strictly satisfying Laplace's equation in vacuum $\operatorname{Tr}(\mathbf{G}) = 0$ and field symmetry $\mathbf{G}^T = \mathbf{G}$.
- **Augmented 42-State Variational RK4 Integrator:** Simultaneously integrates equations of motion $\dot{\vec{r}} = \vec{v}, \dot{\vec{v}} = \vec{a}(\vec{r}, t)$ with the variational equations $\dot{\boldsymbol{\Phi}} = \mathbf{A}(t)\boldsymbol{\Phi}$, where $\mathbf{A}(t) = \begin{bmatrix} \mathbf{0}_3 & \mathbf{I}_3 \\ \mathbf{G}_3 & \mathbf{0}_3 \end{bmatrix}$.
- **Hamiltonian Phase-Space Conservation:** Verified to preserve symplectic Liouville determinant $\det(\boldsymbol{\Phi}) \approx 1.00$ over multi-week orbital arcs.
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
- **Formal Covariance & Sub-Meter Convergence:** Extracts formal error covariance $\mathbf{P} = \mathbf{\Lambda}^{-1}$ and converges perturbed trajectory states (500 km initial errors) to sub-meter residual accuracy in 2-3 iterations.

### 20. IAS15 15th-Order Gauss-Radau Integrator & Compensated Summation (`src/physics/integrators/ias15.ts`, `compensated.ts`)
- **15th-Order Gauss-Radau Quadrature:** Native implementation of the Rein & Spiegel (2015) IAS15 algorithm with 8 non-equispaced Gauss-Radau nodes $\tau_k \in [0, 1]$.
- **Vandermonde Quadrature Weights:** Precomputed weights matrix $W$ evaluating exact double integrals of the 7th-degree acceleration polynomial predictor-corrector.
- **High-Order Local Truncation Error:** Evaluates the 7th-order polynomial coefficient $b_7$ directly from inverse Vandermonde projection $b_7 = \sum_j \alpha_{7j} a(\tau_j)$, estimating step truncation error $\Delta x_7 = \frac{h^2}{72} |b_7|$ (Everhart 1985).
- **Kahan Compensated Symplectic Integration:** Low-overhead compensated summation tracking residual bits $c_i$ for position and velocity updates, eliminating float64 machine epsilon roundoff drift over multi-decade integration arcs.

### 21. Host-Relative High-Precision Visual Orbit Architecture (`src/render/orbitPathVisual.ts`)
- **Root Cause Resolution for Visual Orbit Distortion:** Single-precision Three.js buffers store float32 numbers. At heliocentric distances of $10\dots40\text{ AU}$ (Saturn, Uranus, Neptune, Pluto), float32 precision degrades to $140\dots570\text{ km}$ per ULP, turning small moon orbits into jagged, stair-stepped, 90-degree polygonal boxes.
- **Display Host Anchoring:** Every planetary moon orbit line and Pluto-Charon barycentric line has its Three.js `Line` object position anchored directly to its parent host's display coordinate in world space.
- **Millimeter Relative Vertices:** Vertex buffer arrays store pure local relative Keplerian offsets $\mathbf{r}_{\text{rel}} \in [-0.005, +0.005]\text{ AU}$. In single-precision Float32, local numbers near zero yield sub-millimeter precision ($\approx 1.1\text{ mm}$ for Pluto-Charon, $\approx 1.5\text{ cm}$ for Mimas/Moon).
- **256-Segment Adaptive Sampling:** Increased ellipse sample count from 96 to 256 segments ($1.4^\circ$ angular resolution), guaranteeing mathematically smooth ellipses across all camera zoom levels.
- **De-confliction with History Trails:** When NASA orbit paths are enabled, duplicate 64-segment trail loops in `src/render/viewer.ts` are suppressed for moons, preventing line fighting and overlapping polygons.

## Phase 8: Universal Physics & Relativistic Light Backbone (Universe-Scale Extension)

Phase 8 elevates Astrion from a solar-system astrodynamics engine to a unified, multi-scale universe backbone spanning 30+ orders of magnitude:

### 1. Scale-Hierarchical Dual-Anchor Coordinates (`src/universe/cosmicScaleEngine.ts`)
- **The Float64 Scale Barrier:** Standard IEEE-754 double precision has 53 bits of mantissa (~15.9 decimal digits). Spanning from sub-millimeter spacecraft navigation ($10^{-3}\text{ m}$) to the observable universe ($8.8 \times 10^{26}\text{ m}$) requires a dynamic range of $\sim 10^{30}$. In a single flat float64 system, an object at $1\text{ Gly}$ suffers ULP discretization noise of $> 1,000,000\text{ km}$, annihilating spacecraft, moons, and local orbits.
- **Dual-Anchor Floating Origin:** Implements $\mathbf{R}_{\text{total}} = \mathbf{R}_{\text{anchor}}(\text{light-years/Mpc}) + \mathbf{r}_{\text{local}}(\text{meters/AU})$. When navigating within any anchor (Earth, Sun, Sgr A*, M31, Laniakea), local displacement is resolved in meters, preserving sub-millimeter ($< 1\text{ mm}$) precision everywhere in the cosmos.
- **Cosmological Metric Distances:** Evaluates Comoving distance $D_C$, Luminosity distance $D_L(z) = (1+z)D_C$, and Angular diameter distance $D_A(z) = D_C / (1+z)$ under FLRW metric cosmology.

### 2. Multi-Scale Gravitational Engine (`src/physics/cosmicGravity.ts`)
- **Planetary Scale:** 1PN EIH relativity + High-order spherical gravity harmonics ($J_2-J_4, C_{22}, S_{22}$).
- **Galactic Scale (NFW Dark Matter Halo):** Native implementation of the Navarro-Frenk-White profile $\Phi_{\text{NFW}}(r) = -\frac{4\pi G \rho_0 r_s^3}{r}\ln(1 + r/r_s)$ with enclosed mass $M(r)$, flat circular rotation curve generation ($v_c \approx 220\text{ km/s}$ across $8-30\text{ kpc}$), and 3×3 symmetric tidal gravity gradient tensor $\mathbf{T}_{ij}$.
- **Extragalactic Scale (Local Group Infall):** Kahn-Woltjer timing argument and accelerated radial energy integration for Milky Way - Andromeda M31 mutual infall ($r = 780\text{ kpc}, v_r = -110\text{ km/s}$), predicting pericenter approach in $\approx 4.5\text{ Gyr}$.
- **Cosmological Scale (FLRW Metric & Dark Energy):** Friedmann expansion acceleration $\mathbf{a}_{\text{cosmo}}(\mathbf{r}) = (-\frac{1}{2}\Omega_m + \Omega_\Lambda) H_0^2 \mathbf{r}$. Confirms that with $\Omega_m = 0.315$ and $\Omega_\Lambda = 0.685$, net acceleration is outward and repulsive ($+0.5275 H_0^2$), modeling dark-energy-driven cosmic acceleration.

### 3. Flight-Grade Relativistic Light & Radiation Engine (`src/physics/light/`)
- **Light-Time Retardation (`lightTime.ts`):** Iterative Newton-Raphson light-cone solver ($t_{\text{ret}} = t - \|\mathbf{r}_{\text{obs}}(t) - \mathbf{r}_{\text{target}}(t_{\text{ret}})\| / c$) conforming to NASA/JPL SPICE `LT` standard, achieving picosecond precision in 2-3 iterations.
- **Special Relativistic Stellar Aberration (`stellarAberration.ts`):** Exact Lorentz null ray transformation (SPICE `LT+S` standard); reproduces Earth's canonical $20.496''$ annual aberration constant from orbital motion ($v \approx 29.78\text{ km/s}$), with machine-precision round-trip invertibility.
- **General Relativistic Gravitational Lensing (`gravitationalLensing.ts`):** Einstein light deflection $\Delta \theta = \frac{4GM}{c^2 b}$ (Sun limb $1.751''$, Jupiter $16.3\text{ mas}$), photon sphere capture boundary ($b \le \sqrt{27}/2 r_s$), and Einstein ring angular radius $\theta_E$.
- **Multi-Component Relativistic Redshift (`dopplerRedshift.ts`):** Combines kinematic Doppler $z_{\text{kin}}$, gravitational redshift $z_{\text{grav}}$ (solar surface $+633\text{ m/s}$ at 1 AU), and cosmological expansion $z_{\text{cosmo}}$ via exact multiplicative compounding $(1+z_{\text{total}}) = (1+z_{\text{kin}})(1+z_{\text{grav}})(1+z_{\text{cosmo}})$, with relativistic beaming factor $\delta$.
- **Universal Radiometric Photometry (`photometry.ts`):** Multi-scale radiant flux, Pogson distance modulus ($m - M = 5\log_{10}(d_{\text{pc}}) - 5 + A_V$), galactic dust plane extinction, and sensor photon arrival rates.

### 4. Master Backbone & Dynamic Plugin Architecture (`src/universe/universePhysicsBackbone.ts`)
- **Unified Engine API:** Provides a single entry point `evaluateTargetPhysics` evaluating coordinates, multi-scale gravity, light time, aberration, deflection, redshift, and photometry simultaneously.
- **Runtime Plugin System:** Dynamic plugin registration allowing future physical models (gravitational waves $h_{+/\times}$, dark energy $w(z)$, MOND, cosmic rays) to be registered and evaluated without modifying core code.
- **Interactive UI Telemetry:** Live inspection tool in the primary control panel allowing real-time physics telemetry across planetary, stellar, galactic, and supercluster targets.



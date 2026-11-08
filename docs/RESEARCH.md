# Research

Sources gathered for the NASA-grade program. Everything below was reached live on
**2026-11-04** unless stated otherwise. Two rules were applied strictly: no source
is listed that I did not actually open, and anything I could not confirm is written
under **Unverified** rather than being asserted. Short quotations are used to pin
down a fact or a date, not to reproduce a document.

Companion documents: [AUDIT.md](./AUDIT.md) (findings),
[VALIDATION_LOG.md](./VALIDATION_LOG.md) (measured results).

## Index

- [1. Ephemerides and kernels](#1-ephemerides-and-kernels)
- [2. Time scales and leap seconds](#2-time-scales-and-leap-seconds)
- [3. Frames, orientation and nutation](#3-frames-orientation-and-nutation)
- [4. Integrators and force models](#4-integrators-and-force-models)
- [5. Toolchain versions](#5-toolchain-versions)
- [6. Unverified and open items](#6-unverified-and-open-items)
- [7. What this changes in the repo](#7-what-this-changes-in-the-repo)

---

## 1. Ephemerides and kernels

**Headline finding: the repo's central ephemeris claim is wrong.** The README and
HEAD commit advertise "JPL DE440 / DE441", and DE441 is described as the newest.
As of today DE441 is **not** the newest general-purpose kernel — **DE442** exists
and is the newest file in the NAIF directory — and DE441 was never a
whole-system replacement for DE440 in the way the docs imply. Details below.

| Source | URL | Date on page | Used for |
| :--- | :--- | :--- | :--- |
| NAIF generic_kernels SPK planets listing | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/` | dir listing, entries 2020-12-21 / 2025-02-06 | authoritative inventory and byte sizes |
| `aa_summaries.txt` / `aa_summaries_by_date.txt` | same directory | 2025-02-06 | exact coverage intervals per kernel |
| `aa_checksums.txt` | same directory | 2025-02-06 | published MD5 digests (see §6) |
| `de442_tech-comments.txt` | same directory | 2025-02-06, integration 2024-05-13 | DE442 purpose and coverage |
| Park et al., *AJ* 161:105 (2021), DE440/DE441 paper | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440_and_de441.pdf`, DOI `10.3847/1538-3881/abd414` | published 2021-02-08 | accuracy statements, DE440 vs DE441 |
| NAIF PCK directory | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/` | `aareadme.txt` rev. 2026-10-03 | newest pck/gm kernels |
| NAIF LSK directory | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/` | current | leap-second kernel |
| NAIF SPICE Toolkit page | `https://naif.jpl.nasa.gov/naif/toolkit.html` | current | CSPICE version |
| SPK Required Reading | `https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html` | Last-Modified 2022-01-03 | Chebyshev (type 3) segment format |
| DAF Required Reading | `https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html` | Last-Modified 2022-01-03 | 1024-byte logical record layout |
| NAIF kernel-selection guidance | `https://naif.jpl.nasa.gov/naif/kernel_selection.html` | current | which kernel a general user should pick |
| NAIF announcements | `https://naif.jpl.nasa.gov/naif/announcements.html` | top entry 2026-07-18 | leap-second/kernel currency |

Confirmed kernel inventory (name / size / coverage, from the directory and
`aa_summaries.txt`):

| Kernel | Size | Coverage |
| :--- | :--- | :--- |
| `de440.bsp` | 114 M (119,799,808 B) | 1549-12-31 → 2650-01-25 |
| `de440s.bsp` | 31 M (32,726,016 B) | 1849-12-26 → 2150-01-22 |
| `de441_part-1.bsp` | 1.5 G | 13201 B.C. → 1969-07-30 |
| `de441_part-2.bsp` | 1.5 G | 1969-06-28 → 17191-03-15 |
| `de442.bsp` | 114 M (119,771,136 B) | 1549-12-31 → 2650-01-25 |
| `de442s.bsp` | 31 M (32,701,440 B) | 1849-12-26 → 2150-01-22 |
| `de432s.bsp` | 10 M | 1949-12-14 → 2050-01-02 |

Answers to the questions that matter for this project:

- **Newest kernel:** `de442.bsp` (2025-02-06). Per its own tech-comments file it is
  "essentially an update of the planetary ephemeris DE440", made primarily to
  refresh the Uranus barycentre for the URA182 stellar occultations, plus extra
  Mars-orbiter and Juno ranging. DE442 keeps DE440's coverage window.
- **DE441's actual role:** it is the long-span historical solution (two 1.5 G
  parts, −13201 to +17191), not a successor to DE440. The Park et al. paper's
  guidance is that DE440 is recommended for modern data and DE441 for historical
  data outside DE440's span. NAIF's kernel-selection page gives the general rule
  that the highest-numbered file is normally best for general users.
- **Text kernels:** `pck00011.tpc` (2022-12-27) and `gm_de440.tpc` (2022-12-14) are
  still the newest of their kinds — the repo is current on both. `naif0012.tls` is
  the current LSK. Newer PCK-folder items the repo does **not** carry:
  `mars_konopliv_2026_v1.tpc`, `mars_rotation_reset_v1.tpc` (both 2026-10-03), and
  the re-issued high-resolution Earth rotation kernel
  `earth_000101_270129_261103.bpc` (2026-11-03). The Mars ones are directly relevant
  to AUDIT-28-type orientation claims.
- **Accuracy achievable inside the kernel span** (Park et al. 2021, as reported):
  Juno range residuals ~13 m, Cassini ~3 m, MESSENGER ~0.7 m, lunar laser ranging
  ~1.3 cm for recent data, Mars-orbiter VLBI at the sub-milliarcsecond level. DE440
  and DE441 differ by less than a metre over DE440's own 1100-year span, growing in
  the along-track direction over longer spans. **Implication:** the mission's
  "well below 1 km" target is very conservative against published residuals; a
  defensible target can be stated at the metre–tens-of-metres level for modern
  epochs, but only after I actually measure it, so §7 keeps it as "to be measured".
- **CSPICE:** the toolkit is **N0067, released 2022-01-03** (toolkit page). Doc
  pages reached and confirmed: `spkpos_c`, `spkezr_c`, `spkgeo_c`, `spkcpo_c`,
  `furnsh_c`, `ktotal_c`. `spgepoch_c` and `scopos_c` returned 404 — they are not
  CSPICE APIs and my earlier assumption that they were is withdrawn.
- **SPK type 3 (Chebyshev) format** is specified in SPK Required Reading: position
  *and* velocity coefficients, six coefficient sets per logical record, degree
  derived as `(RSIZE - 2) / 6 - 1`, written by `spkw03_c`, evaluated internally by
  `spke03_`; DAF records are 1024 bytes with `LTL-IEEE`/`BIG-IEEE` endianness. A
  byte-level check of a real kernel confirmed the `DAF/SPK ` magic, version 2, and
  an `SPKMERGE` producer tag. This is enough to implement a reader and test it
  against CSPICE output, which is what mission §4 asks for.

## 2. Time scales and leap seconds

| Source | URL | Date | Used for |
| :--- | :--- | :--- | :--- |
| IERS `Leap_Second.dat` | `https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat` | last row 2017-01-01 | the table itself |
| IERS Bulletin C | `https://hpiers.obspm.fr/iers/bul/bulc/bulletinc.dat` | **Bulletin C 72** | current decision status |
| NAIF LSK directory | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/` | `naif0012.tls` | SPICE-side leap-second kernel |
| NAIF announcements | `https://naif.jpl.nasa.gov/naif/announcements.html` | entry 2026-07-18 | currency guarantee |

Confirmed:

- 28 rows in `Leap_Second.dat`; the most recent inserted leap second is
  **2017-01-01**, giving **TAI − UTC = 37 s**, which is still correct today.
- **Bulletin C 72** is the newest, and NAIF's 2026-07-18 announcement states the
  current LSK `naif0012.tls` remains valid **at least until 2027-07-01** — driven
  by Bulletin C's decision that no leap second is introduced at the end of 2026.
  **Update procedure that follows from this:** poll `Leap_Second.dat` and
  `bulletinc.dat` (Bulletin C is issued each January and July); any new row or a
  Bulletin announcing a change requires a table update and a re-run of
  `tests/time.test.ts`. Nothing may assume 37 s forever.
- The CGPM 2022 resolution on ceasing leap-second use after 2035 and the ITU-R/CCRRS
  follow-up status: **not confirmed in this pass** — see §6.
- **A dated citation in this repo is already stale:** `ARCHITECTURE.md:170` cites
  "IERS Bulletin C **2024**" as the leap-second source, while the newest bulletin
  today is **C 72** (and the table itself has not changed since 2017-01-01, so the
  data in `src/physics/time.ts` is still numerically correct — the *provenance
  reference* is what is wrong). `src/physics/time.ts:7` cites "IERS Bulletin C &
  IAU SOFA time standards" with no number or date at all. Both need a dated, versioned
  reference, which mission rule 3 requires for every constant.

## 3. Frames, orientation and nutation

| Source | URL | Date | Used for |
| :--- | :--- | :--- | :--- |
| Archinal et al., "Report of the IAU WG on Cartographic Coordinates and Rotational Elements: 2015", *CMDA* 130, art. 22 | `https://link.springer.com/article/10.1007/s10569-017-9805-5` | online 2018-02-23 | the current WGCCRE report (closed access) |
| Correction to that report, *CMDA* 131:61 | DOI `10.1007/s10569-019-9925-1`; open copy `https://elib.dlr.de/132218/` | 2019 | fixes a sign error in the node-RA figure and the Phobos W equation |
| WGCCRE 2009 report full text (USNO mirror) | `https://aa.usno.navy.mil/downloads/reports/Archinaletal2011a.pdf` | 2011 | convention definitions that are still identical |
| `pck00011.tpc` | `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc` | 2022-12-27 | machine-readable constants; names its own references |
| NAIF PCK Required Reading | `https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html` | 2022-01-03 | rotation matrix form |
| IAU 2006 Resolutions B1 and B2 | `https://www.iers.org/.../IAU2006_Resolution_B1.pdf` (and `_B2`) | 2006 | P03 precession; CIO/TIO |
| IERS Conventions (2010), Technical Note No. 36 | `https://iers-conventions.obspm.fr/content/tn36.pdf` | 2010 | transformation chain, constants |
| IERS Conventions status page | `https://www.iers.org/iers/en/dataproducts/conventions/conventions` | current | editions that officially exist |
| ICRF3 page (IERS) | `https://www.iers.org/iers/en/dataproducts/icrf/icrf3/icrf3` | current | reference-frame realisation |
| IAU 2015 Resolution B3 (nominal constants) | `https://www.iau.org/common/Uploaded%20files/IAUGA2015-Resolution-B3-recommended-nominal-conversion.pdf` | 2015 | nominal GM/radii/luminosity |
| Prša et al., *AJ* 152, 41 | DOI `10.3847/0004-6256/152/2/41` | 2016-08-01 | companion paper to B3 |
| IERS `finals2000A.all` | `https://datacenter.iers.org/data/9/finals2000A.all` | live, 2026 data | EOP that cannot be hard-coded |
| IAU SOFA | `https://www.iausofa.org/` | current | reference implementation |

Confirmed:

- **The 2015 WGCCRE report is still the newest published report.** No 2020/2024/2025
  journal report exists as of today (a 2020 ISPRS conference paper, CC BY 4.0,
  explicitly calls 2018 "our most recent published report"). The repo's citation of
  the 2015/2018 report is therefore correct and should be kept.
- **`pck00011.tpc` implements the 2015 report as corrected by the 2019 erratum**,
  with the Moon and Earth taken from the 2009 report. That is a precise provenance
  statement the repo should carry in `src/data/` instead of the current vaguer notes.
  There is also a `pck00011_n0066.tpc` variant differing only in a truncated Phobos
  phase polynomial for Toolkit ≤ N0066 — relevant because the repo's Phobos quadratic
  term is asserted in `tests/nutation.test.ts`.
- **Conventions to implement:** pole RA/Dec in ICRF with the north pole on the north
  side of the invariable plane; W measured easterly from the node Q whose RA is
  90° + α₀; epochs in Julian centuries or days from JD 2451545.0 **TDB**; the NAIF
  matrix form is the product `[W]₃·[90°−δ]₁·[90°+α]₃`; satellite orientation adds
  sinusoidal terms in RA, Dec and W driven by "nutation-precession angles".
  Pluto's 0° meridian points at the mean sub-Charon direction and Charon's at the
  mean sub-Pluto direction; the Jovian inner satellites use the sub-Jovian direction.
  Planetographic longitude is west-positive for direct rotation (IAU 1970, 14th GA);
  planetocentric is always east-positive. `BODYnnn_LONG_AXIS` is deprecated. NAIF
  cautions that the built-in IAU_EARTH model carries a prime-meridian error of at
  least 150 arcseconds and that binary Earth PCKs should be used instead — directly
  relevant to the Earth-orientation claims in `ARCHITECTURE.md`.
- **Nutation/precession:** IAU 2006 **Resolution B1** adopted the P03 precession
  formula (Capitaine et al. 2003, *A&A* 412, 567), replacing the precession part of
  IAU 2000A; the combination is usually called IAU 2006/2000A, with IAU 2000B as the
  1 mas abridged nutation. My earlier expectation of "Resolution B2" being the
  precession one was wrong: **B2** is the supplement on reference systems that
  introduces the CIO/TIO. The current Conventions edition is **IERS Technical Note
  No. 36, "IERS Conventions (2010)"**; IERS lists TN39 (2017) as the highest number
  and **there is no TN40**, with official editions only 1996/2003/2010 and newer text
  circulating as an unofficial working version. Any doc that says "IERS Conventions
  (2019)" or similar must be corrected.
- **Frames:** the ICRF realisation is **ICRF3** and IERS's own documentation reference
  is **Charlot et al. 2020, *A&A* 644, A159, DOI 10.1051/0004-6361/202038368**.
  Checked against this repo: `ARCHITECTURE.md:162` already cites exactly that paper,
  so **the citation is correct and needs no change** — my earlier suspicion that the
  repo cited an older 2018 *A&A* 620 L2 notice was wrong; no such citation exists
  here (`grep ICRF|Charlot` finds only the correct one, plus `ICRF` used as a frame
  label in `README.md:52,135,218`). No ICRF4 exists. J2000.0 = 2000 Jan 1.5
  **TT** = JD 2451545.0 TT (IAU 1994 Res. C7). The ITRS→GCRS chain is
  `B(t₀)·R(t)·W(t)·Q(t)`: Q (precession-nutation) and B (frame bias) are hard-codable;
  **R (sidereal time / CIO), W (polar motion), residual nutation ΔX̂ ΔŶ, dψ dε, and
  UT1−UTC must come from live IERS EOP** and cannot be legitimately baked into data
  files. `finals2000A.all` is confirmed reachable and carries 2026 data.
- **Nominal constants** (IAU 2015 Res. B3, confirmed): solar GM 1.3271244e20 m³/s²,
  R☉ 6.957e8 m, L☉ 3.828e26 W, T_eff 5772 K, TSI 1361 W/m²; Earth equatorial
  6378.1 km / polar 6356.8 km, GM 3.986004e14; Jupiter equatorial 71492 km / polar
  66854 km, GM 1.2668653e17. Useful as the citation behind the radius/GM literals
  flagged in AUDIT-25.

## 4. Integrators and force models

| Source | URL | Date | Used for |
| :--- | :--- | :--- | :--- |
| Rein & Spiegel 2015, *MNRAS* 446, 1424 (IAS15) | `https://ui.adsabs.harvard.edu/abs/2015MNRAS.446.1424R/abstract` | 2015 | the reference integrator |
| ASSIST repository and README | `https://github.com/matthewholman/assist` | badge **v1.2.0** | ephemeris-quality N-body with the force set §4 needs |
| ASSIST forces documentation | `https://raw.githubusercontent.com/matthewholman/assist/main/docs/forces.md` | current | which forces are on by default |
| ASSIST ephemeris module | `https://raw.githubusercontent.com/matthewholman/assist/main/assist/ephem.py` | current | the perturber enumeration (below) |
| ASSIST data locations | `https://raw.githubusercontent.com/matthewholman/assist/main/data/readme.txt` | current | exact kernel URLs to fetch |
| REBOUND | `https://rebound.hanno-rein.de/` | current | framework, integrator options |
| JPL small-body perturber set | `https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/` | files dated 2021-03-31 / 2021-09-02 | the asteroid kernels themselves |
| Perturber specification PDF | `SB441_IOM392R-21-005_perturbers.pdf` in that directory, 970 KB | 2021-06-22 | mass assignment rules (not yet read — §6) |

**The asteroid perturber list — the thing the mission forbids guessing.** ASSIST
integrates "the Sun, Moon, planets, and 16 massive asteroids", with masses and
positions from JPL **DE441** and its associated asteroid file `sb441-n16.bsp`
(`README.md`, `docs/forces.md`). The enumeration, read directly from
`assist/ephem.py` (index → name), is:

| Index | Asteroid | | Index | Asteroid |
| ---: | :--- | --- | ---: | :--- |
| 11 | Camilla | | 19 | Interamnia |
| 12 | Ceres | | 20 | Iris |
| 13 | Cybele | | 21 | Juno |
| 14 | Davida | | 22 | Pallas |
| 15 | Eunomia | | 23 | Psyche |
| 16 | Euphrosyne | | 24 | Sylvia |
| 17 | Europa | | 25 | Thisbe |
| 18 | Hygiea | | 26 | Vesta |

Note that these are *kernel slot indices*, not official minor-planet numbers
(1 Ceres, 2 Pallas, 4 Vesta…), and the repo currently carries only 4 asteroids
(`src/data/asteroids/`: Ceres, Pallas, Vesta, Hygiea). Kernels:
`https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de440.bsp` and
`https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/sb441-n16.bsp`
(615.8 MB), with a 373-asteroid variant `sb441-n373.bsp` (14.13 GB) and a small
`sb441-n373s.bsp` (936.6 MB).

Other confirmed ASSIST behaviour relevant to force-model design: harmonics and
general relativity are included, and **by default only the Sun is treated
relativistically**, with the docs noting that other bodies' 1PN terms matter during
close encounters; constants (AU, EMRAT, J2E, J3E, J4E, J2SUN, RE, CLIGHT, ASUN) are
unified onto one ephemeris object and used consistently — which is precisely the
single-source-of-truth pattern AUDIT-24…27 says this repo lacks. Non-gravitational
effects follow the Marsden (1973) model. The README asserts the equations of motion
were verified term-by-term against JPL's small-body integrator to machine precision.

**Nothing published comparing an ASSIST/REBOUND integration against a DE ephemeris
at +1/+10/+50 year horizons with per-planet km errors was found in this pass.** So
the mission's §7 target table must start from a measurement I make myself; see §6
and §7.

## 5. Toolchain versions

Queried from the npm registry on **2026-11-04** (`/latest` dist-tag), compared with
`package.json`:

| Package | Repo constraint | Latest today | Gap |
| :--- | :--- | :--- | :--- |
| three | `^0.186.1` | **0.187.0** | one minor behind |
| vite | `^8.3.0` | **8.3.5** | patch behind |
| typescript | `~6.0.2` | **7.0.2** | **major behind — pinned to the 6.x line** |
| vitest | `^5.0.3` | **5.1.0** | one minor behind |
| playwright | `^1.63.0` | **1.64.1** | behind, and unused in CI (AUDIT-40) |
| fast-check | not installed | 4.10.2 | needed for §6 property tests |
| zod | not installed | 4.6.7 | needed for the worker protocol (AUDIT-12) |
| dependency-cruiser | not installed | 18.7.2 | candidate for the boundary check |
| eslint | not installed | 10.14.0 | needed for the missing lint gate (AUDIT-37) |
| eslint-plugin-boundaries | not installed | 7.4.1 | candidate for §2.1 layer enforcement |

The TypeScript 7 jump is the notable one: `~6.0.2` deliberately blocks the major
line, and `erasableSyntaxOnly`/`verbatimModuleSyntax` are already set, which makes a
6→7 migration plausible but definitely a *separate concern* commit, not a side effect.

## 6. Unverified and open items

Recorded instead of guessed, per mission rule 3 and rule 6.

1. **DE443/DE444 do not exist** anywhere I looked; their existence is unverified and
   must not be mentioned in docs.
2. **No formal "DE442 supersedes DE440" statement** from NAIF/JPL was found; the
   directory has no DE442 announcement entry. DE442 is newest by date/number, which
   is what I can honestly claim.
3. **No published statement on how far outside coverage extrapolation is meaningful.**
   Only start/stop epochs are documented. So §5's "time-travel limits explained" must
   cite the coverage window itself, not an invented safety margin.
4. **Kernel checksums are MD5 only** (`aa_checksums.txt`); no SHA-256 or signature is
   published. The repo's SHA-256 `provenance.json` is therefore a *local* integrity
   record, not a comparison against an official digest, and must be described that way.
5. The SPICE metadata fields I expected (`VERSION=`, `POOL_RECORD_SEGMENT_START=`,
   `INPUT_DATA_SET_NAME=`) were **not found** in `pck00011.tpc`, `gm_de440.tpc` or
   `naif0012.tls`. Treat them as unverified for text kernels; use the real header
   text (author/date/source lines) for provenance instead.
6. **USGS/IAU Planetographic Info Sheets** could not be fetched (bot challenge on
   usgs.gov and astrogeology.usgs.gov). Their precedence relative to the 2015 report
   is unconfirmed.
7. The **"inner Lagrangian point"** phrasing for Jupiter/Saturn regular-satellite
   models is unconfirmed; the reachable text says "sub-Jovian direction".
8. **CGPM 2022 leap-second cessation after 2035** — resolution number, wording and
   the latest ITU-R/CCRRS status not confirmed in this pass.
9. **TT = TAI + 32.184 s, the TDB−TT periodic coefficients, L_G and L_D** — the
   constants are standard but I did **not** capture the primary page for each in this
   pass, so they are currently `// UNVERIFIED` for code-comment purposes until I fetch
   TN36/IAU Res. 3 text directly. Not to be hard-coded before that.
10. **`SB441_IOM392R-21-005_perturbers.pdf`** could not be parsed (binary extraction
    failed). The 16-name list above comes from ASSIST's source; the *mass assignment*
    rules still need reading from this PDF.
11. **No third-party CSPICE-WASM build is maintained against N0067.** Confirmed
    candidates: `webspice` (npm 0.0.2, 2023-02-09, MIT, unofficial Emscripten port,
    gitlab.com/afeder/webspice), `timecraftjs` (npm 2.0.0, Apache-2.0, NASA-AMMOS,
    repo last pushed 2024-01-19), `cspice-wasm` (npm 0.0.0, published 2026-07-11,
    single release), `RustSPICE` (CC0-1.0, v1.0.0 2025-08-01). None tracks the toolkit
    automatically, so the mission's "verified SPICE library" option realistically
    means **my own Chebyshev SPK reader tested against CSPICE output**, per §4's
    format sources above.
12. **Redistribution constraint found:** NAIF prohibits redistributing the unmodified
    Toolkit from mirrors without written clearance, while bundling it inside a
    customer-built tool is explicitly fine, and the PCK file itself invites modification
    on condition you update the by-line, date and filename. My `ATTRIBUTION.md`-style
    provenance must therefore record: file name, source URL, fetch date, digest, and
    whether the file was modified. **Legal status of the `.bsp` data kernels
    themselves is not confirmed** — flagged before any of them is committed.

## 7. What this changes in the repo

Concrete, sourced corrections to make in later steps (each its own commit):

1. **DE441 claims are wrong** (README badge, §1 body, `ARCHITECTURE.md`, HEAD commit
   message). Replace with: DE440 as the modern whole-system reference, DE441 as the
   long-span historical solution, DE442 noted as newest with its Uranus-driven purpose.
   Until an SPK reader exists, the app must not claim to read DE441.
2. **Add kernel coverage windows as data, not prose:** DE440/DE442
   1549-12-31 → 2650-01-25; DE440s/DE442s 1849-12-26 → 2150-01-22; DE441 −13201 →
   +17191. Put them in `src/data/spice/provenance.json` and enforce them as the
   time-travel limits mission §5 asks for.
3. **Record `pck00011.tpc` provenance precisely**: 2015 WGCCRE report + 2019
   correction, Moon/Earth from the 2009 report, dated 2022-12-27 — replaces the current
   loose "(NAIF IAU WGCCRE, Dec 2022)" in `src/data/nutation.ts`.
4. **Time-scale provenance:** replace the undated `IERS Bulletin C` reference in
   `src/physics/time.ts:7` and the stale `Bulletin C 2024` in `ARCHITECTURE.md:170`
   with the actual current bulletin (**C 72**, accessed 2026-11-04) plus the table
   source URL and its last row (2017-01-01, TAI−UTC = 37 s). Record the
   January/July polling procedure. The ICRF3 citation in `ARCHITECTURE.md:162` is
   already correct (Charlot et al. 2020, *A&A* 644, A159) — **do not "fix" it**; any
   change to IERS Conventions wording should name **TN36 (2010)**, the current edition.
5. **Expand asteroid perturbers from 4 to the documented 16**, citing ASSIST v1.2.0
   `assist/ephem.py` and `sb441-n16.bsp`; keep the index-vs-number distinction
   explicit so nobody maps slot 12 to asteroid 12.
6. **IAS15 becomes reachable**: — **done 2026-11-08**: `ias15` accepted by
   `PhysicsConfig`/`protocol.ts`/`simCore.ts` (flat) and via `HierarchicalIAS15`
   (hierarchical) with a UI select entry; evidence in VALIDATION_LOG step 17. The
   §4 +1/+10/+50 year table is still to be re-measured with it selected.
7. **Relativity default matches the cited practice:** Sun-only 1PN by default, with a
   documented option for other bodies near encounters.
8. **Toolchain decisions as separate commits:** TypeScript 6→7, three 0.186→0.187,
   vitest 5.0→5.1, plus adding eslint + a boundary checker and zod/fast-check.
9. **Do not commit `.bsp` kernels** (615 MB+) and do not claim SHA-256 provenance for
   them beyond a locally computed digest; resolve §6 item 12 first.
10. **Leap-second handling:** 37 s today, last change 2017-01-01, Bulletin C 72, LSK
    `naif0012.tls` guaranteed current to at least 2027-07-01. Document the January/
    July polling procedure and add a test that fails if the table predates a newer
    Bulletin C.

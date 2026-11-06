# Changelog

How to read this file:

- This project publishes **no versioned releases**. The commit hash is the only
  release identifier, and `docs/VALIDATION_LOG.md` records which commands were
  actually executed against which tree.
- Every number below is copied from a recorded command output, a test assertion,
  or a primary source. Nothing here is an estimate, and none of it means the
  software is certified, flight-rated, or NASA-approved (see
  [`NASA_COMPLIANCE.md`](./docs/NASA_COMPLIANCE.md)).
- The tag **`baseline-pre-audit`** (`9a2e872`, 2026-11-04) marks where the
  assurance pass started; the 50 commits after it are summarized below.

---

## Unreleased — assurance pass (2026-11-04 → 2026-11-06)

### Fixed — orbital and frame correctness

| Change | Commits | Evidence |
| :--- | :--- | :--- |
| The simulation's ecliptic plane is realized with the IAU 76/80 obliquity that JPL Horizons uses, not the IAU 2006 value. The mismatch put ICRS-derived quantities 0.042″ off the orbital frame — 526 km at Uranus. | `9fd4922` | `tests/validation/spk-real.test.ts` against the MD5-verified `de440.bsp` |
| Ephemeris anchors are bracketed per body instead of by one shared date bracket, which had silently frozen five bodies (Sun + outer planets) at their epoch vector: Jupiter was off by 7.3e+8 km at +700 d, now 8.2e-2 km. | `b8f21d2` | VALIDATION_LOG step 7 |
| Fine anchors now win inside their own span; a coarse velocity-free anchor was overriding them (Earth 3.09e+5 km at +365 d, now 1.83e-1 km). | `e92467f` | VALIDATION_LOG step 7b |
| Live Horizons anchors extend each body's interpolation track rather than the whole table's, so one live query cannot widen coverage for bodies it did not sample. | `a7ccbab` | `tests/ephemeris.test.ts`, browser coverage audit |
| Date↔JD conversion runs through the full UTC→TAI→TT→TDB chain in both directions; the fixed TDB−UTC shortcut that ignored the leap-second table is gone. | `5775d66` | `tests/time.test.ts` |

### Added — capability

| Change | Commits | Evidence |
| :--- | :--- | :--- |
| Read-only DAF/SPK type 2/3 Chebyshev reader, validated against NAIF's MD5-verified DE kernels to 2.4e-4 m position and 7.1e-8 mm/s velocity. It is an assurance and reference path; no runtime feature computes ephemerides through it. | `2cee26a`, `0d9743c` | `tests/validation/spk-real.test.ts`, `npm run verify:spk` |
| Runtime observability: structured logger, per-module health registry, and energy / angular-momentum / barycenter invariant checks propagated to the UI readout. | `5bd7389`, `47d7fa0` | `tests/observability.test.ts`, `tests/invariants.test.ts` |
| Deterministic state snapshots: canonical little-endian serialization with SHA-256 hashing and a validating restore loader that rejects epoch, body-order, length, finiteness and mass mismatch. | `04ff903` | `tests/snapshot.test.ts`, `tests/simclient.test.ts` |
| Ephemeris mode is hard-gated to the measured dense coverage window (−365…+724 d from the anchor epoch), shown in the panel and enforced on seeks, mode switches, playback and the date picker. | `cd614ba`, `0512753`, `6649aba` | browser audit checks "ephemeris date picker exposes measured bounds" and the two clamp checks |
| Official DE kernel provenance records (size, MD5, coverage, `Last-Modified`) and per-kernel acceptance tolerances, so a DE441↔DE442 solution difference is no longer reported as a reader defect. | `de30914` | `src/data/spice/de-kernel-provenance.json` |
| Current time-standard provenance: IERS Bulletin C 72, the 37 s TAI−UTC state, and BIPM Resolution 5 continuous-UTC policy effective 2027-05-20. | `06edbf4` | `LEAP_SECOND_PROVENANCE` in `src/physics/time.ts` |
| Full-browser UI audit harness, wired into CI as a dedicated job that builds the production bundle and audits the preview. | `a7ef4e4`, `30b92ca`, `90f1520`, `952b238` | `npm run audit:ui`, `docs/UI_AUDIT.md` |

### Changed — simulated scope

- **36 → 48 gravitating bodies.** The massive-asteroid perturber set went from 4 to
  the complete JPL `SB441-N16`/ASSIST list of 16 (`1c7d76f`). Measured over 20 years
  against the previous 4-asteroid system, the 12 added masses move Earth 1.051 km,
  Mars 2.111 km, Jupiter 5.682 km and Saturn 1.827 km
  (`tests/perturber-impact.test.ts`).
- Depended-upon tooling updated to current: Three.js 0.187, Vite 8.3.6, Playwright
  1.65, Vitest 5.1, ESLint 10, TypeScript held at 6.0 because types-eslint does not yet
  support the TypeScript 7 compiler API (`c7e7766`).

### Fixed — user interface and UX

| Change | Commits |
| :--- | :--- |
| Every visible control has an accessible name; the readout is announced through a live region; a throwing render frame no longer kills the animation loop; hidden controls and collapsed panels are exercised instead of skipped. | `50eb3b8`, `55a9476`, `30b92ca` |
| The live-sync button no longer reports success when Horizons was unreachable — it now distinguishes "Horizons synced", "local DE440 (live unavailable)" and "sync failed, state unchanged". The facts card keeps a persistent close control instead of losing it on the next telemetry frame. | `fc7f622` |
| Out-of-window ephemeris dates are clamped and the clamp is announced, instead of quietly presenting extrapolated positions as truth. | `0512753`, `6649aba` |

### Testing, CI and process

- Import-boundary guard extended to the `universe` layer, which exposed a
  physics→universe cycle; `AU_PER_PARSEC` moved to the data layer (`107520c`, `fdf49ac`).
- One-source-of-truth enforcement for physical constants, with a duplicate-literal
  boundary test (`8850cfb`).
- ESLint and V8 coverage added to the verification path (`930b3cd`); the first lint run
  found 37 real errors.
- Chained date seeks now make bounded progress instead of freezing the page for minutes
  (`tests/seek.test.ts`).

### Documentation

- Retracted: the "NASA NPR 7150.2D compliance / 100% GREEN (79 suites, 503 tests)"
  status, a pasted Vitest block no run ever produced, all "flight grade" stamps, and
  the DE441-as-newest and stale-Bulletin-C claims (`eb2e129`, `dce8000`, step 1 docs).
- Added: `docs/RESEARCH.md` (primary sources), `docs/AUDIT.md` (findings with
  severities), `docs/VALIDATION_LOG.md` (measured command output),
  `docs/OPEN_QUESTIONS.md` (unverified items), `docs/UI_AUDIT.md`.

---

## Baseline and earlier

Development history before the assurance pass, by phase (`git log` is authoritative):

| Range | Content |
| :--- | :--- |
| `23dd4a9` | Phase 0 foundation: layered architecture, pure physics core, Web Worker split |
| `94d16f5`, `aca20ff` | Phase 1 / 1.5: Sun–Jupiter barycentric N-body, reference frames, history-based trails |
| `cef2b8b` | Phase 2: Horizons-sourced planetary data, 8 planets, worker protocol |
| `c578503`, `90b6156` | Phase 3: Yoshida-4 symplectic integration, 1PN relativity, solar J2, fixed accumulator, Hermite display |
| `ec081da`, `c44a08f` | Phase 4: procedural planet textures, IAU axial tilts, rings, starfield |
| `256b98d` | Phase 5: hierarchical multi-rate moon systems |
| `21cad4e` | Phase 6: particles, Pluto–Charon, real stars, galactic potential, eclipses |
| `f927d1b`…`1e2daa3` | Galaxy mode, CMB rest frame, named galactic models, dual ephemeris mode, Oort cloud |
| `b24b7d3`…`9a2e872` | Rendering fixes and the third-party texture set with CC-BY attribution |

The pre-audit documentation in that range contained the claims the assurance pass
retracted; treat commit subjects, not old prose, as the record of what was built.

# Validation log

Every number in this file is copied from a command that was actually run on this
machine. No result here is estimated, remembered, or inferred.

Conventions used by this log:

- Each entry records: date (local), commit under test, working-tree state, exact
  command, and the real output (trimmed only where noted).
- A `BASELINE` entry is a measurement taken before any code change, and is the
  reference point for later regressions.
- Claims that could not be reproduced are collected under
  [Unverified claims](#unverified-claims-cannot-be-reproduced-from-this-repo) and
  tracked in [AUDIT.md](./AUDIT.md); `docs/OPEN_QUESTIONS.md` is not yet created
  (mission step 1 produces only this log and the audit).

---

## 2026-11-04 — BASELINE: pre-change toolchain and test state

### Environment

| Item | Observed |
| :--- | :--- |
| `node -v` | `v27.0.0-alpha.0.0.0` |
| `npm -v` | `12.1.0` |
| `npx --no-install tsc --version` | `Version 6.0.3` |
| `npx --no-install vitest --version` | `vitest/5.0.3 win32-x64 node-v27.0.0-alpha.0.0.0` |
| `npx --no-install vite --version` | `vite/8.3.3 win32-x64 node-v27.0.0-alpha.0.0.0` |
| Platform | win32, x64 |
| HEAD commit | `8391eaf8429d477ae58bdc5291460478a34d022b` |
| HEAD subject | `feat(nasa): add NASA JPL Horizons DE441 live integration and NASA Eyes connection` |
| HEAD author date | `Wed Oct 7 12:00:47 2026 +0530` |

### Working tree at the time of this baseline

`git status --short` reported **170 entries**: **78 modified** and **92 untracked**.

The untracked set includes entire directories that the test suite depends on:
`.github/`, `docs/`, `LICENSE`, `CITATION.cff`, `public/textures/`, `src/universe/`,
`src/physics/light/`, `src/data/spice/`, `src/data/asteroids/`, and 30 of the 82
test files (`tests/ias15.test.ts`, `tests/production-truth.test.ts`,
`tests/spice-truth.test.ts`, `tests/time.test.ts`, …).

Consequence, stated plainly: **the measurements below describe an uncommitted
tree.** They are not reproducible from `8391eaf`, and no later step in this
program can claim a clean before/after comparison until this work is committed.
This is tracked as finding `AUDIT-01` in [AUDIT.md](./AUDIT.md).

### `npm run typecheck`

Command: `npm run typecheck` (resolves to `tsc --noEmit`)

```
npm notice run astrion@1.0.0 typecheck
npm notice run tsc --noEmit
```

Exit code `0`. No diagnostics emitted.

**Result: PASS — 0 type errors** under `strict`, `noUncheckedIndexedAccess`,
`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`,
`noFallthroughCasesInSwitch` (`exactOptionalPropertyTypes` is **not** enabled;
see AUDIT-14).

### `npm test`

Command: `npm test` (resolves to `vitest run`)

```
 Test Files  82 passed (82)
      Tests  530 passed (530)
   Start at  22:04:08
   Duration  49.49s (tests 94%, transform 3%, import 3%)

    Isolate  82 workers spawned · ~176ms startup each (spawn + environment, per file)
             at least ~4.62s faster with isolate: false — reuses workers across files instead of one per file
```

Exit code `0`. **Result: PASS — 82 test files, 530 tests, 0 failed, 49.49 s.**

Slowest suites observed in the same run:

| Suite | Duration | Note |
| :--- | :--- | :--- |
| `tests/seek.test.ts` | 46,027 ms | 2 tests, both >11 s: "one message makes bounded progress" 11,717 ms and "chained seeks land exactly on a 600-day target" 34,304 ms |
| remaining 81 suites | < 500 ms total | most are 3–25 ms |

`tests/seek.test.ts` alone accounts for 93 % of the wall-clock test time
(46.0 s of 49.5 s). This is the CI budget risk recorded as AUDIT-44.

### `npm run build`

Command: `npm run build` (resolves to `tsc --noEmit && vite build`)

```
npm notice run astrion@1.0.0 build
npm notice run tsc --noEmit && vite build
vite v8.3.3 building client environment for production...
transforming...
✓ 153 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                             0.88 kB │ gzip:   0.52 kB
dist/assets/physics.worker-jD-hgfXH.js     60.42 kB
dist/assets/index-CUBeKWQ1.css              6.60 kB │ gzip:   2.23 kB
dist/assets/index-D8oFZl7z.js           1,255.63 kB │ gzip: 390.46 kB

✓ built in 566ms
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

Exit code `0`. **Result: PASS**, with a chunk-size warning: one
1,255.63 kB (390.46 kB gzipped) main bundle and no code splitting. Recorded as
AUDIT-49.

### `npm run lint`

**Not runnable — the script does not exist.** `package.json` defines no `lint`
script and the repo has no ESLint or Biome configuration file (only
`.prettierrc` and a `format` script that CI never runs). This is AUDIT-37 and it
means mission section 1.e ("run `npm run lint`") cannot be satisfied as written.

### Coverage

**Not measured.** No `--coverage` flag, no `coverage` block in `vite.config.ts`,
no coverage step in `.github/workflows/ci.yml`. Therefore the mission's "physics
and frames ≥ 90 % lines/branches" target currently has **no baseline number at
all**; it is not "failing", it is unknown. This is AUDIT-38 and must be measured
before any coverage gate is added.

### Baseline summary

| Check | Result | Number |
| :--- | :--- | :--- |
| `npm run typecheck` | PASS | 0 errors |
| `npm test` | PASS | 82 files / 530 tests / 0 failures / 49.49 s |
| `npm run build` | PASS | main bundle 1,255.63 kB (390.46 kB gz) |
| `npm run lint` | NOT AVAILABLE | no lint script exists |
| coverage | NOT MEASURED | no coverage tooling configured |
| working tree | DIRTY | 78 modified + 92 untracked paths |

---

## Unverified claims — cannot be reproduced from this repo

The repository's own documentation states specific accuracy numbers. The commands
above did **not** produce any of them, and grepping the source and tests does not
yield the values or an assertion that would compute them. They are listed here so
that no later step mistakes them for measurements. Each is cross-referenced in
[AUDIT.md](./AUDIT.md) (findings AUDIT-17 … AUDIT-23, AUDIT-27 and AUDIT-28).

| Claim in docs | Where | Why it is unverified |
| :--- | :--- | :--- |
| "Earth error < 100 km; outer planets < 1 km → **PASS (56 km)**" | `README.md:181` | The nearest assertion is `tests/production-truth.test.ts:82` `expect(errAu, ...).toBeLessThan(1e-3)` — a **150,000 km** bound, not 100 km or 1 km. The string `56` appears nowhere in the repo as a measured value. |
| eclipse timing "**PASS (1.19 min)**" | `README.md:186` | `tests/eclipses.test.ts:114` asserts `toBeLessThan(20)` minutes. Neither 1.19 nor 2.35 is computed or stored. |
| eclipse "timing error of only **2.35 minutes**" | `ARCHITECTURE.md:97` | Same as above, and it **contradicts** the README's 1.19 min for the same event. |
| "Solar SSB wobble magnitude **788,469 km** at 11.4 m/s" | `README.md:189` | `tests/spice-truth.test.ts:87-88` only asserts `toBeGreaterThan(1e-4)` / `(1e-6)`. The literal `788,469` exists only in the README. |
| "**77 test suites and 497 … tests**" | `README.md:177` | Measured: **82 files / 530 tests**. The same README also says "79 suites / 503 passed" at `README.md:9` and "79 suites, 503 tests" at `README.md:271` — three mutually inconsistent counts, none matching reality. |
| "**100% GREEN (79 Test Suites, 503 Automated Verification Tests Passing)**" | `docs/NASA_COMPLIANCE.md:5` | Same mismatch, and it is presented next to a fabricated-looking Vitest output block (`NASA_COMPLIANCE.md:63-65`) claiming `Test Files 79 passed (79)` and `Duration 45.57s`, which no run in this log produced. |
| "Native IAS15 (15th-order Radau) + Prince-Dormand RK8(9)" as part of the engine | `docs/NASA_COMPLIANCE.md:15` | `src/physics/integrators/ias15.ts`, `rk89.ts` and `compensated.ts` exist but are **imported by no runtime module** (verified by grep across `src/`: only self-references). The selectable integrators are `leapfrog / yoshida4 / yoshida6 / yoshida8 / truth8` (`src/sim/protocol.ts:18`, `src/ui/panel.ts:43`). |
| `c = 173.1446326846693 AU/day` | `README.md:100` | Computed from `src/data/constants.ts:27`, the code yields `173.14463267424031`; `src/physics/light/lightTime.ts:17` comments the same `…67424`. The README digits are wrong at the 1e-8 level. |
| "158 globular clusters" | `README.md:230` | Matches the default in `src/render/galaxyVisual.ts:226` but no Harris catalogue file or citation is present in the repo. |

## Scientific-accuracy baseline — what actually exists today

Mission section 4 asks for a baseline of real errors against JPL before setting
targets. The honest statement of the current baseline, from the run above:

- **Ephemeris accuracy vs SPICE/Horizons: not established as a number.**
  `tests/spice-truth.test.ts` validates cached kernel text (`gm_de440.tpc`,
  `pck00010.tpc`, `pck00011.tpc`) against SHA-256 digests recorded in
  `src/data/spice/provenance.json`, and pins body GMs to the kernel at 1e-12.
  That is a *provenance and consistency* check, not a position comparison: no
  SPK binary kernel is present, so there is no Chebyshev SPK-vs-CSPICE position
  difference in km to report. The "well below 1 km" target therefore starts from
  **no measured value**, not from a failing one.
- **N-body vs DE error at +1/+10/+50 years: not measured per body.** The existing
  comparison (`tests/production-truth.test.ts`) checks barycenters at +1 yr
  against a cached Horizons reference with a 1e-3 AU (149,598 km) bound. No
  per-planet error table, and nothing at +10 or +50 years, exists in the suite.
- **Time scales:** `tests/time.test.ts` (8 tests) passes; the UTC/TAI/TT/TDB
  conversion behaviour is exercised, but no leap-second table provenance or
  update procedure is recorded in the repo, so its currency as of today is
  unverified.
- **Eclipses:** `tests/eclipses.test.ts` (its assertions are loose: 1.00 deg
  separation, 20 min timing) passes; no seconds-level error against the NASA
  eclipse catalogue is recorded.

These four gaps are the actual starting point for mission section 4, and the
reason the next step is measurement, not tuning.

---

## 2026-11-04 — Third-party texture asset verification

Run before committing `public/textures/`, to satisfy the attribution condition
for redistributing Solar System Scope files.

### License check

Source page: `https://www.solarsystemscope.com/textures/`, accessed 2026-11-04.
The page states, verbatim: *"Distributed under Attribution 4.0 International
license: You may use, adapt, and share these textures for any purpose, even
commercially."* — i.e. CC BY 4.0, redistribution permitted **with attribution**.
Condition satisfied, so the files are committable. Attribution is recorded in
`public/textures/ATTRIBUTION.md` and `README.md` §7.1.

### Command 1: existing manifest test

Command: `npx --no-install vitest run tests/textures-manifest.test.ts`

```
 RUN  v5.0.3 D:/code/Main_projects/universe/solar-system

 ✓ tests/textures-manifest.test.ts (10 tests) 15ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:35:38
   Duration  238ms (transform 40%, import 27%, tests 23%, worker 10%)
```

Exit code `0`. **Result: PASS — 10 tests.**

### Command 2: independent SHA-256 re-computation

Deliberately re-done outside the test suite, in Python, so the check does not
share code with the thing it verifies. Each file on disk was hashed and compared
to `manifest.json`.

```
manifest fetchedAtUtc: 2026-10-07T07:07:18.792Z
file                bytes status   sha256(match)
mercury.jpg        872555 OK       5a5c80607f643496...
venus.jpg          229696 OK       225012ad49117306...
earth.jpg          463087 OK       767ee1dc6eb38026...
moon.jpg          1053869 OK       2764ba6535ea0481...
mars.jpg           750547 OK       2d187f3e77a98eaa...
jupiter.jpg        498976 OK       b0f04d0053502526...
saturn.jpg         199916 OK       54a900ca9bf7ab62...
uranus.jpg          77751 OK       d15239d46f82d3ea...
neptune.jpg        241580 OK       cb42ea82709741d2...
---
files in manifest: 9 | mismatches: 0
untracked-by-manifest jpgs: []
```

**Result: PASS — 9/9 files match both byte length and SHA-256; 0 mismatches; no
extra JPEGs on disk that the manifest does not describe.**

### Modification status

`scripts/fetch-textures.mjs:39` writes the raw response buffer to disk
(`await writeFile(dest, buf)`) and `:62` hashes that same buffer, so the on-disk
files are the provider's originals, unresized and unmodified. Only the local
filenames were shortened (`2k_mars.jpg` → `mars.jpg`); the mapping is in
`manifest.json`.

### Honest-character of the assets

These are artistically rendered equirectangular maps, **not** spacecraft imagery
or measured albedo data. Verified that nothing physical reads them:
`src/physics/forces/srp.ts` contains no reference to textures, maps or albedo
grep hits — its radiation-pressure model is computed, not sampled from pixels.
`src/render/bodyVisual.ts:194` and `:271` confirm the procedural fallback the
attribution file claims ("procedural stays as fallback"), and
`src/render/textures.ts:796` already credits Solar System Scope.

Outstanding, deliberately **not** done in this step: mission condition 4 asks for
the UI to label these textures "Model (artistic, not measured imagery)". No
component named "Honesty Inspector" exists in the codebase (grep for
`Honesty|honesty` across `src/` and `README.md` returns nothing), and
`src/ui/panel.ts` contains no texture-related label at all — so there is
currently no place to attach that label. Recorded as a follow-up rather than
inventing a location for it.

---

## 2026-11-04 — BASELINE TAG: `baseline-pre-audit`

Context: the tree was committed as 14 area-grouped commits on branch
`nasa-grade-work`, then tagged `baseline-pre-audit`. Nothing was fixed to obtain
these numbers; this entry is the reference point for every later regression check.

### Tree-equality verification before tagging

Original working tree hashed file-by-file (321 files, `tests/images/` excluded by
your decision) and re-hashed after the commits:

```
snapshot files compared : 321
identical               : 318
CONTENT DIFFERED        : ['.gitignore', 'README.md', 'docs/VALIDATION_LOG.md']
vanished from disk       : []
NEW since snapshot      : ['public/textures/ATTRIBUTION.md']
```

All three differences and the one addition are the changes you asked for
(`.gitignore` += `tests/images/`; `README.md` §7.1 attribution; `ATTRIBUTION.md`;
this log). **No source or test file changed content** — mission rule "do not
change any code while committing" is verified by hash, not asserted.

`git diff baseline-pre-audit -- src tests scripts .github public index.html
package.json vite.config.ts tsconfig.json README.md docs/* LICENSE CITATION.cff`
returned empty output, so the measured worktree is identical to the tag.

### `npm run typecheck` on the tag

```
npm notice run astrion@1.0.0 typecheck
npm notice run tsc --noEmit
```

**Exit code 0. PASS — 0 errors.**

### `npm run lint` on the tag

```
npm error Missing script: "lint"
npm error
npm error Did you mean this?
npm error   npm link # Symlink a package folder
npm error
npm error To see a list of scripts, run:
npm error   npm run
```

**Exit code 1. FAIL — and the failure is structural, not a code defect:**
`package.json` defines no `lint` script and the repo has no ESLint/Biome config.
Mission §1.e cannot be satisfied until a linter is introduced (AUDIT-37). This is
recorded as a real failure rather than skipped.

### `npm test` on the tag

```
 Test Files  82 passed (82)
      Tests  530 passed (530)
   Start at  22:37:03
   Duration  45.03s (tests 95%, import 3%, transform 2%)

    Isolate  82 workers spawned · ~161ms startup each (spawn + environment, per file)
             at least ~4.23s faster with isolate: false — reuses workers across files instead of one per file
```

**Exit code 0. PASS — 82 files / 530 tests, 45.03 s.** Reproducible against the
earlier BASELINE entry (82 / 530; 49.49 s → 45.03 s is run-to-run timing noise,
test counts identical).

### `npm run build` on the tag

```
✓ 153 modules transformed.
dist/index.html                             0.88 kB │ gzip:   0.52 kB
dist/assets/physics.worker-jD-hgfXH.js     60.42 kB
dist/assets/index-CUBeKWQ1.css              6.60 kB │ gzip:   2.23 kB
dist/assets/index-D8oFZl7z.js           1,255.63 kB │ gzip: 390.46 kB

✓ built in 511ms
(!) Some chunks are larger than 500 kB after minification.
```

**Exit code 0. PASS**, identical bundle sizes to the BASELINE run
(1,255.63 kB / 390.46 kB gzipped), chunk-size warning still emitted (AUDIT-49).

### Coverage on the tag

Still **not measured** — no coverage tooling is configured (AUDIT-38), so there
is no number to report and no §6 threshold can be evaluated yet.

### Tag summary

| Check | Command | Exit | Real result |
| :--- | :--- | ---: | :--- |
| Typecheck | `npm run typecheck` | 0 | 0 errors |
| Lint | `npm run lint` | **1** | Missing script: "lint" |
| Tests | `npm test` | 0 | 82 files / 530 tests pass, 45.03 s |
| Build | `npm run build` | 0 | 1,255.63 kB bundle (390.46 kB gz), chunk warning |
| Coverage | — | — | not configured, no number |

Git references: branch `nasa-grade-work`, tag `baseline-pre-audit`, 14 commits on
top of `8391eaf8429d477ae58bdc5291460478a34d022b`. Commits are area-grouped, so
**individual intermediate commits are not independently green** — only this tag
is. That is a deliberate trade-off of grouping by layer instead of one atomic
snapshot, and it means `git bisect` across these 14 commits is not meaningful.

---

## 2026-11-04 — Step 2 (research): checks after adding docs/RESEARCH.md

Change under test: one new file, `docs/RESEARCH.md`. No source, test, data or
config file was modified, so this is a confirmation run rather than a new
baseline.

Commands and real output:

- `npm run typecheck` → **exit code 0** (no diagnostics).
- `npm test` → **exit code 0**

```
 Test Files  82 passed (82)
      Tests  530 passed (530)
   Duration  37.86s (tests 95%, import 3%, transform 2%)
```

Identical counts to the BASELINE and BASELINE TAG entries (82 / 530); duration
varied 49.49 s → 45.03 s → 37.86 s across the three runs, which is machine noise,
not a regression. `npm run lint` remains exit 1 (no lint script) and coverage
remains unmeasured — both unchanged by this step and still open as AUDIT-37/38.

Two facts from the research that change what the repo may legitimately claim,
recorded here because §0 rule 4 requires real evidence behind every number:

1. **DE441 is not the newest ephemeris.** `de442.bsp` (dated 2025-02-06) is newest
   in the NAIF directory, and DE441 is a two-part long-span historical solution
   rather than a DE440 successor. The README badge, README §1/§2/§2.5 and the HEAD
   commit message all present "DE440 / DE441" as current. Not yet corrected — that
   is step 4 work, and no code was changed during research.
2. **The asteroid perturber list is now sourced, not guessed.** ASSIST v1.2.0 uses
   the Sun, Moon, planets and **16 massive asteroids** from `sb441-n16.bsp`; the
   enumeration was read from `assist/ephem.py` (slot indices 11–26: Camilla, Ceres,
   Cybele, Davida, Eunomia, Euphrosyne, Europa, Hygiea, Interamnia, Iris, Juno,
   Pallas, Psyche, Sylvia, Thisbe, Vesta). This repo ships 4 asteroids, so the force
   model in mission §4 is incomplete by 12 bodies — a measured gap, not an opinion.
   Note these are kernel slot indices, not minor-planet numbers.

A negative result worth keeping: `ARCHITECTURE.md:162` already cites ICRF3
correctly (Charlot et al. 2020, *A&A* 644, A159), so that citation must not be
"fixed". What *is* wrong there is `ARCHITECTURE.md:170`, which cites
"IERS Bulletin C 2024" while the current bulletin is **C 72** — the table values
themselves are still correct (last leap second 2017-01-01, TAI−UTC = 37 s).

---

## 2026-11-04 — Step 3a: import-boundary guard and the cycle it hid

Two commits, ordered so each is green on its own:

1. `107520c` — `AU_PER_PARSEC` moved to the data layer; `src/physics/light/photometry.ts`
   and `src/universe/cosmicCoordinates.ts` now read it from `@/data/constants`. This
   removes the only upward import in the codebase (AUDIT-04).
2. `fdf49ac` — `tests/architecture.test.ts` now forbids `@/universe` in `physics`,
   `frames`, `sim` and `data`, and forbids `@/sim|render|ui` and `three` inside
   `universe` (AUDIT-05, the guard's blind spot).

### Test-first evidence

The widened guard was run **before** the fix and failed exactly as predicted, which
is what proves the old guard was blind rather than the code clean:

```
 × physics/ and frames/ never import three, DOM, or higher layers
   ✓ render/ never imports physics internals
   ✓ sim/ never imports render, ui or universe
   ✓ data/ imports nothing from other layers
   ✓ universe/ never imports sim, render or ui
AssertionError: src\physics\light\photometry.ts breaks layer rule
  /from ['"]@\/(render|ui|sim|frames|universe)/
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

### After the fix

- `npm run typecheck` → **exit 0**.
- `npx vitest run tests/architecture.test.ts tests/lightEngine.test.ts` →
  `Test Files 2 passed (2)`, `Tests 20 passed (20)` — the guard is green and the
  photometry module that consumed the constant still behaves.
- `npm test` → **exit 0**

```
 Test Files  82 passed (82)
      Tests  531 passed (531)
   Duration  38.81s (tests 95%, import 3%, transform 2%)
```

Test count rose 530 → **531**, the single new test being the `universe/` rule. No
previously passing test broke.

- `npm run build` → **exit 0**, `✓ built in 494ms`, worker chunk unchanged at
  `60.42 kB`.

### Still open in step 3

Lint (no script, AUDIT-37), coverage baseline (AUDIT-38), structured logger
(AUDIT-32), per-module health checks (AUDIT-36), `exactOptionalPropertyTypes`
(AUDIT-14), and barrels/public-API enforcement for AUDIT-06 — every module except
`physics/light` still lacks an `index.ts`, so deep imports remain legal.

---

## 2026-11-05 — Step 3b: lint and the first measured coverage baseline

Commit under test: `930b3cd` (`ci: add ESLint and measured coverage checks`).
Local environment remains Node `v27.0.0-alpha.0.0.0`, npm `12.1.0`; CI is configured
for Node 22, so these local numbers are not represented as CI results.

### Toolchain compatibility and clean install

The first dependency attempt failed with `ERESOLVE` because
`typescript-eslint@8.56.1` declares `typescript >=4.8.4 <6.0.0`, while this
repository uses TypeScript 6.0.3. No peer-dependency override or force flag was
used. The committed toolchain uses `typescript-eslint@8.72.1`, whose declared
range is `>=4.8.4 <6.1.0`, plus ESLint 10.14.0 and matching Vitest/coverage
5.1.0 packages.

Command: `npm ci`

```
added 152 packages, and audited 153 packages in 17s
10 moderate severity vulnerabilities
```

Exit code `0`. The lockfile therefore installs cleanly. The 10 advisories are
**development-only**, not hidden by that success; see the audit result below.

### Lint: failing first run, then a real pass

Command: `npm run lint`

The first run exited `1` with **37 errors and 1 warning**. The errors identified
six IAS15 Gauss–Radau nodes and one galactic-axis component written with more
decimal digits than an IEEE-754 double can retain, redundant assignments, unused
variables, and explicit `any` escape hatches. The fixes preserved runtime values
by using JavaScript's shortest round-trip decimal representations, replaced the
`any` uses with concrete types, and removed the redundant assignments.

After those fixes, the same command exited `0` with no diagnostics. The final
`npm run typecheck` also exited `0` with no diagnostics.

### Coverage: instrumentation timeout, then measured baseline

Command: `npm run test:coverage`

The first run used the existing 120-second test timeout. Instrumentation slowed
`tests/moons.test.ts` enough that its Laplace-resonance test timed out:

```
 Test Files  1 failed | 81 passed (82)
      Tests  1 failed | 530 passed (531)
   Duration  179.39s
Error: Test timed out in 120000ms.
```

The committed coverage command therefore uses `--testTimeout=300000`; the test
itself and its scientific assertions were not changed. The next run exited `0`:

```
 Test Files  82 passed (82)
      Tests  531 passed (531)
   Duration  148.92s (tests 99%, import 1%)
```

First full-`src/**/*.ts` V8 coverage baseline, copied from that run:

| Scope | Statements | Branches | Functions | Lines |
| :--- | ---: | ---: | ---: | ---: |
| All source | 62.89 % | 44.61 % | 62.55 % | 63.29 % |
| `src/physics` | 92.67 % | 69.69 % | 94.37 % | 93.25 % |
| `src/frames` | 100 % | 100 % | 100 % | 100 % |
| `src/sim` | 81.98 % | 68.00 % | 84.67 % | 84.84 % |
| `src/render` | 39.70 % | 28.05 % | 30.00 % | 39.95 % |
| `src/ui` | 2.30 % | 2.32 % | 1.38 % | 2.61 % |
| `src/universe` | 91.48 % | 87.19 % | 93.22 % | 92.24 % |

The JSON summary from the same run records 4,509 / 7,124 covered lines and
1,362 / 3,053 covered branches. **No coverage threshold is claimed or enabled.**
Physics clears the mission's 90 % line target but not its 90 % branch target;
frames clears both. UI coverage is especially low because there is not yet a
browser-driven UI suite.

### Production regression check and dependency audit

Command: `npm run verify:prod`

Exit code `0`. This ran typecheck, lint, the normal uninstrumented test suite,
and the production build in sequence:

```
 Test Files  82 passed (82)
      Tests  531 passed (531)
   Duration  55.57s (tests 95%, import 3%, transform 2%)

✓ 153 modules transformed.
dist/assets/physics.worker-D6EKk4Qb.js     60.41 kB
dist/assets/index-CwneRvVb.js           1,255.64 kB │ gzip: 390.45 kB
✓ built in 382ms
```

The existing main-chunk size warning remains; this step did not address
AUDIT-49. `npm audit --omit=dev --json` exited `0` and reported **0 runtime
vulnerabilities**. A full `npm audit` exited `1` with **10 moderate development
vulnerabilities**, all one transitive `minimatch@10.2.6` advisory
(`GHSA-g3hv-75wg-m249`) reached through ESLint and typescript-eslint. The
suggested `npm audit fix --force` would downgrade ESLint to 9.39.5 and was not
run. CI audits runtime dependencies; the development advisory remains open.

### CI status

`.github/workflows/ci.yml` now runs typecheck, ESLint, instrumented tests with
coverage, `npm audit --omit=dev`, and the production build. The stale "59
suites" label was removed. These commands are verified locally as above; no
GitHub Actions run is claimed here.

---

## Entries

| Date | Type | Summary |
| :--- | :--- | :--- |
| 2026-11-04 | BASELINE | First full measurement: typecheck 0 errors; 82 files / 530 tests pass in 49.49 s; build succeeds with a 1,255.63 kB bundle; lint and coverage not available; working tree dirty (78 M / 92 untracked); 9 documented accuracy claims not reproducible. |
| 2026-11-04 | ASSET-VERIFY | Textures: CC BY 4.0 confirmed on the provider page; `tests/textures-manifest.test.ts` 10/10 pass; independent Python SHA-256 check 9/9 match, 0 mismatch, files unmodified. |
| 2026-11-04 | BASELINE TAG | `baseline-pre-audit` after 14 grouped commits; tree verified identical (318/321 unchanged, 3 intentional edits, 0 lost); typecheck 0, tests 82/530, build OK, **lint exit 1 (no lint script)**, coverage unmeasured. |
| 2026-11-04 | STEP-2 RESEARCH | `docs/RESEARCH.md` added; typecheck 0 / 82 files / 530 tests / 37.86 s; DE442 is newest (DE441 claim wrong); ASSIST 16-asteroid perturber list sourced; `ARCHITECTURE.md:170` cites a stale Bulletin C. |
| 2026-11-04 | STEP-3a BOUNDARY | Guard widened to cover `universe` (failed first, as proof), physics→universe cycle removed; 82 files / **531** tests pass, typecheck 0, build 0. |
| 2026-11-05 | STEP-3b QUALITY GATES | ESLint and V8 coverage added; first lint found 37 errors, fixed; clean install and production checks pass; 82 files / 531 tests; overall 63.29 % lines, physics 93.25 % lines / 69.69 % branches, frames 100 %; 0 runtime audit findings, 10 moderate dev-only minimatch advisories remain. |

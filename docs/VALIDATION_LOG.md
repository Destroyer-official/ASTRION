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
  tracked in [AUDIT.md](./AUDIT.md). Assumptions that are useful operationally but
  not yet backed by a measurement or a primary source are numbered in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) (created in step 4a).

---

## 2026-11-04 — BASELINE: pre-change toolchain and test state

### Environment

| Item                                | Observed                                                                            |
| :---------------------------------- | :---------------------------------------------------------------------------------- |
| `node -v`                           | `v27.0.0-alpha.0.0.0`                                                               |
| `npm -v`                            | `12.1.0`                                                                            |
| `npx --no-install tsc --version`    | `Version 6.0.3`                                                                     |
| `npx --no-install vitest --version` | `vitest/5.0.3 win32-x64 node-v27.0.0-alpha.0.0.0`                                   |
| `npx --no-install vite --version`   | `vite/8.3.3 win32-x64 node-v27.0.0-alpha.0.0.0`                                     |
| Platform                            | win32, x64                                                                          |
| HEAD commit                         | `8391eaf8429d477ae58bdc5291460478a34d022b`                                          |
| HEAD subject                        | `feat(nasa): add NASA JPL Horizons DE441 live integration and NASA Eyes connection` |
| HEAD author date                    | `Wed Oct 7 12:00:47 2026 +0530`                                                     |

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

| Suite                | Duration       | Note                                                                                                                               |
| :------------------- | :------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `tests/seek.test.ts` | 46,027 ms      | 2 tests, both >11 s: "one message makes bounded progress" 11,717 ms and "chained seeks land exactly on a 600-day target" 34,304 ms |
| remaining 81 suites  | < 500 ms total | most are 3–25 ms                                                                                                                   |

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

| Check               | Result        | Number                                      |
| :------------------ | :------------ | :------------------------------------------ |
| `npm run typecheck` | PASS          | 0 errors                                    |
| `npm test`          | PASS          | 82 files / 530 tests / 0 failures / 49.49 s |
| `npm run build`     | PASS          | main bundle 1,255.63 kB (390.46 kB gz)      |
| `npm run lint`      | NOT AVAILABLE | no lint script exists                       |
| coverage            | NOT MEASURED  | no coverage tooling configured              |
| working tree        | DIRTY         | 78 modified + 92 untracked paths            |

---

## Unverified claims — cannot be reproduced from this repo

The repository's own documentation states specific accuracy numbers. The commands
above did **not** produce any of them, and grepping the source and tests does not
yield the values or an assertion that would compute them. They are listed here so
that no later step mistakes them for measurements. Each is cross-referenced in
[AUDIT.md](./AUDIT.md) (findings AUDIT-17 … AUDIT-23, AUDIT-27 and AUDIT-28).

| Claim in docs                                                                   | Where                        | Why it is unverified                                                                                                                                                                                                                                                                                             |
| :------------------------------------------------------------------------------ | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Earth error < 100 km; outer planets < 1 km → **PASS (56 km)**"                 | `README.md:181`              | The nearest assertion is `tests/production-truth.test.ts:82` `expect(errAu, ...).toBeLessThan(1e-3)` — a **150,000 km** bound, not 100 km or 1 km. The string `56` appears nowhere in the repo as a measured value.                                                                                              |
| eclipse timing "**PASS (1.19 min)**"                                            | `README.md:186`              | `tests/eclipses.test.ts:114` asserts `toBeLessThan(20)` minutes. Neither 1.19 nor 2.35 is computed or stored.                                                                                                                                                                                                    |
| eclipse "timing error of only **2.35 minutes**"                                 | `ARCHITECTURE.md:97`         | Same as above, and it **contradicts** the README's 1.19 min for the same event.                                                                                                                                                                                                                                  |
| "Solar SSB wobble magnitude **788,469 km** at 11.4 m/s"                         | `README.md:189`              | `tests/spice-truth.test.ts:87-88` only asserts `toBeGreaterThan(1e-4)` / `(1e-6)`. The literal `788,469` exists only in the README.                                                                                                                                                                              |
| "**77 test suites and 497 … tests**"                                            | `README.md:177`              | Measured: **82 files / 530 tests**. The same README also says "79 suites / 503 passed" at `README.md:9` and "79 suites, 503 tests" at `README.md:271` — three mutually inconsistent counts, none matching reality.                                                                                               |
| "**100% GREEN (79 Test Suites, 503 Automated Verification Tests Passing)**"     | `docs/NASA_COMPLIANCE.md:5`  | Same mismatch, and it is presented next to a fabricated-looking Vitest output block (`NASA_COMPLIANCE.md:63-65`) claiming `Test Files 79 passed (79)` and `Duration 45.57s`, which no run in this log produced.                                                                                                  |
| "Native IAS15 (15th-order Radau) + Prince-Dormand RK8(9)" as part of the engine | `docs/NASA_COMPLIANCE.md:15` | `src/physics/integrators/ias15.ts`, `rk89.ts` and `compensated.ts` exist but are **imported by no runtime module** (verified by grep across `src/`: only self-references). The selectable integrators are `leapfrog / yoshida4 / yoshida6 / yoshida8 / truth8` (`src/sim/protocol.ts:18`, `src/ui/panel.ts:43`). |
| `c = 173.1446326846693 AU/day`                                                  | `README.md:100`              | Computed from `src/data/constants.ts:27`, the code yields `173.14463267424031`; `src/physics/light/lightTime.ts:17` comments the same `…67424`. The README digits are wrong at the 1e-8 level.                                                                                                                   |
| "158 globular clusters"                                                         | `README.md:230`              | Matches the default in `src/render/galaxyVisual.ts:226` but no Harris catalogue file or citation is present in the repo.                                                                                                                                                                                         |

## Scientific-accuracy baseline — what actually exists today (measured 2026-11-04)

Mission section 4 asks for a baseline of real errors against JPL before setting
targets. The honest statement of the current baseline, from the run above:

- **Ephemeris accuracy vs SPICE/Horizons: not established as a number.**
  `tests/spice-truth.test.ts` validates cached kernel text (`gm_de440.tpc`,
  `pck00010.tpc`, `pck00011.tpc`) against SHA-256 digests recorded in
  `src/data/spice/provenance.json`, and pins body GMs to the kernel at 1e-12.
  That is a _provenance and consistency_ check, not a position comparison: no
  SPK binary kernel is present, so there is no Chebyshev SPK-vs-CSPICE position
  difference in km to report. The "well below 1 km" target therefore starts from
  **no measured value**, not from a failing one.
  _Superseded in part on 2026-11-05 (step 6): `src/sim/spk.ts` reads binary SPK
  now and its comparison against `de440.bsp` is measured to 2.4e-4 m, but the
  runtime still integrates cached Horizons vectors rather than evaluating a
  kernel, so the app's own ephemeris error against DE440 remains unmeasured._
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
The page states, verbatim: _"Distributed under Attribution 4.0 International
license: You may use, adapt, and share these textures for any purpose, even
commercially."_ — i.e. CC BY 4.0, redistribution permitted **with attribution**.
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

| Check     | Command             |  Exit | Real result                                      |
| :-------- | :------------------ | ----: | :----------------------------------------------- |
| Typecheck | `npm run typecheck` |     0 | 0 errors                                         |
| Lint      | `npm run lint`      | **1** | Missing script: "lint"                           |
| Tests     | `npm test`          |     0 | 82 files / 530 tests pass, 45.03 s               |
| Build     | `npm run build`     |     0 | 1,255.63 kB bundle (390.46 kB gz), chunk warning |
| Coverage  | —                   |     — | not configured, no number                        |

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
correctly (Charlot et al. 2020, _A&A_ 644, A159), so that citation must not be
"fixed". What _is_ wrong there is `ARCHITECTURE.md:170`, which cites
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

| Scope          | Statements | Branches | Functions |   Lines |
| :------------- | ---------: | -------: | --------: | ------: |
| All source     |    62.89 % |  44.61 % |   62.55 % | 63.29 % |
| `src/physics`  |    92.67 % |  69.69 % |   94.37 % | 93.25 % |
| `src/frames`   |      100 % |    100 % |     100 % |   100 % |
| `src/sim`      |    81.98 % |  68.00 % |   84.67 % | 84.84 % |
| `src/render`   |    39.70 % |  28.05 % |   30.00 % | 39.95 % |
| `src/ui`       |     2.30 % |   2.32 % |    1.38 % |  2.61 % |
| `src/universe` |    91.48 % |  87.19 % |   93.22 % | 92.24 % |

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

## 2026-11-05 — Step 3c: structured logging, health state, and runtime invariants

Commits:

- `5bd7839` — core `src/observability` logger, health registry, invariant evaluator,
  boundary rules, and `docs/OPEN_QUESTIONS.md`.
- `47d7fa0` — barycentric drift and invariant results propagated through frames;
  worker fault logging, runtime health, and the diagnostics-panel display.
- `d03b1a9` — explicit timeout for the 20-year Laplace run under coverage
  instrumentation.

### Test-first development of the core layer

The first core test run found two genuine defects, recorded before correction:

```
Test Files  1 failed | 1 passed (2)
     Tests  2 failed | 10 passed (12)
```

The health registry logged a `status unchanged / detail changed` event as though
it were a new transition, and infinity was reported as an angular-momentum
threshold breach rather than a non-finite value. The implementation was changed
so status events fire only on status changes and each metric reports either
`non_finite` or its drift-threshold name, never both.

The next targeted run passed:

```
✓ tests/observability.test.ts (4 tests)
✓ tests/architecture.test.ts (8 tests)

Test Files  2 passed (2)
     Tests  12 passed (12)
```

Strict TypeScript also rejected constructor parameter properties under
`erasableSyntaxOnly`, and the first invariant rewrite had an incorrect tuple
type. Both were fixed rather than relaxed.

### Runtime integration measurements

`npm run typecheck` and `npm run lint` exited `0`. The targeted integration run
`npx vitest run tests/architecture.test.ts tests/load.test.ts
tests/simcore.test.ts tests/simclient.test.ts tests/observability.test.ts` passed
**5 files / 35 tests** in 5.38 s.

Command: `npm run verify:prod`

```
 Test Files  83 passed (83)
      Tests  539 passed (539)
   Duration  43.66s (tests 96%, import 3%, transform 1%)

✓ 157 modules transformed.
dist/assets/physics.worker-DoD2sSgf.js     62.61 kB
dist/assets/index-CxD0W3Zm.js           1,259.67 kB │ gzip: 392.07 kB
✓ built in 409ms
```

Exit code `0`. Worker code grew `60.42 kB → 62.61 kB`; the main bundle grew
`1,255.63 kB → 1,259.67 kB` (gzip `390.46 → 392.07 kB`). The large-chunk warning
remains open.

### Coverage rerun after the new runtime path

Command: `npm run test:coverage`

The first instrumented run failed despite `--testTimeout=300000`:

```
 Test Files  1 failed | 82 passed (83)
      Tests  1 failed | 538 passed (539)
   Duration  170.53s
Error: Test timed out in 120000ms.
```

Reason: that test supplies its own explicit 120-second timeout, and a per-test
timeout overrides the CLI default. The committed change raises only this 20-year
resonance integration to 300,000 ms. It did not weaken any assertion or reduce
simulated time. Rerun:

```
 Test Files  83 passed (83)
      Tests  539 passed (539)
   Duration  153.58s (tests 99%, import 1%)
Laplace resonance test: 122,391 ms
```

Coverage after step 3c:

| Scope               | Statements | Branches | Functions |   Lines |
| :------------------ | ---------: | -------: | --------: | ------: |
| All source          |    62.99 % |  44.74 % |   62.87 % | 63.41 % |
| `src/observability` |    87.50 % |  71.11 % |   94.44 % | 91.66 % |
| `src/physics`       |    92.67 % |  69.69 % |   94.37 % | 93.25 % |
| `src/frames`        |      100 % |    100 % |     100 % |   100 % |
| `src/sim`           |    82.13 % |  68.37 % |   85.00 % | 84.92 % |
| `src/ui`            |     2.28 % |   2.24 % |    1.31 % |  2.60 % |

The physics/frames target remains partially unmet, and `main.ts`, browser
startup paths, and worker entry still have no browser-level execution coverage.
No threshold was added.

### What is now enforced

- Only `src/observability/logger.ts` may call `console.*`; a boundary test fails
  any source file that bypasses the sink.
- `src/observability` may not import application layers, Three.js, DOM globals,
  wall-clock time, or unseeded randomness.
- Every `Frame` carries `comDrift`, `invariantOk`, and `invariantViolations`.
- Worker errors are logged with error type, message, stack, consecutive-failure
  count, and parked state, then rethrown into the existing self-healing path.
- The browser records uncaught errors and unhandled rejections in the structured
  log; the diagnostics readout shows `|ΔCM|`, integrity, and module health.
- Default operational thresholds are explicitly marked UNVERIFIED and recorded
  as `OPEN-001`, not presented as NASA/IAU/JPL-derived values.

### Still open in observability

Invariant detection is frame-boundary detection, not per-integrator guarding;
AUDIT-34 remains open. The worker and simulation-state modules are health-checked
during actual execution, while render/UI are startup-only (`ok` after successful
construction). No independent `selfTest()` routines, module step timings, or
renderer disposal health probe exist yet. Browser-level runtime logging has not
been exercised by Playwright because the E2E gate itself is still open.

---

## 2026-11-05 — Step 4a: single-source constants and honest product documentation

Commits measured:

- `8850cfb` — move all physical constant literals to `src/data/constants.ts`, replace
  raw conversions elsewhere, derive panel GM/radius values from loaded body records,
  and add a boundary test that rejects duplicate physical-constant literals.
- `dce8000` — mark every galactic model preset `lsrR0Only` and display that limitation.

### Refactor process

`AU_KM`, `C_LIGHT_KMS`, Julian-year seconds, light-year/parsec conversions and metric
prefixes were consolidated in the data layer. `cosmicCoordinates.ts`, light-time,
relativity, GR/EIH, flyby, cosmic gravity, facts and UI aliases now consume those
definitions instead of re-deriving or hard-coding them.

A first rewrite introduced initialization-order errors (`KM_PER_LIGHT_YEAR` referred to
`C_LIGHT_KMS` and `KM_PER_PARSEC` referred to `AU_PER_PARSEC` before those definitions
were reached) and an alias/export name collision. `npm run typecheck` exited `2` with:

```
src/physics/relativityClock.ts(91,27): error TS2304: Cannot find name 'DAY_S'.
src/universe/cosmicCoordinates.ts(14,3): error TS2395: Individual declarations in merged declaration 'AU_KM' must be all exported or all local.
src/universe/cosmicCoordinates.ts(43,26): error TS2448: Block-scoped variable 'AU_KM' used before its declaration.
```

The module was reordered by dependency and public aliases were made explicit. The
targeted rerun then exited `0`.

### Verification

Commands and results:

```
npm run typecheck && npm run lint        exit 0, no diagnostics
npx vitest run <18 affected suites>      18 files passed
                                         119 tests passed in 6.22s
npm run verify:prod                       exit 0
```

Full production regression:

```
 Test Files  83 passed (83)
      Tests  540 passed (540)
   Duration  51.84s (tests 95%, import 3%, transform 1%)
```

Build output:

```
dist/assets/physics.worker-C1FoAVmf.js     62.65 kB
dist/assets/index-UG53WQpT.js           1,259.49 kB │ gzip: 392.03 kB
✓ built in 677ms
```

Exit code `0`; the large-chunk warning remains open (AUDIT-49). Coverage was **not**
re-run after adding the 540th architecture test, so no post-step-4a coverage number is
claimed.

### Documentation pass

`README.md`, `ARCHITECTURE.md`, and `docs/NASA_COMPLIANCE.md` were rewritten against
this log and actual source/test assertions:

- Retain `NASA_COMPLIANCE.md` filename for compatibility but title it **Verification
  Status and Known Limitations**; remove certification, NPR compliance, “100% green,”
  flight-grade stamps, fabricated Vitest output, and unverifiable PASS values.
- Correct the ephemeris story: the repository contains DE440/GM and PCK **text**
  kernels plus cached Horizons tables; it does not bundle a binary SPK or compare with
  CSPICE. DE441 is not the newest solution; DE442 is newer.
- State that IAS15 and Kahan-compensated modules are unit-tested but not runtime
  selectable. State that `rk89.ts` is actually `TruthIntegrator8`, not Dormand–Prince.
- Keep only test assertion bounds, not console output, as “measured/asserted.”
- Mark invariant thresholds unverified operational settings; mark galactic model
  presets LSR/R0-only.
- Correct `1.54°` Moon labeling, speed-of-light AU/day digits, stale Bulletin C
  reference, module tree paths and default integrator description.

The source files were not regenerated by these documentation changes, so the 83/540,
typecheck, lint and build results above remain the directly applicable regression
evidence.

---

## 2026-11-05 — Step 5: time-scale chain and date-conversion correctness

Commit under test: `5775d66`
(`fix(time): use the full UTC-TAI-TT-TDB conversion chain everywhere`).

### Defects found

The data layer had a fixed `TDB_MINUS_UTC_S = 69.184` conversion while the physics
layer had the Fairhead–Bretagnon periodic `TDB − TT` conversion. Those could disagree
by up to the modeled periodic offset. `tdbToTt()` also omitted the third periodic term
included in `ttToTdb()`, so forward and inverse transformations did not describe the
same model. The UI took a JD labeled **TDB** and passed it directly to `utcToTt()`,
which expects JD **UTC**.

The fix moves date conversion to `src/physics/time.ts`, makes it use
UTC → TAI → TT → TDB and TDB → TT → TAI → UTC, adds fixed-point inversion, and changes
the panel to convert the simulation’s TDB JD to UTC before computing offsets.
`src/data/constants.ts` no longer owns date/TDB conversion.

### Test-first precision failure

The first inverse-series assertion requested sub-microsecond scalar-JD precision:

```
FAIL tests/time.test.ts > inverts the complete TDB - TT periodic series to sub-microsecond accuracy
expected -9.313225746154785e-10 to be close to -7.588755450890583e-10
difference is 1.7244702952642024e-10
```

This was an impossible tolerance, not a physics failure: a scalar JD around
2,450,000 has a float64 spacing of roughly `4.66e-10` days, or about 40 μs. The
assertion was rewritten to test the offset in **seconds** and require inverse agreement
within 0.1 s. That makes the numerical precision assumption explicit instead of hiding
it behind a falsely precise day tolerance.

The original “converts JavaScript Date to JD(UTC) and back faithfully” test was also
accidentally replaced during the edit; it was restored before the commit, and the new
TDB round-trip test was added alongside it. Final file has 10 tests.

### Recorded verification

Targeted suite:

```
Test Files  6 passed (6)
     Tests  57 passed (57)
  Duration  603ms
```

Commands:

```
npm run typecheck && npm run lint    exit 0
npm run verify:prod                  exit 0
```

Full local regression on commit `5775d66`:

```
 Test Files  83 passed (83)
      Tests  542 passed (542)
   Duration  41.32s (tests 96%, import 3%, transform 1%)

dist/assets/physics.worker-C1FoAVmf.js     62.65 kB
dist/assets/index-QGQ_31-l.js           1,260.04 kB │ gzip: 392.24 kB
✓ built in 406ms
```

Exit code `0`; the large-chunk warning remains open. Coverage was not re-run after
this commit, so the 63.41 % figure from step 3c is still the last recorded baseline.

### Eclipse run output captured from this suite

`tests/eclipses.test.ts` passed its assertion bounds and printed:

```
Catalogued greatest eclipse: 2026-08-12T17:46:00.000Z
Simulated minimum separation: 2026-08-12T17:47:11.495Z
Timing error: 1.19 minutes
Geocentric minimum separation: 0.891°
```

This is now a retained observed value for the stated 2026-11-05 local run at commit
`5775d66`; the permanent automated assertion remains the weaker bounds of <20 minutes
and 0.70°–1.00°. The displayed timing result was rounded from 71.495 s to 1.19 minutes.

### Remaining time-scale limitations

- The leap-second table’s last step is 2017-01-01 (TAI−UTC = 37 s). Its currency is
  OPEN-004: IERS Bulletin C must be rechecked each January/July.
- Fairhead–Bretagnon coefficients are recorded as OPEN-003 because the primary-source
  transcription was not independently verified during this pass.
- Scalar JD arithmetic has ~40 μs absolute spacing near 2.46e6. Two-part JdPair APIs
  exist for conversions that must retain sub-second precision, but the simulation
  clock and worker protocol still transport a scalar `t` in days.
- No external SOFA/SPICE comparison has been run, so correctness is currently based on
  these unit assertions and dated provenance—not a certified standard-library match.

---

## 2026-11-05 — Step 5b: WGCCRE rotational properties

Commit under test: `4d6aebb`
(`test: add seeded WGCCRE rotational frame properties`).

`fast-check@4.10.2` was added exactly as a development dependency. The suite seeds every
run with `20261105` and executes 1,000 samples, so a counterexample can be reported and
replayed rather than being a one-time random accident.

The property suite checks, across every body that has a `RotationJson` model and a
date from −50 to +50 years around J2000:

- every row of `bodyToEcliptic()` is unit length;
- row pairs are perpendicular;
- row 2 equals row 0 × row 1, so the frame is right-handed;
- converting a body-fixed vector to ecliptic axes and back preserves its components.

A third proposed property was recorded as an invalid test before removal:
full matrix closure after one sidereal period failed for Ariel, Triton, and Iapetus
with residuals of `7.35e-7`, `2.08e-5`, and `1.02e-4`. Those are not integrator bugs:
the spin pole and nutation terms also advance during the rotation period, so only
planets with rapid spin and slow pole change nearly close. Loosening the test until it
passed would have hidden the premise error, so that periodic-closure property was
removed rather than weakened. Existing pointwise planet-period checks remain, and the
new properties still cover all bodies.

### Verification

Targeted suite:

```
✓ tests/orientation-property.test.ts (2 tests) 96ms
✓ tests/orientation.test.ts (27 tests) 69ms
✓ tests/pck-rotation.test.ts (58 tests) 33ms

Test Files  3 passed (3)
     Tests  87 passed (87)
  Duration  476ms
```

Full local regression on `4d6aebb`:

```
 Test Files  84 passed (84)
      Tests  544 passed (544)
   Duration  40.66s (tests 95%, import 3%, transform 2%)

✓ 157 modules transformed.
dist/assets/physics.worker-C1FoAVmf.js     62.65 kB
dist/assets/index-QGQ_31-l.js           1,260.04 kB │ gzip: 392.24 kB
✓ built in 406ms
```

`npm run typecheck` and `npm run lint` also exited `0`. The large-chunk warning remains
open. Coverage was not re-run after this commit; the step-3c coverage table remains the
last recorded baseline.

### Validation status

PCK values are already independently checked against the SHA-256-pinned `pck00011.tpc`
snapshot in `tests/pck-rotation.test.ts`. These properties do not replace that source
comparison; they prove that the implementation’s frame algebra remains valid over the
tested time and body ranges. WGCCRE validity ranges themselves are not yet enforced by
the UI, which remains a production-readiness gap.

---

## 2026-11-05 — Step 6: binary SPK reader, DE440 comparison, and the frame defect it found

Commits under test: `9fd4922` (`fix(frames): realize the ecliptic frame with the
obliquity Horizons uses`) and `2cee26a` (`feat(sim): add a read-only DAF/SPK type
2/3 ephemeris reader`). This entry is committed with the validation test and the
`docs/OPEN_QUESTIONS.md` updates it produces.

Until this step the repository had **no** binary ephemeris path: `src/data/spice/`
holds text kernels and cached Horizons tables, and every "DE440" claim in the docs
was a provenance check on a text file. `src/sim/spk.ts` now reads DAF/SPK files
directly (header and summary chain, ND/NI and `LTL-IEEE`/`BIG-IEEE` validation,
type 2 and type 3 Chebyshev segments, Clenshaw evaluation with the analytic
derivative for type 2 velocity, barycentric subtraction, and a J2000 → ecliptic
rotation), and `npm run verify:spk` compares it with a real kernel.

### Kernel acquisition

Kernels are never committed (OPEN-005). The cache directory is ignored, and the
script requires NAIF's own MD5 before using a file — this replaces the "digest is
local only" limitation recorded in `docs/RESEARCH.md` §6 item 4, which noted that
NAIF publishes MD5 rather than SHA-256.

```
$ npm run verify:spk
tests/validation/.cache/de440.bsp: 119799808 bytes, MD5 c9d581bfd84209dbeee8b1583939b148 (matches NAIF aa_checksums.txt)
SHA-256 a4ce9bf9b3282becc9f4b2ac3cebe03a2ae7599981aabd7265fd8482fff7c4b5 (local integrity record)

$ SPK_KERNEL=de440s.bsp npm run verify:spk
tests/validation/.cache/de440s.bsp: 32726016 bytes, MD5 3917ee56769db332790c751e2168843d (matches NAIF aa_checksums.txt)
```

Both MD5 values were read from
`https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/aa_checksums.txt`
(fetched 2026-11-05) and both local files match it, so the bytes under test are
byte-identical to NAIF's copies.

### First comparison: a kilometre-scale failure, and a units error in reading it

The first version of `tests/validation/spk-real.test.ts` compared the reader with
the nine cached Horizons vectors at their own epoch (JD 2461319.5 TDB) and failed
every body. Reading that output, the Jupiter residual was written down as
`120.89 m` — the number was actually **120,894.8 m**; the printout was scaled
wrong by 1000, so the defect looked like kernel imprecision instead of a frame
error. Re-measured with correct scaling, de440.bsp gave (position in m, velocity
in mm/s, per axis, our value minus Horizons):

```
bodies/sun.json        pos        0.0        -2.9     -156.2 m  max      156.2 m  |  vel   0.0000   0.0000   0.0009 mm/s
bodies/mercury.json    pos        0.0      1356.8   -13716.7 m  max    13716.7 m  |  vel   0.0000   0.5072   2.4741 mm/s
bodies/venus.json      pos        0.0      1263.9      396.9 m  max     1263.9 m  |  vel   0.0000  -0.1095   7.0971 mm/s
bodies/earth.json      pos        0.0        -2.3     6379.3 m  max     6379.3 m  |  vel   0.0000   0.0004   5.9025 mm/s
bodies/mars.json       pos        0.0      -955.7    47452.6 m  max    47452.6 m  |  vel   0.0000  -0.1290   0.6094 mm/s
bodies/jupiter.json    pos       -0.0     -1898.5   120894.8 m  max   120894.8 m  |  vel   0.0000  -0.0521  -1.6402 mm/s
bodies/saturn.json     pos       -0.0     12167.8    54492.3 m  max    54492.3 m  |  vel   0.0000   0.0143   1.9268 mm/s
bodies/uranus.json     pos       -0.0      1562.9   526114.0 m  max   526114.0 m  |  vel  -0.0000  -0.0182   0.5712 mm/s
bodies/neptune.json    pos        0.0     21817.4    42365.2 m  max    42365.2 m  |  vel   0.0000   0.0215   1.1121 mm/s
```

Two features ruled out the obvious explanations. `de440s.bsp` produced the same
table to the last digit, and the X residual was `0.000 m` for all nine bodies. A
time-scale or epoch error would move X; a fit-precision difference between the
two kernels could not leave them identical. A pure rotation about the X axis does
exactly that.

### Diagnosis: the simulation had two different ecliptic frames

Fitting a rotation about X to each body's own residual (`a = (y·dz − z·dy)/(y²+z²)`):

```
sun      implied angle=0.042000 arcsec      mars     implied angle=0.042000 arcsec
mercury  implied angle=0.042000 arcsec      jupiter  implied angle=0.042000 arcsec
venus    implied angle=0.042000 arcsec      saturn   implied angle=0.042000 arcsec
earth    implied angle=0.042000 arcsec      uranus   implied angle=0.042000 arcsec
neptune  implied angle=0.042000 arcsec
best-fit rotation between our ecliptic frame and the Horizons frame: 0.042000 arcsec
our obliquity: 84381.4060 arcsec -> implied Horizons obliquity 84381.4480 arcsec
```

Nine independent bodies, one angle, matching a documented constant: JPL Horizons
defines `REF_PLANE='ECLIPTIC'` at J2000 as "the IAU76/80 obliquity of 84381.448
arcsec at J2000.0 relative to the ICRF reference frame"
(`https://ssd-api.jpl.nasa.gov/doc/horizons.html`, fetched 2026-11-05). Every
vector in `src/data/bodies` was produced there, so the simulation's orbital frame
is that frame — but `src/data/galaxy.ts` converted ICRS input with the IAU 2006
value 84381.406 arcsec. The application had been comparing DE440 states with
WGCCRE pole vectors and star directions in two planes 0.042 arcsec apart. The
constant is now 84381.448 with the citation in its comment,
`scripts/verify-nutation.mjs` reads it from that file instead of duplicating it,
and `tests/frames.test.ts` pins the value.

### Why de440s and de440 agreed to the last digit

Dumped from the segment directories, both files use type 2 segments with a
2,764,800 s (32-day) record interval and the same record payload — 26 words for
Jupiter, 20 for Uranus — and differ only in coverage: 3,425 records spanning
−4.7341e9…4.7354e9 ET versus 12,556 records spanning −1.4201e10…2.0514e10 ET.
`de440s.bsp` is the same records over the 1849–2150 window, not a lower-precision
refit. That explains the identical table, and it means this comparison does not
measure `de440s` fit error at all.

### Acceptance limits, set from the measurement

After the frame fix, the same nine comparisons gave:

```
bodies/sun.json        max 1.164e-7 m  |  max 4.879e-13 mm/s
bodies/mercury.json    max 9.313e-7 m  |  max 4.441e-10 mm/s
bodies/venus.json      max 9.313e-7 m  |  max 4.441e-10 mm/s
bodies/earth.json      max 4.470e-5 m  |  max 7.105e-8 mm/s
bodies/mars.json       max 2.980e-5 m  |  max 7.105e-9 mm/s
bodies/jupiter.json    max 5.960e-5 m  |  max 1.776e-9 mm/s
bodies/saturn.json     max 2.384e-4 m  |  max 1.776e-9 mm/s
bodies/uranus.json     max 2.384e-4 m  |  max 8.882e-10 mm/s
bodies/neptune.json    max 5.960e-5 m  |  max 0.000e+0 mm/s
```

Identical for both kernels. The test now requires position < `1e-3` m and velocity
< `1e-6` mm/s. Those are not rounded-down hopes: the worst measured residual is
0.238 mm, and the limit sits below the quantisation of the reference itself — the
Horizons vectors are printed with 16 significant digits, so one unit in their last
place is 1.5 mm at Uranus' `y = 17.27151024209494` AU. The residual is the price of
how the reference was rounded, not of the reader. The velocity agreement
(≤ 7.1e-8 mm/s) is the check that the type 2 analytic derivative and the km / km-s
unit chain are right, not merely the position interpolation.

### Verification

Final-tree full suite:

```
$ npm test
 Test Files  86 passed (86)
      Tests  559 passed (559)
   Duration  54.12s (tests 96%, import 3%, transform 1%)
```

Targeted suites for the two changed concerns:

```
$ node node_modules/vitest/vitest.mjs run tests/spk.test.ts tests/frames.test.ts
 ✓ tests/spk.test.ts (5 tests) 6ms
 ✓ tests/frames.test.ts (15 tests) 39ms
      Tests  20 passed (20)

$ node node_modules/vitest/vitest.mjs run tests/spk.test.ts tests/nutation.test.ts \
    tests/stars.test.ts tests/orientation.test.ts tests/orientation-property.test.ts \
    tests/pck-rotation.test.ts tests/frames.test.ts tests/eclipses.test.ts
 Test Files  8 passed (8)
      Tests  117 passed (117)
   Duration  871ms
```

`npm run typecheck` and `npm run lint` exited `0`. `npm run build` produced
`dist/assets/index-BqCOmUjB.js 1,260.04 kB │ gzip: 392.24 kB` plus the
62.65 kB physics worker — still one large chunk (AUDIT-49 stays open).

Coverage was re-measured on this tree, which the step-3c table had not seen
(columns are Stmts / Branch / Funcs / Lines):

```
$ npm run test:coverage
 Test Files  86 passed (86)
   Duration  170.01s (tests 99%, import 1%)
All files          |    63.3 |    45.26 |   63.38 |   63.73 |
 src/frames        |     100 |      100 |     100 |     100 |
 src/physics       |   92.67 |    69.69 |   94.47 |   93.25 |
 src/sim           |   82.14 |    68.49 |   86.18 |   84.84 |
  spk.ts           |   82.25 |    69.44 |     100 |   83.92 | ...06,223,257,261
```

Overall lines moved from the step-3c 63.41 % to 63.73 %; `src/sim` is now
measured at 84.84 % lines, and `spk.ts` enters at 83.92 % with its uncovered
lines being the malformed-data throws — an invalid type 3 coefficient count
(206), an invalid type 2 coefficient count (223), a non-positive or fractional
directory (257) and a directory whose declared word count disagrees with the
segment (261). Those branches need deliberately corrupt synthetic segments to
cover, which is the honest gap left in this step.

### What this validates and what it does not

- It validates our reader against Horizons text vectors that Horizons derived from
  DE440 — parsing, record selection, Chebyshev evaluation, type 2 differentiation,
  unit handling, ET scaling, barycentric subtraction, and frame rotation. A
  shared-source error would be invisible to it, and no CSPICE comparison has been
  run (OPEN-007).
- Coverage is one epoch per body, the epoch of the shipped vectors. A sweep across
  the kernel span, and segments of types other than 2/3, are not tested.
- The kernels stay out of Git, so `npm test` skips `tests/validation/spk-real.test.ts`
  on any machine without a cached kernel; it ran here because the cache exists.
- The frame change moves every ICRS-derived quantity in the app by 0.042 arcsec.
  Existing absolute checks still pass after it: Polaris `66.10°` from the ecliptic
  plane (tolerance ±0.6°) and the galactic-centre axis `0.072°` from Sgr A*.

---

## 2026-11-05 — Step 7: runtime ephemeris measured against DE440

Commits: `0d9743c` (`feat(sim): chain SPK segments so barycenter and moon IDs
resolve`) and `b8f21d2` (`fix(sim): bracket ephemeris anchors per body instead of
by date`). This entry was written after both, and the temporary sweep harness that
produced the numbers was deleted rather than committed; the permanent version of the
comparison is `tests/validation/ephemeris-vs-de440.test.ts`.

Goal: turn "interpolation error against a binary SPK has not been measured" (the
last line of ARCHITECTURE's Ephemeris Mode description) into a number. It produced
two defect findings, one fixed here and one left open because fixing it is a product
decision.

### The tables themselves are sound

First check: do the shipped anchor values agree with the kernel they claim to come
from? Every one of the 731 dense samples and all four sparse anchors were compared
with `de440.bsp` at their own epochs:

```
dense samples=731 jd 2460954.5..2462049.5
  sun      worst anchor error 0.121 km     jupiter  worst anchor error 0.102 km
  mercury  worst anchor error 0.126 km     saturn   worst anchor error 0.119 km
  venus    worst anchor error 0.121 km     uranus   worst anchor error 0.112 km
  earth    worst anchor error 0.122 km     neptune  worst anchor error 0.127 km
  mars     worst anchor error 0.126 km     moon     worst anchor error 0.120 km
sparse offset    365.25 km: sun=0.0  mercury=0.0  venus=0.0  earth=0.0  mars=0.0
  jupiter=0.0  saturn=0.0  uranus=0.0  neptune=0.0  moon=n/a
sparse offset   3652.5 km: (same, all 0.0)   sparse offset  18262.5 km: (same, all 0.0)
sparse offset  -3652.5 km: (same, all 0.0)
```

So the data is right to ~0.13 km (the tables' own print precision). Two body
identities were pinned down the same way: `earth` reproduces NAIF target **3**
(the Earth–Moon barycentre) to 0.122 km while target 399 differs by 4,540.667 km —
consistent with `src/data/bodies/earth.json` citing `COMMAND=3` and the barycentre
GM 403503.2356 — and the model's `moon` slot is parent-relative, not barycentric,
which is why it is excluded from the kernel comparison.

### Defect 1 — five bodies were frozen at their epoch vector

The tables have mixed density, and the anchor lists show it:

```
  mercury   n=731 coverage=100%   avgStep=1.50 d      sun      n=122 coverage=17%  avgStep=9.00 d
  venus     n=731 coverage=100%   avgStep=1.50 d      jupiter  n=122 coverage=17%  avgStep=9.00 d
  earth     n=731 coverage=100%   avgStep=1.50 d      saturn   n=122 coverage=17%  avgStep=9.00 d
  mars      n=731 coverage=100%   avgStep=1.50 d      uranus   n=122 coverage=17%  avgStep=9.00 d
  moon      n=731 coverage=100%   avgStep=1.50 d      neptune  n=122 coverage=17%  avgStep=9.00 d
```

`interpolate()` chose one date bracket for every body, so at any date whose bracket
endpoints did not contain a 9-day body, that body fell through to `model.state` and
stayed there. Position error against `de440.bsp` at three probe dates, before the
fix, then after it (`b8f21d2`, per-body node lists plus per-body clamping):

| body | +1 d before | +100 d before | +700 d before | +1 d after | +100 d after | +700 d after |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jupiter | 1.105e+6 km | 1.1008e+8 km | 7.308e+8 km | 1.412e-2 km | 6.140e-2 km | 8.177e-2 km |
| Sun | 9.81e+2 km | 9.7765e+4 km | 5.9243e+5 km | 1.456e-2 km | 7.031e-2 km | 1.896e-2 km |

The five 9-day bodies were affected; the 1.5-day bodies were not (Earth measured
0.072/0.074/0.069 km before and 0.0717/0.0743/0.0694 km after — unchanged within the
print precision). `tests/ephemeris.test.ts` now asserts that no body may return its
epoch state at a date its own anchors bracket, and
`tests/validation/ephemeris-vs-de440.test.ts` sweeps −300…+300 d at 0.25-day steps:

```
sun      worst 1.074e-1 km at day 103      |  worst velocity 4.051e-7 km/s
mercury  worst 1.014e+2 km at day 123.25   |  worst velocity 2.318e-3 km/s
venus    worst 9.803e-1 km at day 85.75    |  worst velocity 2.223e-5 km/s
earth    worst 2.623e-1 km at day -242.75  |  worst velocity 5.352e-6 km/s
mars     worst 1.260e-1 km at day 47.5     |  worst velocity 2.667e-6 km/s
jupiter  worst 1.237e-1 km at day -188.5   |  worst velocity 4.177e-7 km/s
saturn   worst 1.057e-1 km at day 58       |  worst velocity 3.571e-7 km/s
uranus   worst 1.116e-1 km at day 247      |  worst velocity 3.422e-7 km/s
neptune  worst 1.269e-1 km at day 130      |  worst velocity 4.003e-7 km/s
```

The committed limit is 200 km, set just above the measured 101.4 km worst case. Step 7b
later widened the same sweep to the whole dense window and lowered the worst case to
80.11 km.

### Defect 2 — the advertised window is far wider than the anchors

Same harness, wider sweeps, after the fix:

```
days -364..729 step 0.5:
  mercury 4.799e+5 km at day 365   | earth 3.090e+5 km at day 365   | mars 2.575e+5 km at day 365
  venus   3.629e+5 km at day 365   | sun 3.953e+3 km at day 729     | jupiter 5.382e+6 km at day 729
  saturn  4.292e+6 km at day 729   | uranus 2.907e+6 km at day 729  | neptune 2.352e+6 km at day 729
days -3652..18262 step 10:
  mercury 1.146e+8 km at day 4228  | venus 2.174e+8 km at day 17028 | earth 3.005e+8 km at day 11868
  mars    4.553e+8 km at day 3988  | sun 1.852e+6 km at day 5998    | jupiter 1.479e+9 km at day 16128
  saturn  2.200e+9 km at day 13398 | uranus 2.778e+9 km at day 10868 | neptune 1.263e+9 km at day 10918
```

Reading them together with the coverage table:

- The dense window is −365…+730 d, i.e. −1…+2 yr, **not** the "[−10 yr, +50 yr]"
  and "60-year window" wording in `ARCHITECTURE.md` and `src/main.ts` (both now
  corrected to describe the measured regimes).
- Even inside it, the single sparse anchor at +365.25 d sits between two 1.5-day
  nodes. It carries no velocity, so the position-only blend takes over for ~1 day
  and costs 2.6e+5–4.8e+5 km — the zero end-slope of that blend is much worse than
  the curvature estimate alone would suggest.
- Past +730 d there is no anchor until +3652.5 d, so every planet carries the error
  of a years-wide chord: 1.1e+8–4.6e+8 km between +1 and +10 yr, and 1.2e+9–2.8e+9
  km (8.4–18.6 AU) out to +50 yr. Velocities there are wrong by 5–60 km/s.

This is recorded as **AUDIT-51 (CRITICAL)** and **OPEN-008**: either the tables are
regenerated at an interval that supports the span the UI offers, the UI is gated to
the dense window with the accuracy stated next to it, or ephemeris mode is driven by
the now-validated kernel reader. No acceptance limit is claimed for the sparse
region, and none is asserted in a test.

### Verification

```
$ node scripts/verify-spk.mjs
tests/validation/.cache/de440.bsp: 119799808 bytes, MD5 c9d581bfd84209dbeee8b1583939b148 (matches NAIF aa_checksums.txt)
 Test Files  2 passed (2)
      Tests  18 passed (18)

$ npm test
 Test Files  87 passed (87)
      Tests  571 passed (571)
   Duration  51.52s (tests 97%, import 3%, transform 1%)

$ npm run build
dist/assets/index-*.js 1,260.04 kB │ gzip: 392.24 kB   (chunk-size warning still emitted)
```

`npm run typecheck` and `npm run lint` exited `0`. Coverage was not re-measured in
this step; the step-6 table remains the last recorded baseline.

---

## 2026-11-05 — Step 7b: coarse anchors inside the fine window

Commit: `e92467f` (`fix(sim): let fine anchors override coarse ones inside their own
span`). Found by continuing the same sweep past ±300 d.

The dense table covers −365…+730 d, but the sparse table contributes a date at
+365.25 d — right in the middle of it. Every body already had two 1.5-day nodes
around that date, and the sparse node carries no velocity, so the bracket became
fine-then-coarse and the blended position path (zero end-slope at both nodes)
replaced the Hermite one:

```
days -364..729 step 0.5, before:
  mercury 4.799e+5 km at day 365   | venus   3.629e+5 km at day 365
  earth   3.090e+5 km at day 365   | mars    2.575e+5 km at day 365
days 364..367 step 0.05, after:
  mercury 2.238e+1 km              | venus   9.260e-1 km   | earth 1.826e-1 km
  mars    9.376e-2 km              | sun     6.519e-2 km   | jupiter 9.955e-2 km
  saturn  8.068e-2 km              | uranus  7.919e-2 km   | neptune 5.592e-2 km
```

`buildTracks()` now takes each body's fine anchors first and admits a coarse anchor
only outside that body's fine span. The whole dense window then measures, at 0.5-day
steps over −364…+724 d:

```
sun      worst 1.207e-1 km at day 652   | mercury  worst 8.011e+1 km at day 123.5
venus    worst 8.011e-1 km at day 542   | earth    worst 2.341e-1 km at day 106.5
mars     worst 1.260e-1 km at day 47.5  | jupiter  worst 1.237e-1 km at day -188.5
saturn   worst 1.189e-1 km at day 544   | uranus   worst 1.116e-1 km at day 247
neptune  worst 1.269e-1 km at day 130   | velocity worst 1.856e-3 km/s (mercury)
```

`tests/validation/ephemeris-vs-de440.test.ts` was widened from ±300 d at 0.25 d to
that span at 0.5 d, keeping the 200 km limit set above the 80.11 km worst case. What
remains open is unchanged and still AU-scale: past a body's own last dense node
(+724 d for the outer planets, +730 d for the inner) the next anchor is years away,
so 5.4e+6 km error appears at +729 d and 1.1e+8–2.8e+9 km beyond that (AUDIT-51,
OPEN-008).

```
$ npm test
 Test Files  87 passed (87)
      Tests  571 passed (571)
   Duration  41.56s (tests 96%, import 3%, transform 1%)
$ node scripts/verify-spk.mjs        ->  Test Files 2 passed (2) / Tests 18 passed (18)
$ npm run typecheck / lint           ->  exit 0
$ npm run build                      ->  dist/assets/index-DdywkBh8.js 1,260.56 kB │ gzip: 392.60 kB
```

---

## Entries

| Date       | Type                           | Summary                                                                                                                                                                                                                                                                                                                                                                   |
| :--------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-04 | BASELINE                       | First full measurement: typecheck 0 errors; 82 files / 530 tests pass in 49.49 s; build succeeds with a 1,255.63 kB bundle; lint and coverage not available; working tree dirty (78 M / 92 untracked); 9 documented accuracy claims not reproducible.                                                                                                                     |
| 2026-11-04 | ASSET-VERIFY                   | Textures: CC BY 4.0 confirmed on the provider page; `tests/textures-manifest.test.ts` 10/10 pass; independent Python SHA-256 check 9/9 match, 0 mismatch, files unmodified.                                                                                                                                                                                               |
| 2026-11-04 | BASELINE TAG                   | `baseline-pre-audit` after 14 grouped commits; tree verified identical (318/321 unchanged, 3 intentional edits, 0 lost); typecheck 0, tests 82/530, build OK, **lint exit 1 (no lint script)**, coverage unmeasured.                                                                                                                                                      |
| 2026-11-04 | STEP-2 RESEARCH                | `docs/RESEARCH.md` added; typecheck 0 / 82 files / 530 tests / 37.86 s; DE442 is newest (DE441 claim wrong); ASSIST 16-asteroid perturber list sourced; `ARCHITECTURE.md:170` cites a stale Bulletin C.                                                                                                                                                                   |
| 2026-11-04 | STEP-3a BOUNDARY               | Guard widened to cover `universe` (failed first, as proof), physics→universe cycle removed; 82 files / **531** tests pass, typecheck 0, build 0.                                                                                                                                                                                                                          |
| 2026-11-05 | STEP-3b QUALITY GATES          | ESLint and V8 coverage added; first lint found 37 errors, fixed; clean install and production checks pass; 82 files / 531 tests; overall 63.29 % lines, physics 93.25 % lines / 69.69 % branches, frames 100 %; 0 runtime audit findings, 10 moderate dev-only minimatch advisories remain.                                                                               |
| 2026-11-05 | STEP-3c OBSERVABILITY          | Central logger, health registry, and finite/energy/angular-momentum/barycenter invariant checks added and wired through worker frames; first core run found 2 real defects, fixed; 83 files / 539 tests pass in 43.66 s, coverage 153.58 s after a 120→300 s explicit slow-test fix; overall 63.41 % lines, observability 91.66 % lines / 71.11 % branches.               |
| 2026-11-05 | STEP-4a SOURCE TRUTH           | Physical constants consolidated with an automated duplicate-literal boundary test; panel GMs/radii now derive from loaded body data; galactic model presets labeled LSR/R0-only; full regression 83 files / **540** tests, typecheck/lint/build exit 0; README, ARCHITECTURE and compliance docs rewritten to remove certification and unrecorded numerical claims.       |
| 2026-11-05 | STEP-5 TIME SCALES             | Removed the fixed TDB−UTC shortcut, completed the periodic TDB↔TT inverse, routed all Date↔JD conversions through UTC→TAI→TT→TDB, corrected panel scale labels, and added 2 tests; full regression 83 files / **542** tests in 41.32s, typecheck/lint/build exit 0. Retained observed eclipse output: 1.19-minute timing error and 0.891° minimum separation on this run. |
| 2026-11-05 | STEP-5b ORIENTATION PROPERTIES | Added seeded fast-check tests for right-handedness, orthonormality and body/ecliptic round-trips across every rotating body over ±50 years; an invalid full-matrix sidereal-closure property was removed after counterexamples. Full regression 84 files / **544** tests in 40.66s; typecheck/lint/build exit 0; large bundle and WGCCRE-range enforcement remain open.   |
| 2026-11-05 | STEP-6 SPK VALIDATION          | DAF/SPK type 2/3 reader (`src/sim/spk.ts`) added and compared against NAIF's MD5-verified `de440.bsp`/`de440s.bsp`; the first run failed by up to 526 km and proved the sim realized its ecliptic with the IAU 2006 obliquity while every Horizons vector sits on the IAU76/80 plane (0.042 arcsec), fixed in `9fd4922`; nine bodies then agree to 2.4e-4 m and 7.1e-8 mm/s and the test limits are set from that measurement. Full regression 86 files / **559** tests in 54.12 s; coverage re-measured at 63.73 % lines overall and 83.92 % for `spk.ts`; typecheck/lint/build exit 0; kernels stay out of Git and no CSPICE cross-check exists yet (OPEN-005/007). |
| 2026-11-05 | STEP-7 RUNTIME EPHEMERIS       | Measured the ephemeris/display path against the MD5-verified `de440.bsp`: the tables themselves agree with the kernel to ≤0.127 km, but five bodies (Sun + outer planets, 9-day anchors) were frozen at their epoch vector because one date bracket was shared by all bodies — Jupiter off by 7.3e+8 km at +700 d, fixed to 8.2e-2 km by `b8f21d2`; SPK path chaining added in `0d9743c`; ±300 d now measures ≤1.0 km (Mercury 1.014e+2 km, limit set at 200 km) while the −1..+2 yr anchor span versus the claimed ±10/+50 yr window is recorded as AUDIT-51/OPEN-008 (1.1e+8–2.8e+9 km, 0.8–18.6 AU). Full regression 87 files / **571** tests in 51.52 s; typecheck/lint/build exit 0. |
| 2026-11-05 | STEP-7b ANCHOR DENSITY         | A sparse velocity-free anchor at +365.25 d sat inside the dense 1.5-day span and forced the blended fallback: Earth 3.09e+5 km and Mercury 4.80e+5 km at +365 d. `e92467f` lets fine anchors win inside their own span, giving 1.83e-1 km (Earth) and 2.24e+1 km (Mercury) there, and the kernel sweep widened to −364..+724 d at 0.5 d: worst 8.011e+1 km (Mercury), every other body ≤ 1.3 km, velocities ≤ 1.856e-3 km/s. Full regression 87 files / **571** tests in 41.56 s; typecheck/lint/build exit 0; the coverage edge (+724 d onward) stays AUDIT-51/OPEN-008. |

# Planet texture attribution

Third-party image assets in this directory are **not** produced by this project.

## Source

| Field | Value |
| :--- | :--- |
| Provider | Solar System Scope |
| Source page | `https://www.solarsystemscope.com/textures/` |
| Download endpoint | `https://www.solarsystemscope.com/textures/download/` |
| Specific files | `2k_mercury.jpg`, `2k_venus_atmosphere.jpg`, `2k_earth_daymap.jpg`, `2k_moon.jpg`, `2k_mars.jpg`, `2k_jupiter.jpg`, `2k_saturn.jpg`, `2k_uranus.jpg`, `2k_neptune.jpg` |
| License, as stated on the source page | "Distributed under Attribution 4.0 International license: You may use, adapt, and share these textures for any purpose, even commercially." |
| License identifier | CC BY 4.0 (Creative Commons Attribution 4.0 International) |
| Date accessed and verified by this project | 2026-11-04 |
| Provider page date marker | The same paragraph carries the year marker `(2019)` on the source page. |

## Credit

Per CC BY 4.0, credit is given to the creator: **Solar System Scope
(solarsystemscope.com)**, whose free planetary-texture set these files are. The
provider's own attribution sentence is quoted verbatim above.

## What this project did to the files

**Nothing.** Each file is the byte stream returned by the HTTP response, written
to disk unchanged — `scripts/fetch-textures.mjs:39` writes the raw buffer
(`await writeFile(dest, buf)`) and hashes that same buffer (`:62`,
`createHash('sha256').update(buf)`), so `manifest.json`'s `bytes` and `sha256`
describe the untouched originals. No resizing, re-encoding, cropping,
colour-adjusting or retouching was performed. Filenames were shortened on disk
(`2k_mars.jpg` → `mars.jpg`); the mapping is recorded in
[`manifest.json`](./manifest.json) per file, together with `fetchedAtUtc`
(`2026-10-07T07:07:18.792Z`) and the URL each file came from.

## What these files are, and are not

They are **artistically rendered equirectangular maps**, not raw spacecraft
imagery and not measured albedo data. Surface colouring, cloud cover and
illumination are the provider's rendering choices. ASTRION therefore treats them
as appearance only: they are never used to derive a physical quantity, and no
position, radius, rotation or reflectance calculation reads these pixels. Solar
radiation pressure uses a computed disc model, not these maps.

Not included here: the Sun and every moon keep ASTRION's own seeded procedural
textures (`scripts/fetch-textures.mjs:5-8` records that the Sun is
hotlink-protected at the provider). If any file in this directory is missing at
runtime, `src/render/bodyVisual.ts` falls back to the procedural map for that
body, so the app still runs offline and the asset is never silently required.

## Verification

`tests/textures-manifest.test.ts` recomputes each file's SHA-256 and compares it
to `manifest.json`, so a swapped or corrupted asset fails the test suite. Re-run
the check with `npm test` or fetch a fresh set with `npm run fetch:textures`.
Measured results are recorded in
[../VALIDATION_LOG.md](../VALIDATION_LOG.md).

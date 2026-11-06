# Security

_(Added 2026-11-06 as part of the AUDIT-30 traceability set. This file describes
the security posture of **this repository as it exists today** — what the code
actually does, what is measured, and what is not yet in place. It is not an
attestation.)_

## 1. Reporting a vulnerability

Report through **GitHub → Security → Report a vulnerability** on this repository
(private vulnerability reporting). Do not open a public issue for anything
exploitable. There is no email address, PGP key, or SLA to claim here; if you are
reading this in a fork, report against the upstream repository.

## 2. What this application actually is

A static, client-only browser application. Verified against the source tree, not
assumed:

- **No server component, no accounts, no authentication.** The repository contains
  a Vite build producing `dist/` and a Web Worker; there is no backend code.
- **No client-side persistence.** `grep` over `src/` for `localStorage`,
  `sessionStorage`, `indexedDB`, and `document.cookie` returns zero hits, so the app
  stores no user data and sets no cookies.
- **No secrets in the tree.** No `.env` files, keys, or tokens are committed; the
  JPL APIs used require no credentials. NAIF `.bsp` kernels are never committed
  (OPEN-005) — `npm run verify:spk` downloads them into a gitignored cache and
  checks them against NAIF's published MD5.
- **One free-text input.** The catalog search box (`#cosmicSearchInput`) is the only
  `type="text"` control in `src/ui/panel.ts`; everything else is button, checkbox,
  range, number, or date.

## 3. Network behavior

- **Startup makes no external requests.** This is a browser-audit assertion
  (`scripts/ui-audit.mjs`: "startup makes no external network requests"), and the
  app is separately verified to boot with all non-local origins blocked.
- **The only outbound API call is user-initiated.** "Sync Horizons" queries
  `https://ssd.jpl.nasa.gov/api/horizons.api` (in development it goes through the
  Vite proxy at `/api/horizons`, `vite.config.ts:8-13`). If the call fails, the panel
  reports the fallback instead of pretending the sync worked.
- **One outbound link** opens NASA Eyes for the current date and target
  (`src/sim/horizonsClient.ts:219`). The target and time are percent-encoded and the
  window is opened with `noopener,noreferrer` (`src/main.ts:500`).
- **No telemetry, no analytics, no third-party scripts** are loaded.

## 4. Injection surface

UI markup is built with template strings, so the free-text path matters: catalog
search results are passed through `escapeHtml()` (`src/ui/panel.ts:1134`) before
being inserted, and selection reads back a controlled `data-name` from the rendered
node rather than the raw query. The remaining `innerHTML` sites interpolate
app-controlled strings from `src/data/**` and computed numeric readouts.

This is a code-level review statement, not a fuzz-test result: no XSS test suite
exists, and no third-party HTML sanitizer is used.

## 5. Dependency and supply-chain posture

| Control | Status (measured) |
| :--- | :--- |
| `npm audit --omit=dev` in CI | Runs as a job step. Reported **0 runtime findings** at the step-3b measurement; treated as blocking by workflow order. |
| Full `npm audit` locally | **10 moderate advisories**, all development-only (transitive through ESLint/typescript-eslint, `minimatch`). Tracked as OPEN-002; not force-downgraded, because no compatible fixed version is confirmed. |
| Lockfile discipline | `npm ci` is used in CI; `package-lock.json` is committed. TypeScript is intentionally held at 6.0 because typescript-eslint does not yet support the TypeScript 7 compiler API. |
| Data provenance | NAIF text kernels are pinned with local SHA-256 digests (`tests/spice-truth.test.ts`) and DE binary kernels with NAIF's published MD5 + `Last-Modified` + size (`src/data/spice/de-kernel-provenance.json`). Textures are tracked with source URL, size and SHA-256 in `public/textures/manifest.json` and asserted by `tests/textures-manifest.test.ts`. |

## 6. What is **not** in place

Stated so nobody reads more assurance into this file than the repository supports:

- **No Content-Security-Policy.** `index.html` sets no CSP meta tag and no
  `serve-headers` file exists. Adding one is untested against the Web Worker and
  Three.js paths, so it has not been claimed.
- **No Subresource Integrity attributes** — there are currently no external script or
  stylesheet tags to protect, so SRI would be decoration.
- **No automated dependency update** (Renovate/Dependabot) is configured, and no
  secret-scanning or codeql analysis job is claimed to have run.
- **No penetration test, no SAST run, and no security review by an independent
  party** has been performed.
- **HTTP transport protections are deployment-dependent.** The repository builds
  static files; HSTS, CSP headers, and sandboxing belong to whatever hosts `dist/`,
  and nothing in this tree configures them.

## 7. Operational safety note

This is a visualization and study tool. Its numerics are documented against JPL/IAU
sources in `docs/VALIDATION_LOG.md` with explicit measured windows and refused
out-of-range dates. It must not be used for operational navigation, collision
avoidance, or any purpose where an unreviewed error could cause harm — see
`docs/NASA_COMPLIANCE.md` §4 for the license and warranty position.

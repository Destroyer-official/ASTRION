# Open questions and unverified claims

This file records assumptions that are useful operationally but not yet supported
by a primary measurement, official specification, or independently reproducible
comparison. It is deliberately separate from `VALIDATION_LOG.md`: entries here
are **not** evidence of production readiness.

| ID | Item | Current treatment | What remains unverified | Owner / next evidence |
| :--- | :--- | :--- | :--- | :--- |
| OPEN-001 | Simulation invariant thresholds in `src/observability/invariants.ts` | Energy, angular-momentum, and barycentric drift all fail above `1e-6` | These are engineering acceptance limits, not physical constants or a mission requirement. They were not measured against an integrator convergence study or DE440 error budget. | Record distributions from +1, +10, and +50 year runs, then set per-integrator/force-model thresholds from those measurements. |
| OPEN-002 | Development-only `minimatch` advisory | CI audits runtime dependencies only; `npm audit` reports 10 moderate advisories through ESLint/typescript-eslint | No confirmed fixed version compatible with the installed dependency contracts | Track upstream ESLint release; do not force downgrade or override major versions without compatibility tests. |
| OPEN-003 | TT/TDB constant provenance | `src/data/constants.ts` supplies values currently used by the time conversion tests | Exact primary source for every coefficient was not fetched during the audit | Locate and cite the official Fairhead–Bretagnon/IERS source, then compare with an independent implementation. |
| OPEN-004 | Leap-second table currency | Current table reflects the last published transition available during research | Whether any future IERS Bulletin C transition has been announced after the recorded check date | Re-fetch the official IERS bulletin before each release and update provenance/date. |
| OPEN-005 | `.bsp` redistribution status | Research confirmed terms for the Solar System Scope textures, but not for binary JPL kernel redistribution | Whether large DE kernel files may be redistributed in this repository | Obtain/record official NAIF redistribution permission or keep kernels out of source control. |
| OPEN-006 | Ephemeris extrapolation outside kernel range | UI currently allows dates outside documented validity without an explicit hard gate | Exact NAIF policy/error behavior beyond the supported interval | Implement and verify a documented warning/error boundary and validity check. |

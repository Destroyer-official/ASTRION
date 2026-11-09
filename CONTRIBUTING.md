# Contributing to ASTRION

Thank you for your interest in contributing to ASTRION (Astronomical State & Trajectory Reconstruction Engine for Interplanetary & Orbital Navigation).

To maintain scientific integrity, high precision, and codebase resilience, all contributions must strictly adhere to the standards outlined below.

---

## 1. Scientific Truthfulness & Provenance

1. **Truth in Claims:**
   - Never claim official NASA/ESA certification, space agency endorsement, or flight-grade rating unless formally accredited.
   - All physical parameters, constants, and ephemeris tables must cite peer-reviewed literature or official astronomical standards (e.g., IAU/IAG WGCCRE, NASA JPL DE440/DE441, IERS Conventions 2010).
2. **Single Source of Truth:**
   - Physical constants must be declared once in `src/data/constants.ts` and imported down. Duplicate constant definitions are rejected by boundary tests.
3. **Traceability:**
   - Any modification to numerical models, integrators, or coordinate systems must include unit test verification against published numerical benchmarks or JPL Horizons truth vectors.

---

## 2. Architectural Boundaries & Isolation

ASTRION enforces strict unidirectional layering:

```
[UI Layer] (`src/ui`)
    ↓
[Render Layer] (`src/render`)
    ↓
[Simulation & Ephemeris] (`src/sim`, `src/workers`)
    ↓
[Reference Frames & Coordinates] (`src/frames`)
    ↓
[Astrodynamics & Physics] (`src/physics`)
    ↓
[Canonical Data & Constants] (`src/data`)
```

- **Purity Rule:** `src/physics/` and `src/frames/` must remain pure mathematical engines. They must never import Three.js, access DOM elements (`window`, `document`), query wall-clock time (`Date.now()`, `new Date()`), or rely on unseeded randomness.
- **Dependency Injection:** Avoid module-level mutable singletons. Pass configuration, clocks, and network clients via constructor options or factory functions.
- **Fault Isolation:** UI components and rendering loops must handle worker and data errors defensively. An error in one panel must never crash the animation loop or halt simulation propagation.

---

## 3. Code Quality & TypeScript Standards

- **Strict Type Checking:**
  - TypeScript runs with `"strict": true` and `"noUncheckedIndexedAccess": true`.
  - Non-null assertions (`!`) on indexed array lookups must be used judiciously and justified.
  - Avoid `any` types; prefer strict interfaces, branded unit types (`src/physics/units.ts`), and type guards.
- **Linting & Formatting:**
  - Code must pass ESLint cleanly (`npm run lint`).
  - Formatting is managed via Prettier (`npm run format`).

---

## 4. Verification & Quality Gates

Before submitting changes, all gates must be green:

```bash
# 1. Typecheck
npm run typecheck

# 2. Lint check
npm run lint

# 3. Unit and integration tests (Vitest)
npm run test

# 4. Production build
npm run build

# 5. Full end-to-end production gate
npm run verify:prod
```

For browser and UI validation:
```bash
# Preview build and headless browser audit
npm run preview
npm run audit:ui
```

---

## 5. Commit Guidelines

- **Atomic Commits:** One logical change per commit.
- **Conventional Commits:** Use clear commit messages following Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Keep pull requests focused, reproducible, and accompanied by automated tests.


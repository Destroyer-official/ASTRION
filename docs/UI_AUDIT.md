# UI audit

## Latest measured result (coverage gate)

```text
Measured on 2026-11-06 at commit 6649aba
$ UI_URL=http://127.0.0.1:5173/ npm run audit:ui

checks passed: 31
checks failed:  0
```

The additional checks prove that ephemeris mode:

- displays the validated date range;
- sets `min` and `max` on the date picker;
- clamps a request one day past the end to the last validated day;
- announces the clamp in an `aria-live` status region;
- stays free of application errors while doing so.

Measured values from that run:

```text
Ephemeris validated from 2025-10-05 to 2028-09-28 UTC.
Requested 2028-09-29 → applied 2028-09-28.
```

The step-8 result below is retained as the historical measurement that established
the 27-check accessibility and interaction baseline. The current committed gate is
the 31-check result above.

## Step 8 baseline: measured on 2026-11-06 at commit `90f1520`
(`test(ui): exercise every visible form control in the audit`).

## Result

```text
$ UI_URL=http://127.0.0.1:5173/ npm run audit:ui

checks passed: 27
checks failed:  0
```

The audit runs in a real Chromium-family browser using the installed system
Chrome. The bundled Playwright Chromium is absent on this machine, so the harness
reports and uses its documented fallback:

```text
engine: system chrome
```

The application was served by Vite at `http://127.0.0.1:5173/`. The `/api/horizons`
route was stubbed with a non-vector response so the Horizons fallback could be
tested without depending on the public API's transient availability. No other
application code was mocked.

## What was exercised

| Area | Measured result |
| :--- | :--- |
| Desktop boot | Canvas visible after 6,840 ms |
| Desktop layout | Canvas 1440 × 900; panel 366 px; no horizontal overflow |
| Mobile boot | Canvas visible after 6,457 ms |
| Mobile layout | Canvas 390 × 844; panel 362 px; no horizontal overflow |
| Visible controls exercised | 15 buttons, 9 selects, 10 checkboxes, 2 ranges, 3 number inputs, 1 date input |
| Accessibility inventory | 41 visible controls, 0 unnamed, 0 with a negative tab order, 1 heading, 2 `aria-live` regions |
| Document metadata | `lang="en"`; no image missing alternate text |
| WCAG AA text contrast | All measured selectors pass |
| Catalog search | `Mars` returned 1 result; selecting it updated state to `mars`; clear emptied the query |
| Live sync fallback | Stubbed Horizons failure showed `Local DE440 (live unavailable)` |
| Animation fault resilience | Render loop resumed after an injected render exception |
| Fault reporting | Injection produced new console and health reports rather than being swallowed |
| Network isolation | Startup produced zero external requests; it booted with external requests blocked |

Measured contrast ratios:

| Element | Ratio | Font size |
| :------ | ----: | :-------- |
| `#readout` | 11.28:1 | 11.5 px |
| `#panel` | 18.84:1 | 16 px |
| `#date` | 16.9:1 | 12 px |
| `#speedLabel` | 9.8:1 | 11 px |
| `#dynamicsStatus` | 12.6:1 | 11 px |
| `#focus` | 16.9:1 | 12 px |

The 41 visible controls were confirmed to have accessible names. The interaction
sweep opened every collapsible tool section and exercised all visible controls in
the first two listed groups. The inventory counts the catalog text box, date field,
number fields, buttons, selects, checkboxes, ranges, and search controls together.

The exact checks that passed were:

1. Desktop application became visible within 15 seconds.
2. Desktop startup console contained no errors or warnings.
3. WebGL canvas was present on desktop.
4. Desktop document had no horizontal overflow.
5. Canvas spanned the desktop window.
6. The panel exposed at least 20 visible controls.
7. Every visible control had an accessible name.
8. Element IDs were unique.
9. Document language was declared as `en`.
10. No image lacked alternate text.
11. Dynamic readout areas used `aria-live`.
12. Panel text met WCAG AA contrast.
13. A failed live Horizons sync reported local DE440 fallback.
14. All exercised controls responded without errors or a stalled animation loop.
15. Catalog search returned a result.
16. Catalog search selection updated application state.
17. Catalog search clear emptied the query.
18. The animation loop survived an injected render fault.
19. The injected fault was reported rather than swallowed.
20. Startup made no external network requests.
21. The application booted with external network requests blocked.
22. The animation loop remained live during the isolated boot.
23. Mobile application became visible within 15 seconds.
24. Mobile startup console contained no errors or warnings.
25. WebGL canvas was present on mobile.
26. Mobile document had no horizontal overflow.
27. The mobile panel remained inside the viewport.

## Defects found and fixed during this audit

### Live-sync failure was presented as success

The previous button handler treated every result object as a successful live sync.
A failed query therefore displayed `✓ Synced` while the state remained local. The
handler now distinguishes:

- successful live vectors: `✓ Horizons Synced`;
- live query unavailable, local anchor fallback used: `Local DE440 (live unavailable)`;
- unexpected handler failure: `Sync failed — state unchanged`.

The button is disabled while the asynchronous request is in flight. The browser
audit proves the fallback wording by stubbing the local Horizons proxy and asserting
that the control reports local truth.

### Refreshing the facts card destroyed its close control

The facts card rewrote `#factsBox.innerHTML` during each telemetry update. Its
close button was recreated before every Playwright interaction, producing a real
detached-element timeout and repeatedly discarding keyboard focus.

The header and close button are now persistent. Updates write:

- body name through `#factsTitle.textContent`;
- dynamic values through `#factsContent.innerHTML`.

This preserves the focusable close control and gives it the accessible name
`Close selected body facts`.

### The audit itself incorrectly tested invisible bindings and localhost offline

The first harness reported two false UI findings:

1. It cycled hidden internal selects and closed tool sections.
2. It used browser-wide offline mode, which also blocked the local development
   server, then called that an offline boot.

It now skips hidden controls, expands details sections before interaction, reports
per-option progress, and tests the intended condition instead: startup makes no
external HTTP requests and still boots when external requests are blocked. Localhost
remains reachable because the application itself is served locally.

## Commands used

```bash
npm run dev -- --host 127.0.0.1
UI_URL=http://127.0.0.1:5173/ npm run audit:ui
npm run verify:prod
```

The production gate completed after the final audit change:

```text
npm run typecheck      exit 0
npm run lint           exit 0
npm test               88 files / 575 tests passed
                       duration 41.95s
npm run build          exit 0
                       main chunk 1,261.98 kB
                       gzip 393.09 kB
                       worker chunk 62.65 kB
```

## Scope and remaining limitations

This is a browser-behavior audit, not certification of the user interface.

- It uses one Chromium-family engine. Firefox and WebKit were not run.
- It asserts accessible names and live regions, not an end-to-end screen-reader
  transcript.
- It tests layout overflow at 1440 × 900 and 390 × 844, not every viewport or zoom
  level.
- External network requests are blocked; true cold-start operation without the local
  application server is not claimed because no service-worker offline application
  cache exists.
- The large-chunk warning remains open: the production main chunk measured
  1,261.98 kB raw and 393.09 kB gzipped.
- Playwright coverage is wired into `.github/workflows/ci.yml` by commit `952b238`,
  but no successful GitHub Actions run is claimed from this local record.
- The exact ephemeral screenshots live in the gitignored directory
  `ui-audit-artifacts/`; this file records the pass/fail measurements rather than
  treating screenshots as an assertion.

// Full-browser UI audit. Start the dev server first (`npm run dev`, or set UI_URL).
//   npm run audit:ui
//
// Drives the real application with Playwright and fails on regressions unit tests
// cannot see: console errors during load, controls that do not respond, missing
// accessibility names, layout overflow at mobile width, a main thread blocked long
// enough to feel like a freeze, an animation loop that dies on a render fault, and
// any dependence on the network at startup. Results stream as they are measured.
// Screenshots land in ui-audit-artifacts/ (gitignored).
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const URL_BASE = process.env.UI_URL ?? 'http://localhost:5173/';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const ARTIFACTS = 'ui-audit-artifacts';

// Controls that legitimately run solver work (Lambert, porkchop, B-plane, chained
// date seeks). They must still finish, just on a longer budget than a toggle.
const LONG_RUNNING = new Set([
  'go',
  'now',
  'reseedBtn',
  'realtimeBtn',
  'porkchopBtn',
  'lambertSolveBtn',
  'bplaneComputeBtn',
  'backboneComputeBtn',
]);
const SETTLE_BUDGET_MS = 8_000;
const LONG_BUDGET_MS = 60_000;

const failures = [];
let passes = 0;

function line(text) {
  console.log(text);
}

function check(condition, label, detail) {
  if (condition) {
    passes++;
    line(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    line(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function launch() {
  try {
    return { browser: await chromium.launch({ headless: true }), engine: 'bundled chromium' };
  } catch (bundledError) {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    return { browser, engine: `system chrome (bundled chromium missing: ${String(bundledError).split('\n')[0]})` };
  }
}

function attachCollectors(page, bucket) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') bucket.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => bucket.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => bucket.push(`requestfailed: ${request.url()}`));
}

/** Counts the app's own render calls, so "still alive" means the real frame loop ran. */
async function installProbe(page) {
  await page.evaluate(() => {
    const viewer = window.__viewer;
    if (!viewer) throw new Error('no __viewer debug handle exposed');
    window.__renderCount = 0;
    const original = viewer.render.bind(viewer);
    viewer.render = (...args) => {
      window.__renderCount++;
      return original(...args);
    };
    window.__originalRender = original;
  });
  return page.evaluate(() => window.__renderCount ?? 0);
}

async function settle(page, budgetMs) {
  const start = Date.now();
  const before = await page.evaluate(() => window.__renderCount ?? 0);
  while (Date.now() - start < budgetMs) {
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => window.__renderCount ?? 0);
    if (after > before) return after - before;
  }
  return null;
}

async function expectLive(page, label) {
  const elapsed = await settle(page, SETTLE_BUDGET_MS);
  check(elapsed !== null, `${label}: animation loop still advancing`, elapsed === null ? 'no render call within budget' : `${elapsed} frames`);
}

async function auditViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(500);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const panel = document.querySelector('#panel');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      canvas: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
    };
  });
  line(
    `      layout: canvas ${layout.canvas?.width ?? 'none'}x${layout.canvas?.height ?? '-'}, ` +
      `panel ${layout.panelWidth ?? '-'}px at top ${layout.panelTop ?? '-'}, ` +
      `document ${layout.scrollWidth}x${layout.scrollHeight} in ${layout.clientWidth}x${layout.clientHeight}`,
  );
  check(Boolean(layout.canvas), `${viewport.name}: WebGL canvas present`);
  check(
    layout.scrollWidth <= layout.clientWidth,
    `${viewport.name}: no horizontal overflow`,
    `scrollWidth ${layout.scrollWidth} vs client ${layout.clientWidth}`,
  );
  if (viewport.name === 'desktop' && layout.canvas) {
    check(layout.canvas.width >= viewport.width * 0.9, 'desktop: canvas spans the window', `${layout.canvas.width}px`);
  } else if (viewport.name === 'mobile' && layout.panelWidth !== null) {
    check(
      layout.panelWidth <= viewport.width && layout.panelTop >= -2,
      'mobile: panel stays inside the viewport',
      `${layout.panelWidth}px wide, top ${layout.panelTop}`,
    );
  }
  await page.screenshot({ path: `${ARTIFACTS}/load-${viewport.name}.png` });
}

async function accessibilityInventory(page) {
  return page.evaluate(() => {
    const accessibleName = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria?.trim()) return aria.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const other = document.getElementById(labelledBy);
        if (other?.textContent?.trim()) return other.textContent.trim();
      }
      if (el.id) {
        const explicit = document.querySelector(`label[for="${el.id}"]`);
        if (explicit?.textContent?.trim()) return explicit.textContent.trim();
      }
      const wrapped = el.closest('label');
      if (wrapped?.textContent?.trim()) return wrapped.textContent.trim();
      if (el.tagName === 'BUTTON' || el.tagName === 'SELECT') return el.textContent?.trim() ?? '';
      return el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '';
    };
    const controls = [...document.querySelectorAll('button, select, input, textarea, [role=button]')];
    const describe = (el) => `${el.tagName.toLowerCase()}#${el.id || '(no id)'}${el.type ? `/${el.type}` : ''}`;
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    return {
      total: controls.filter((el) => el.offsetParent !== null).length,
      hidden: controls.length - controls.filter((el) => el.offsetParent !== null).length,
      unnamed: controls
        .filter((el) => el.offsetParent !== null)
        .filter((el) => !accessibleName(el))
        .map(describe),
      outOfTabOrder: controls.filter((el) => el.tabIndex < 0).map(describe),
      duplicateIds: [...ids].filter(([, count]) => count > 1).map(([id]) => id),
      lang: document.documentElement.lang,
      title: document.title,
      imagesWithoutAlt: [...document.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')).length,
      liveRegions: document.querySelectorAll('[aria-live]').length,
      headings: document.querySelectorAll('h1, h2, h3').length,
    };
  });
}

async function contrastAudit(page) {
  const entries = await page.evaluate(() => {
    const parse = (value) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const luminance = (rgb) => {
      const [r = 0, g = 0, b = 0] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const out = [];
    for (const selector of ['#readout', '#panel', '#date', '#speedLabel', '#dynamicsStatus', '#focus']) {
      const el = document.querySelector(selector);
      if (!el) {
        out.push({ selector, missing: true });
        continue;
      }
      const style = getComputedStyle(el);
      const foreground = parse(style.color);
      let background = parse(style.backgroundColor);
      let node = el;
      while (background.length < 3 && node.parentElement) {
        node = node.parentElement;
        background = parse(getComputedStyle(node).backgroundColor);
      }
      const ratios = [luminance(foreground), luminance(background ?? [0, 0, 0])].sort((a, b) => b - a);
      out.push({
        selector,
        ratio: Number(((ratios[0] + 0.05) / (ratios[1] + 0.05)).toFixed(2)),
        fontSize: style.fontSize,
        foreground: `rgb(${foreground.join(',')})`,
        background: `rgb(${(background ?? []).join(',')})`,
      });
    }
    return out;
  });
  for (const entry of entries) {
    if (entry.missing) {
      line(`      contrast ${entry.selector}: element not found`);
      continue;
    }
    line(`      contrast ${entry.selector}: ${entry.ratio}:1 at ${entry.fontSize} (${entry.foreground} on ${entry.background})`);
  }
  const failing = entries.filter(
    (entry) => !entry.missing && entry.ratio < 4.5 && Number.parseFloat(entry.fontSize) < 24,
  );
  check(failing.length === 0, 'panel text meets WCAG AA contrast', failing.map((e) => `${e.selector} ${e.ratio}:1`).join(', '));
}

async function interactionSweep(page, bucket) {
  const slow = [];
  const broken = [];

  const run = async (kind, label, action, budgetMs) => {
    const before = bucket.length;
    await action();
    const elapsed = await settle(page, budgetMs);
    if (bucket.length > before) broken.push(`${kind} ${label}: ${bucket[before]}`);
    if (elapsed === null) broken.push(`${kind} ${label}: frame loop never resumed within ${budgetMs} ms`);
    else if (elapsed > SETTLE_BUDGET_MS) slow.push(`${kind} ${label} took ${elapsed} ms`);
  };

  const buttons = page.locator('#panel button, #panel [role=button]');
  const buttonCount = await buttons.count();
  for (let index = 0; index < buttonCount; index++) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const id = await button.evaluate((el) => el.id || el.textContent?.trim() || '(unlabelled)');
    await run('button', id, () => button.click({ timeout: 3_000, force: true }).catch(() => undefined), LONG_RUNNING.has(id) ? LONG_BUDGET_MS : SETTLE_BUDGET_MS);
  }

  const selects = page.locator('#panel select');
  const selectCount = await selects.count();
  for (let index = 0; index < selectCount; index++) {
    const select = selects.nth(index);
    const id = await select.evaluate((el) => el.id);
    const options = await select.evaluate((el) => [...el.options].map((option) => option.value));
    const before = bucket.length;
    for (const value of options) {
      await select.selectOption(value).catch(() => undefined);
      await page.waitForTimeout(40);
    }
    if (options[0] !== undefined) await select.selectOption(options[0]).catch(() => undefined);
    const elapsed = await settle(page, SETTLE_BUDGET_MS);
    if (bucket.length > before) broken.push(`select ${id}: ${bucket[before]}`);
    if (elapsed === null) broken.push(`select ${id}: frame loop frozen after cycling ${options.length} options`);
    slow.push(`select ${id}: ${options.length} options cycled in ${elapsed ?? '>16000'} ms`);
  }

  const toggles = page.locator('#panel input[type=checkbox]');
  const toggleCount = await toggles.count();
  for (let index = 0; index < toggleCount; index++) {
    const box = toggles.nth(index);
    const id = await box.evaluate((el) => el.id);
    const before = bucket.length;
    await box.click({ force: true }).catch(() => undefined);
    const first = await box.evaluate((el) => el.checked);
    await page.waitForTimeout(120);
    await box.click({ force: true }).catch(() => undefined);
    const second = await box.evaluate((el) => el.checked);
    if (bucket.length > before) broken.push(`checkbox ${id}: ${bucket[before]}`);
    if (first === second) broken.push(`checkbox ${id}: state did not toggle (${first})`);
  }

  const ranges = page.locator('#panel input[type=range]');
  const rangeCount = await ranges.count();
  for (let index = 0; index < rangeCount; index++) {
    const range = ranges.nth(index);
    const id = await range.evaluate((el) => el.id);
    const before = bucket.length;
    await range.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, String(((Number(el.min) || 0) + (Number(el.max) || 100)) / 2));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const value = await range.evaluate((el) => el.value);
    if (bucket.length > before) broken.push(`range ${id}: ${bucket[before]}`);
    if (!value) broken.push(`range ${id}: empty value after input`);
  }

  check(broken.length === 0, 'controls respond without errors or freezes', broken.slice(0, 8).join(' | '));
  if (slow.length > 0) line(`      slow interactions: ${slow.slice(0, 12).join(', ')}`);
  return { buttonCount, selectCount, toggleCount, rangeCount, broken, slow };
}

async function faultInjection(page, bucket) {
  const before = bucket.length;
  await page.evaluate(() => {
    const viewer = window.__viewer;
    if (!viewer) throw new Error('no __viewer debug handle exposed');
    const original = viewer.render.bind(viewer);
    viewer.render = (display, options) => {
      viewer.render = original;
      throw new Error('injected render fault');
    };
  });
  await expectLive(page, 'after an injected render fault');
  check(bucket.length > before, 'the injected fault was reported, not swallowed', `${bucket.length - before} new console messages`);
  await page.screenshot({ path: `${ARTIFACTS}/after-fault.png` });
}

async function offlineBoot(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.setOffline(true);
  const page = await context.newPage();
  const bucket = [];
  attachCollectors(page, bucket);
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.waitForTimeout(2_000);
  const errors = bucket.filter((entry) => !entry.startsWith('requestfailed'));
  check(errors.length === 0, 'app boots with the network offline', errors.slice(0, 3).join(' | '));
  await expectLive(page, 'offline boot');
  await page.screenshot({ path: `${ARTIFACTS}/offline-load.png` });
  await context.close();
}

const { browser, engine } = await launch();
line(`engine: ${engine}`);
await mkdir(ARTIFACTS, { recursive: true });

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const bucket = [];
    attachCollectors(page, bucket);

    const start = Date.now();
    await page.goto(URL_BASE, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 20_000 });
    const bootMs = Date.now() - start;
    line(`--- ${viewport.name} ${viewport.width}x${viewport.height}: canvas after ${bootMs} ms`);
    check(bootMs < 15_000, `${viewport.name}: app becomes visible within 15 s`, `${bootMs} ms`);

    await page.waitForTimeout(2_500);
    const startupErrors = bucket.filter((entry) => !entry.startsWith('requestfailed'));
    check(startupErrors.length === 0, `${viewport.name}: clean console during startup`, startupErrors.slice(0, 4).join(' | '));

    await auditViewport(page, viewport);

    if (viewport.name === 'desktop') {
      const inventory = await accessibilityInventory(page);
      line(
        `      a11y: ${inventory.total} controls, ${inventory.unnamed.length} unnamed, ` +
          `${inventory.outOfTabOrder.length} out of the tab order, ${inventory.headings} headings, ` +
          `${inventory.liveRegions} aria-live regions, lang="${inventory.lang}", title="${inventory.title}"`,
      );
      check(inventory.total >= 20, 'the panel exposes its control surface', `${inventory.total} controls`);
      check(inventory.unnamed.length === 0, 'every control has an accessible name', inventory.unnamed.slice(0, 8).join(', '));
      check(inventory.duplicateIds.length === 0, 'element ids are unique', inventory.duplicateIds.join(', '));
      check(inventory.lang === 'en', 'document language declared', inventory.lang || 'missing');
      check(inventory.imagesWithoutAlt === 0, 'no image without alt text', `${inventory.imagesWithoutAlt}`);
      check(inventory.liveRegions > 0, 'dynamic readout is announced via aria-live', `${inventory.liveRegions} regions`);

      await installProbe(page);
      await contrastAudit(page);
      await interactionSweep(page, bucket);
      await faultInjection(page, bucket);
      await offlineBoot(browser);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

line('\n=== UI AUDIT SUMMARY ===');
line(`checks passed: ${passes}`);
line(`checks failed: ${failures.length}`);
for (const failure of failures) line(`  - ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);

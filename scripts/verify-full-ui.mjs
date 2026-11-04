import { chromium } from 'playwright';

async function verifyFullUI() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.toString()));

  console.log('1. Loading application at http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const title = await page.title();
  console.log('   Page Title:', title);

  // 2. Test Reality Inspector toggle
  console.log('2. Testing Reality Inspector toggle...');
  const toggleReality = page.locator('#toggleReality');
  const realityInspector = page.locator('#realityInspector');
  console.log('   Initially visible:', await realityInspector.isVisible());
  await toggleReality.click();
  await page.waitForTimeout(300);
  console.log('   Visible after click:', await realityInspector.isVisible());
  const realityText = await realityInspector.innerText();
  console.log('   Reality tags snippet:', realityText.split('\n').slice(0, 4).join(' | '));
  await toggleReality.click(); // collapse back
  await page.waitForTimeout(200);

  // 3. Test Validation Table Modal
  console.log('3. Testing Validation Table modal...');
  const valTableBtn = page.locator('#valTableBtn');
  const valTableBox = page.locator('#valTableBox');
  const closeValTable = page.locator('#closeValTable');
  await valTableBtn.click();
  await page.waitForTimeout(300);
  console.log('   Val Table visible:', await valTableBox.isVisible());
  const valTableText = await valTableBox.innerText();
  console.log('   Val table title/header:', valTableText.split('\n')[0]);
  await closeValTable.click();
  await page.waitForTimeout(200);
  console.log('   Val Table closed:', !(await valTableBox.isVisible()));

  // 4. Test Playback Controls
  console.log('4. Testing Playback Controls (Play/Pause, Forward/Backward, Speed, Date, Reset)...');
  const playBtn = page.locator('#play');
  const revBtn = page.locator('#rev');
  const resetBtn = page.locator('#reset');
  const speedSlider = page.locator('#speed');
  const speedLabel = page.locator('#speedLabel');

  console.log('   Initial play text:', await playBtn.innerText());
  await playBtn.click();
  await page.waitForTimeout(200);
  console.log('   After click play text:', await playBtn.innerText());
  await playBtn.click(); // resume playing

  console.log('   Initial rev text:', await revBtn.innerText());
  await revBtn.click();
  await page.waitForTimeout(200);
  console.log('   After click rev text:', await revBtn.innerText());
  await revBtn.click(); // forward again

  // Speed slider test
  await speedSlider.fill('1.5');
  await page.waitForTimeout(200);
  console.log('   Speed label at 1.5:', await speedLabel.innerText());

  // Date and Go test
  const dateIn = page.locator('#date');
  const goBtn = page.locator('#go');
  const initialDate = await dateIn.inputValue();
  console.log('   Initial date input:', initialDate);
  await dateIn.fill('2028-06-15');
  await goBtn.click();
  await page.waitForTimeout(1000);
  const readoutAfterGo = await page.locator('#readout').innerText();
  console.log('   Readout after Go date (snippet):', readoutAfterGo.split('\n')[0]);

  // Now (Live) button test
  const nowBtn = page.locator('#now');
  await nowBtn.click();
  await page.waitForTimeout(1000);
  const readoutAfterNow = await page.locator('#readout').innerText();
  console.log('   Readout after Now button (snippet):', readoutAfterNow.split('\n')[0]);

  // Reset button
  await resetBtn.click();
  await page.waitForTimeout(500);

  // 5. Test Dynamics Mode Switch (Yoshida-4 N-Body <-> DE440 Ephemeris)
  console.log('5. Testing Dynamics Mode Switch...');
  const toggleDyn = page.locator('#toggleDynamics');
  const dynStatus = page.locator('#dynamicsStatus');
  console.log('   Initial dynamics:', await dynStatus.innerText());
  await toggleDyn.click();
  await page.waitForTimeout(500);
  console.log('   Switched dynamics:', await dynStatus.innerText());
  await toggleDyn.click();
  await page.waitForTimeout(500);
  console.log('   Switched back:', await dynStatus.innerText());

  // 6. Test All Categories of Presets
  console.log('6. Testing All Presets across all categories...');
  const presetCategories = [
    { name: 'Milky Way & Cosmic Scales', container: '#presets-galaxy' },
    { name: 'Solar System Scales', container: '#presets-solar' },
    { name: 'Planetary Moon Systems', container: '#presets-moons' },
    { name: 'Close-Up Planet Visits', container: '#presets-visits' },
    { name: 'Iconic Moon Visits', container: '#presets-moon-visits' },
  ];

  const factsBox = page.locator('#factsBox');

  for (const cat of presetCategories) {
    console.log(`\n   --- Category: ${cat.name} ---`);
    const container = page.locator(cat.container);
    // If inside a details element, expand it first
    await container.evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = true;
    });
    await page.waitForTimeout(100);

    const buttons = page.locator(`${cat.container} button`);
    const count = await buttons.count();
    console.log(`   Found ${count} presets in ${cat.name}`);
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const label = await btn.innerText();
      const presetId = await btn.getAttribute('data-preset');
      await btn.click();
      await page.waitForTimeout(400);

      const factsVisible = await factsBox.isVisible();
      let factsTitle = '';
      if (factsVisible) {
        factsTitle = await factsBox.locator('strong').first().innerText();
      }
      console.log(`      ✓ Preset [${presetId}] "${label}" clicked. Facts card: ${factsVisible ? factsTitle : '(none)'}`);
    }
  }

  // 7. Test Select Dropdowns
  console.log('\n7. Testing Selection Dropdowns...');
  const focusSel = page.locator('#focus');
  const frameSel = page.locator('#frame');
  const scaleModeSel = page.locator('#scaleMode');
  const galModelSel = page.locator('#solarGalaxyModel');
  const integratorSel = page.locator('#integrator');

  // Focus
  await focusSel.selectOption('earth');
  await page.waitForTimeout(300);
  console.log('   Focus changed to Earth. Facts visible:', await factsBox.isVisible());
  await focusSel.selectOption('sun');
  await page.waitForTimeout(300);
  console.log('   Focus changed to Sun. Facts visible:', await factsBox.isVisible());

  // Frame
  await frameSel.selectOption('barycentric');
  await page.waitForTimeout(300);
  console.log('   Frame changed to Barycentric.');

  await frameSel.selectOption('galactic');
  await page.waitForTimeout(300);
  console.log('   Frame changed to Galactic.');

  // Scale mode
  const exagRow = page.locator('#exagRow');
  await scaleModeSel.selectOption('exaggerated');
  await page.waitForTimeout(200);
  console.log('   Scale mode Exaggerated: slider visible =', await exagRow.isVisible());
  await scaleModeSel.selectOption('true');
  await page.waitForTimeout(200);
  console.log('   Scale mode True 1:1: slider visible =', await exagRow.isVisible());
  await scaleModeSel.selectOption('pixels');
  await page.waitForTimeout(200);

  // Galactic Model
  await galModelSel.selectOption('sofue2016');
  await page.waitForTimeout(300);
  const readoutSofue = await page.locator('#readout').innerText();
  console.log('   Galactic model changed to Sofue 2016. Readout snippet:\n     ', readoutSofue.split('\n').filter(l => l.includes('Galactic Model'))[0]);
  await galModelSel.selectOption('iau1985');
  await page.waitForTimeout(300);

  // Integrator
  await integratorSel.selectOption('leapfrog');
  await page.waitForTimeout(200);
  console.log('   Integrator changed to Leapfrog.');
  await integratorSel.selectOption('yoshida4');
  await page.waitForTimeout(200);
  console.log('   Integrator restored to Yoshida 4th order.');

  // 8. Test Physics & Display Checkboxes
  console.log('\n8. Testing Checkboxes & Toggles...');
  const relIn = page.locator('#relativity');
  const quadIn = page.locator('#quadrupole');
  const trailsIn = page.locator('#trails');
  const labelsIn = page.locator('#showLabels');
  const mwIn = page.locator('#showMilkyWay');
  const oortIn = page.locator('#showOortCloud');

  for (const [name, loc] of [
    ['Relativity', relIn],
    ['Quadrupole', quadIn],
    ['Trails', trailsIn],
    ['Labels', labelsIn],
    ['MilkyWay', mwIn],
    ['OortCloud', oortIn],
  ]) {
    const orig = await loc.isChecked();
    await loc.click();
    await page.waitForTimeout(100);
    const toggled = await loc.isChecked();
    await loc.click(); // restore
    console.log(`   Checkbox ${name}: orig=${orig}, toggled=${toggled}`);
  }

  // 9. Inspect Full Final Telemetry Readout
  console.log('\n9. Inspecting Full Telemetry Readout:');
  const fullReadout = await page.locator('#readout').innerText();
  console.log('----------------------------------------------------');
  console.log(fullReadout);
  console.log('----------------------------------------------------');

  // 10. Summary of Console Health
  console.log(`\n10. Browser Console Health Check:`);
  console.log(`    Total console errors: ${consoleErrors.length}`);
  console.log(`    Total console warnings: ${consoleWarnings.length}`);
  if (consoleErrors.length > 0) {
    console.log('    Errors:', consoleErrors);
  }

  await browser.close();
  console.log('\n✓ Complete manual UI verification finished successfully!');
}

verifyFullUI().catch(err => {
  console.error('Fatal error during UI verification:', err);
  process.exit(1);
});

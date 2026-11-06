#!/usr/bin/env node
/**
 * Generate physical-metadata entries for the ASSIST/JPL SB441-N16 massive-asteroid
 * perturbers from the JPL Small-Body Database API.
 *
 * Every number is copied verbatim from the SBDB `phys_par` record together with the
 * reference string the API attaches to that field. GM and mean radius come from the
 * already-provenanced files in src/data/asteroids/. Nothing is interpolated, and no
 * spin pole is invented: SBDB publishes no pole orientation for these bodies and the
 * NAIF PCK does not cover them, so the generated entries carry no `rotation` block.
 *
 * Usage:
 *   node scripts/fetch-asteroid-physical.mjs          # dry run, prints the table
 *   node scripts/fetch-asteroid-physical.mjs --write  # writes missing physical files
 *   node scripts/fetch-asteroid-physical.mjs --write --force  # rewrites existing ones
 */

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const G_CODATA = 6.6743e-11; // m^3 kg^-1 s^-2, CODATA 2018
const CHECKED = new Date().toISOString().slice(0, 10);
const PERTURBER_NOTE = 'ASSIST/JPL n16 massive-asteroid perturber set.';

const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const FORCE = args.has('--force');

function field(entry) {
  const value = String(entry.value).trim();
  const units = entry.units ? ` ${entry.units}` : '';
  // SBDB publishes asymmetric uncertainties as "-1/+4"; rendering them as "± -1/+4"
  // would misread, so pass them through as written.
  const sigma = entry.sigma
    ? String(entry.sigma).includes('/')
      ? ` ${String(entry.sigma).trim()}`
      : ` ± ${String(entry.sigma).trim()}`
    : '';
  const ref = entry.ref ? ` (${entry.ref})` : '';
  return `${value}${sigma}${units}${ref}`;
}

function massFromGm(gmKm3S2) {
  const kg = (gmKm3S2 * 1e9) / G_CODATA;
  const exp = Math.floor(Math.log10(kg));
  const mantissa = (kg / 10 ** exp).toPrecision(4);
  const superscript = String(exp)
    .split('')
    .map((c) => (c === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]));
  return `${mantissa} × 10${superscript.join('')} kg (derived: GM ÷ CODATA-2018 G)`;
}

function taxonomy(entry) {
  if (!entry) return null;
  return String(entry.value).trim();
}

const asteroids = readdirSync(join(ROOT, 'src/data/asteroids'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'src/data/asteroids', f), 'utf8')))
  .filter((b) => b.note === PERTURBER_NOTE);

if (asteroids.length !== 12) {
  throw new Error(`expected 12 perturber bodies, found ${asteroids.length}`);
}

const rows = [];
for (const body of asteroids) {
  const des = body.source?.match(/DES=2000(\d+);/)?.[1];
  if (!des) throw new Error(`${body.id}: no NAIF DES=2000NNN token in "source"`);

  const response = await fetch(`${API}?sstr=${Number(des)}&phys-par=1&discovery=1&full-prec=1`);
  if (!response.ok) throw new Error(`${body.id}: HTTP ${response.status}`);
  const ssb = await response.json();

  const par = Object.fromEntries((ssb.phys_par ?? []).map((p) => [p.name, p]));

  // Cross-check the two independent sources: Horizons RAD vs SBDB effective diameter.
  if (par.diameter) {
    const d = Number(par.diameter.value);
    const sigma = Number(par.diameter.sigma ?? 0);
    const gap = Math.abs(2 * body.radiusKm - d);
    if (gap > Math.max(d * 0.02, sigma)) {
      console.warn(
        `! ${body.id}: Horizons RAD ${body.radiusKm} km vs SBDB diameter/2 ${(d / 2).toFixed(3)} km (gap ${gap.toFixed(2)} km)`,
      );
    }
  }

  const class_ = ssb.object?.orbit_class?.name ?? 'asteroid';
  const tholen = taxonomy(par.spec_T);
  const smass = taxonomy(par.spec_B);

  const facts = {
    Classification:
      tholen && smass && tholen !== smass
        ? `${class_} (${tholen}-type Tholen / ${smass}-type SMASS-II)`
        : `${class_} (${tholen ?? smass ?? 'unclassified'}-type)`,
    'System GM': `${body.gmKm3S2} km³/s² (NAIF gm_de440.tpc)`,
    Mass: massFromGm(body.gmKm3S2),
    'Mean Radius': `${body.radiusKm} km (JPL Horizons RAD for DES=${body.source.match(/DES=(\d+);/)[1]})`,
  };
  if (par.diameter) facts['Effective Diameter'] = field(par.diameter);
  if (par.extent) facts['Dimensions'] = field(par.extent);
  if (par.density) facts['Bulk Density'] = field(par.density);
  if (par.rot_per) facts['Rotation Period'] = field(par.rot_per);
  if (par.albedo) facts['Geometric Albedo'] = field(par.albedo);
  if (par.H) facts['Absolute Magnitude H'] = field(par.H);
  facts['Discovery'] = ssb.discovery?.discovery ?? 'not reported by SBDB';
  facts['Spin Pole'] =
    'Not modelled — SBDB/NAIF publish no ratified pole for this body, so no orientation is asserted.';

  const out = {
    source:
      `JPL Small-Body Database SBDB API, ${API}?sstr=${Number(des)}&phys-par=1&discovery=1` +
      `&full-prec=1 (values and per-field references copied verbatim, checked ${CHECKED})`,
    note:
      'Gravitating perturber: rendered without a spin state because no IAU/NAIF pole ' +
      'orientation is published for this body (see docs/OPEN_QUESTIONS.md).',
    facts,
  };

  rows.push([body.id, des, out]);
}

for (const [id, des, out] of rows) {
  const path = join(ROOT, 'src/data/physical', `${id}.json`);
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (existsSync(path) && !FORCE) {
    console.log(`keep   ${id} (des ${des}) — file exists, --force to rewrite`);
    continue;
  }
  if (WRITE) {
    writeFileSync(path, text);
    console.log(`write  ${id} (des ${des})`);
  } else {
    console.log(`dry    ${id} (des ${des})`);
    console.log(text);
  }
}

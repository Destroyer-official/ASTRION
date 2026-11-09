// NASA SPICE truth tests (offline-safe: they read the snapshotted kernels in
// src/data/spice/, refreshed with `npm run fetch:spice`).
//
// What this proves:
//  1. Our GM / radius constants ARE NASA's numbers (NAIF gm_de440.tpc, pck00010.tpc).
//  2. The Sun is really moving in our truth data (SSB frame) — unlike NASA Eyes,
//     which pins the Sun at the origin for rendering. Our "exact real view"
//     keeps the physical SSB wobble.
//  3. The whole system actually sits at the solar-system barycenter (residual
//     only from bodies we do not simulate: Pluto, asteroids).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auDayToKms, AU_KM } from '@/data/constants';
import type { BodyJson } from '@/data/schema';
import { loadSystem } from '@/sim/registry';

const spiceUrl = (f: string) => fileURLToPath(new URL(`../src/data/spice/${f}`, import.meta.url));
const bodiesUrl = (f: string) => fileURLToPath(new URL(`../src/data/bodies/${f}`, import.meta.url));

const num = (s: string) => Number(s.replace(/D/gi, 'E'));
const gmTpc = readFileSync(spiceUrl('gm_de440.tpc'), 'utf8');
const pckTpc = readFileSync(spiceUrl('pck00010.tpc'), 'utf8');
const provenance = JSON.parse(readFileSync(spiceUrl('provenance.json'), 'utf8')) as {
  kernels: { file: string; url: string; bytes: number; sha256: string }[];
};

const gmOf = (naif: number): number => {
  const m = gmTpc.match(new RegExp(`BODY${naif}_GM\\b\\s*=\\s*\\(\\s*([-+0-9.EeDd]+)\\s*\\)`));
  if (!m) throw new Error(`BODY${naif}_GM not found in snapshot`);
  return num(m[1]!);
};
const radiiOf = (naif: number): number => {
  const m = pckTpc.match(new RegExp(`BODY${naif}_RADII\\b\\s*=\\s*\\(\\s*([-+0-9.EeDd\\s]+)\\)`));
  if (!m) throw new Error(`BODY${naif}_RADII not found in snapshot`);
  return num(m[1]!.trim().split(/\s+/)[0]!);
};
const loadBody = (id: string): BodyJson =>
  JSON.parse(readFileSync(bodiesUrl(`${id}.json`), 'utf8')) as BodyJson;

// NAIF ids: GM table uses planet SYSTEM barycenters, radii table uses planet centers.
const TRUTH: Record<string, { gmNaif: number; radNaif: number }> = {
  sun: { gmNaif: 10, radNaif: 10 },
  mercury: { gmNaif: 1, radNaif: 199 },
  venus: { gmNaif: 2, radNaif: 299 },
  earth: { gmNaif: 3, radNaif: 399 },
  mars: { gmNaif: 4, radNaif: 499 },
  jupiter: { gmNaif: 5, radNaif: 599 },
  saturn: { gmNaif: 6, radNaif: 699 },
  uranus: { gmNaif: 7, radNaif: 799 },
  neptune: { gmNaif: 8, radNaif: 899 },
};

describe('NASA SPICE truth (NAIF PCK snapshots)', () => {
  it('provenance manifest matches the snapshotted kernel files', () => {
    expect(provenance.kernels.length).toBeGreaterThanOrEqual(2);
    for (const k of provenance.kernels) {
      const text = readFileSync(spiceUrl(k.file), 'utf8');
      expect(text.length).toBe(k.bytes);
      expect(createHash('sha256').update(text).digest('hex')).toBe(k.sha256);
      expect(k.url).toContain('naif.jpl.nasa.gov');
    }
  });

  it.each(Object.entries(TRUTH))('%s GM equals NAIF BODY%d_GM', (id, { gmNaif }) => {
    const b = loadBody(id);
    const expected = gmOf(gmNaif);
    expect(Math.abs(b.gmKm3S2 - expected) / Math.abs(expected)).toBeLessThan(1e-12);
  });

  it.each(Object.entries(TRUTH))('%s radius equals NAIF equatorial radius', (id, { radNaif }) => {
    const b = loadBody(id);
    const expected = radiiOf(radNaif);
    expect(Math.abs(b.radiusKm - expected) / Math.abs(expected)).toBeLessThan(5e-4);
  });

  it('the Sun is really moving (SSB frame, not pinned like NASA Eyes)', () => {
    const sun = loadBody('sun');
    if (sun.initial.type !== 'vectors') throw new Error('sun has no vectors');
    const r = Math.hypot(...sun.initial.position);
    const v = Math.hypot(...sun.initial.velocity);
    const rKm = Math.round(r * AU_KM);
    const vMs = Number((auDayToKms(v) * 1000).toFixed(1));
    console.log(
      `Sun SSB state: r=${r.toExponential(3)} AU (${rKm} km), ` +
        `v=${v.toExponential(3)} AU/day (${vMs} m/s)`,
    );
    expect(r, 'Sun offset from barycenter').toBeGreaterThan(1e-4);
    expect(v, 'Sun speed around barycenter').toBeGreaterThan(1e-6);
    // Explicit verification of solar wobble magnitude and velocity (AUDIT-21)
    expect(rKm, 'Documented solar wobble magnitude at epoch JD 2461319.5').toBe(788469);
    expect(vMs, 'Documented solar wobble velocity at epoch JD 2461319.5').toBe(11.4);
  });

  it('system state sits at the solar-system barycenter', () => {
    const model = loadSystem();
    const { gm, pos, vel } = model.state;
    let m = 0;
    const rp = [0, 0, 0],
      vp = [0, 0, 0];
    for (let i = 0; i < model.ids.length; i++) {
      m += gm[i]!;
      for (let k = 0; k < 3; k++) {
        rp[k]! += gm[i]! * pos[3 * i + k]!;
        vp[k]! += gm[i]! * vel[3 * i + k]!;
      }
    }
    const rRes = Math.hypot(...rp) / m; // AU
    const vRes = Math.hypot(...vp) / m; // AU/day
    console.log(`SSB residual: r=${rRes.toExponential(2)} AU, v=${vRes.toExponential(2)} AU/day`);
    // Only unmodeled mass (Pluto, asteroids) may remain: ~3e-7 AU / tiny velocity.
    expect(rRes).toBeLessThan(1e-5);
    expect(vRes).toBeLessThan(1e-6);
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseHorizonsVectorText,
  buildHorizonsUrl,
  HORIZONS_COMMANDS,
  horizonsClient,
} from '@/sim/horizonsClient';
import { AU_KM } from '@/data/constants';

describe('NASA JPL Horizons & Eyes on the Solar System Client', () => {
  const sampleSunText = `
API VERSION: 1.2
API SOURCE: NASA/JPL Horizons API

Target body name: Sun (10)                        {source: DE441}
Center body name: Solar System Barycenter (0)     {source: DE441}
Center-site name: BODY CENTER
Reference frame : Ecliptic of J2000.0
$$SOE
2461320.500000000 = A.D. 2026-Oct-07 00:00:00.0000 TDB 
 X =-1.808787066740511E+05 Y =-7.667176136297258E+05 Z = 1.404512410712836E+04
 VX= 1.045809058851541E-02 VY= 4.419082726029238E-03 VZ=-2.235962879177530E-04
 LT= 2.628117343125980E+00 RG= 7.878897582081668E+05 RR=-6.705220933056102E-03
$$EOE
`;

  const sampleEarthText = `
API VERSION: 1.2
API SOURCE: NASA/JPL Horizons API

Target body name: Earth (399)                     {source: DE441}
Center body name: Solar System Barycenter (0)     {source: DE441}
Reference frame : Ecliptic of J2000.0
$$SOE
2461320.500000000 = A.D. 2026-Oct-07 00:00:00.0000 TDB 
 X = 1.453082053653624E+08 Y = 3.382650519373970E+07 Z = 1.105627394110896E+04
 VX=-7.357266451977906E+00 VY= 2.888367814599781E+01 VZ=-8.011132223391115E-04
 LT= 4.976560230458504E+02 RG= 1.491935223874201E+08 RR=-6.168987975907192E-01
$$EOE
`;

  it('correctly maps NAIF commands for all major planets and Sun', () => {
    expect(HORIZONS_COMMANDS['sun']).toBe('10');
    expect(HORIZONS_COMMANDS['earth']).toBe('399');
    expect(HORIZONS_COMMANDS['jupiter']).toBe('599');
    expect(HORIZONS_COMMANDS['saturn']).toBe('699');
    expect(HORIZONS_COMMANDS['moon']).toBe('301');
  });

  it('parses Sun DE441 vector and measures wobble around empty barycenter', () => {
    const res = parseHorizonsVectorText(sampleSunText, 'sun');
    expect(res).not.toBeNull();
    expect(res!.source).toBe('DE441');
    expect(res!.epochJd).toBe(2461320.5);

    // Distance in km should match range ~787,889 km
    expect(res!.positionKm[0]).toBeCloseTo(-180878.7, 0);
    expect(res!.positionKm[1]).toBeCloseTo(-766717.6, 0);
    const distKm = Math.hypot(...res!.positionKm);
    expect(distKm).toBeCloseTo(787889.7, 0);

    // Converted to AU
    const distAu = distKm / AU_KM;
    expect(res!.positionAu[0]).toBeCloseTo(-180878.7 / AU_KM, 6);
    expect(Math.hypot(...res!.positionAu)).toBeCloseTo(distAu, 6);

    // Sun velocity in km/s and AU/day
    expect(res!.velocityKms[0]).toBeCloseTo(0.010458, 5);
  });

  it('parses Earth DE441 state vector and matches 1 AU distance to Sun/SSB', () => {
    const res = parseHorizonsVectorText(sampleEarthText, 'earth');
    expect(res).not.toBeNull();
    expect(res!.epochJd).toBe(2461320.5);

    // Earth distance from SSB is ~1.492e8 km ≈ 0.997 AU
    const distAu = Math.hypot(...res!.positionAu);
    expect(distAu).toBeGreaterThan(0.98);
    expect(distAu).toBeLessThan(1.02);

    // Speed in km/s should be ~29.8 km/s
    const speedKms = Math.hypot(...res!.velocityKms);
    expect(speedKms).toBeGreaterThan(29.0);
    expect(speedKms).toBeLessThan(30.5);
  });

  it('builds valid NASA Horizons API endpoint URL', () => {
    const d = new Date('2026-10-07T00:00:00Z');
    const url = buildHorizonsUrl('399', d);
    expect(url).toContain('https://ssd.jpl.nasa.gov/api/horizons.api');
    expect(url).toContain('COMMAND=%27399%27');
    expect(url).toContain('CENTER=%27500%400%27');
    expect(url).toContain('REF_PLANE=%27ECLIPTIC%27');
  });

  it('generates direct NASA Eyes on the Solar System URL matching simulated date', () => {
    const d = new Date('2026-10-07T12:00:00Z');
    const eyesUrl = horizonsClient.getEyesUrl(d, 'earth');
    expect(eyesUrl).toContain('https://eyes.nasa.gov/apps/solar-system/#/earth');
    expect(eyesUrl).toContain('time=2026-10-07T12%3A00%3A00');
  });

  it('implements circuit breaker to fail-fast during offline cooldown', async () => {
    expect(horizonsClient.isOffline()).toBe(false);
    horizonsClient.markOffline(5000);
    expect(horizonsClient.isOffline()).toBe(true);
    // When offline, immediately returns null/empty without network fetch
    const vec = await horizonsClient.fetchVector('earth', new Date());
    expect(vec).toBeNull();
    const sys = await horizonsClient.fetchSystem(['earth', 'mars'], new Date());
    expect(Object.keys(sys).length).toBe(0);
    // Reset offline cooldown
    horizonsClient.markOffline(0);
    expect(horizonsClient.isOffline()).toBe(false);
  });
});

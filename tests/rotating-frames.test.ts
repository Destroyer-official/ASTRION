import { describe, it, expect } from 'vitest';
import { transformState } from '@/frames/transform';
import type { ReferenceFrame } from '@/frames/types';
import { createState } from '@/physics/system';

describe('Rotating Reference Frame Kinematics (Coriolis & Relative Velocity)', () => {
  it('correctly transforms geostationary orbit to zero relative velocity in Earth-fixed frame', () => {
    // Earth rotation rate: ~1 rev/day = 2*pi rad/day
    const omegaZ = 2 * Math.PI;
    const rGeoAu = 42164 / 149597870.7; // ~0.0002818 AU
    // Inertial circular speed: v = omega * r
    const vInertial = omegaZ * rGeoAu;

    const s = createState([
      { id: 'earth', name: 'Earth', gm: 1.0, radiusKm: 6378, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'geo', name: 'GeoSat', gm: 0, radiusKm: 1, position: [rGeoAu, 0, 0], velocity: [0, vInertial, 0] },
    ]);

    const earthFixedFrame: ReferenceFrame = {
      id: 'earth-fixed',
      label: 'Earth-Fixed (ECEF)',
      axes: null, // aligned at t=0
      angularVelocity: (_t) => [0, 0, omegaZ],
      origin: (_t, _gm, pos, _base, out) => {
        out[0] = pos[0]!;
        out[1] = pos[1]!;
        out[2] = pos[2]!;
      },
      originVelocity: (_t, _gm, vel, _base, out) => {
        out[0] = vel[0]!;
        out[1] = vel[1]!;
        out[2] = vel[2]!;
      },
    };

    const outPos = new Float64Array(6);
    const outVel = new Float64Array(6);
    transformState(earthFixedFrame, s, outPos, outVel);

    // Position of GeoSat relative to Earth center
    expect(outPos[3]).toBeCloseTo(rGeoAu, 12);
    expect(outPos[4]).toBeCloseTo(0, 12);
    expect(outPos[5]).toBeCloseTo(0, 12);

    // Relative velocity of GeoSat in Earth-Fixed rotating frame MUST BE ZERO!
    expect(outVel[3]).toBeCloseTo(0, 12);
    expect(outVel[4]).toBeCloseTo(0, 12);
    expect(outVel[5]).toBeCloseTo(0, 12);
  });
});

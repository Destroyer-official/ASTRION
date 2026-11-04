type Triple = readonly [number, number, number];

export type InitialState =
  | { type: 'root' }
  | { type: 'elements'; parent: string; aAu: number; e: number; incDeg: number }
  /** Barycentric (SSB) or parent-relative, J2000 ecliptic axes, AU and AU/day, at epochJd (TDB). */
  | { type: 'vectors'; epochJd: number; position: Triple; velocity: Triple; about?: 'parent' | 'ssb' };

export interface NutationJson {
  /** Parent planet's phase-angle system id (3=Earth … 8=Neptune): selects SYSTEM_PHASES. */
  systemId: number;
  /**
   * Per-angle amplitudes in degrees, paired element-wise with the system's
   * phase polynomials (first min(len) pairs). RA and W terms multiply
   * sin(phase); Dec terms multiply cos(phase) — NAIF PCK convention, see the
   * worked Jupiter/Io example in src/data/spice/pck00011.tpc.
   */
  raAmpDeg: number[];
  decAmpDeg: number[];
  wAmpDeg: number[];
}

export interface RotationJson {
  poleRaDeg: number;
  poleDecDeg: number;
  poleRaRateDegPerCy?: number;
  poleDecRateDegPerCy?: number;
  w0Deg: number; // prime meridian angle at J2000
  wRateDegPerDay: number; // negative = retrograde
  wAccelDegPerDay2?: number; // prime-meridian quadratic term (x days^2); e.g. Phobos
  nutation?: NutationJson; // periodic IAU nutation-precession terms (PCK)
}

export interface PhysicalJson {
  rotation?: RotationJson;
  flattening?: number; // (a - c) / a
  j2?: number; // used by Phase 5 moons
  texture?: string; // /textures/earth.jpg
  ring?: { innerKm: number; outerKm: number; texture: string };
  facts?: Record<string, string>;
}

export interface BodyJson {
  id: string;
  name: string;
  parent?: string;
  gmKm3S2: number; // NASA units, converted once in code
  radiusKm: number; // equatorial
  color: string;
  note?: string;
  source?: string;
  gmIsSystem?: boolean;
  initial: InitialState;
}

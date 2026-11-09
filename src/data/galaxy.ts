/**
 * Obliquity that realizes the simulation's J2000 mean-ecliptic frame.
 *
 * Every state vector in `src/data/bodies` was produced by JPL Horizons with
 * `REF_PLANE='ECLIPTIC'`, and Horizons documents that frame as "the IAU76/80
 * obliquity of 84381.448 arcsec at J2000.0 relative to the ICRF reference
 * frame" (https://ssd-api.jpl.nasa.gov/doc/horizons.html, fetched 2026-11-05).
 * The modern IAU 2006 value is 84381.406 arcsec; using it here left the whole
 * dataset rotated 0.042 arcsec away from the frame the code converted into,
 * which is 526 km at Uranus. Measured in docs/VALIDATION_LOG.md.
 */
export const OBLIQUITY_J2000_RAD = ((84381.448 / 3600) * Math.PI) / 180;

/**
 * Galactic axes expressed in ICRS (Hipparcos catalogue, vol. 1, eq. 1.5.11).
 * Row 0 = toward Galactic Center (l=0,b=0), row 1 = direction of galactic rotation (l=90°),
 * row 2 = North Galactic Pole.
 */
export const GALACTIC_AXES_IN_ICRS = [
  [-0.0548755604162154, -0.873437090234885, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.746982244497219],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
] as const;

/** Sun's peculiar motion relative to the local standard of rest (U toward GC, V rotation, W north), km/s. Schönrich+2010. */
export const SOLAR_PECULIAR_KMS = [11.1, 12.24, 7.25] as const;

/** Circular speed of the LSR, km/s. IAU 1985 value. */
export const LSR_SPEED_KMS = 220;

export interface GalaxyModel {
  readonly id: string;
  readonly label: string;
  readonly lsrKms: number;
  readonly r0Kpc: number;
  readonly source: string;
  readonly paperUrl?: string;
  readonly implementation?: 'lsrR0Only' | 'modelPotential';
  readonly details?: {
    readonly sgrAMassMsun?: number;
    readonly bulge1MassMsun?: number; // Core bulge (Sofue 2016)
    readonly bulge1ScalePc?: number;
    readonly bulge2MassMsun?: number; // Main bulge (Sofue 2016)
    readonly bulge2ScalePc?: number;
    readonly diskMassMsun?: number;
    readonly diskScaleKpc?: number;
    readonly darkHaloProfile?: string;
    readonly darkHaloScaleKpc?: number;
    readonly darkHaloMass200Kpc?: number;
    readonly localDMDensityGeV?: number;
    readonly oortA?: number; // km/s/kpc
    readonly oortB?: number; // km/s/kpc
  };
}

export const GALAXY_MODELS: readonly GalaxyModel[] = [
  {
    id: 'iau1985',
    label: 'IAU 1985 (220 km/s)',
    lsrKms: 220,
    r0Kpc: 8.2,
    source: 'IAU 1985 standard recommendation',
    implementation: 'modelPotential',
    details: {
      oortA: 14.4,
      oortB: -12.0,
      sgrAMassMsun: 4.0e6,
      diskMassMsun: 7.0e10,
      diskScaleKpc: 3.0,
      darkHaloProfile: 'Logarithmic',
      darkHaloScaleKpc: 12.0,
    },
  },
  {
    id: 'sofue2016',
    label: 'Sofue 2016 / VERA (238 km/s)',
    lsrKms: 238,
    r0Kpc: 8.0,
    source: 'Yoshiaki Sofue 2016 (Caltech/IPAC NED Level 5 Review, VERA trigonometric astrometry)',
    implementation: 'modelPotential',
    paperUrl: 'https://ned.ipac.caltech.edu/level5/Sept16/Sofue/Sofue2.html',
    details: {
      oortA: 14.9,
      oortB: -14.9,
      sgrAMassMsun: 3.6e6,
      bulge1MassMsun: 4.0e7,
      bulge1ScalePc: 3.5,
      bulge2MassMsun: 9.2e9,
      bulge2ScalePc: 120,
      diskMassMsun: 9.0e10,
      diskScaleKpc: 4.9,
      darkHaloProfile: 'NFW (Navarro-Frenk-White)',
      darkHaloScaleKpc: 10.0,
      darkHaloMass200Kpc: 7.0e11,
      localDMDensityGeV: 0.40,
    },
  },
  {
    id: 'reid2019',
    label: 'Reid et al. 2019 (~236 km/s)',
    lsrKms: 236,
    r0Kpc: 8.15,
    source: 'Reid et al. 2019 (ApJ 885:131, trigonometric maser parallax)',
    implementation: 'modelPotential',
    details: {
      sgrAMassMsun: 4.0e6,
      diskMassMsun: 8.0e10,
      diskScaleKpc: 4.5,
      darkHaloProfile: 'NFW',
      darkHaloScaleKpc: 11.0,
    },
  },
  {
    id: 'gravity2021',
    label: 'GRAVITY 2021 (~240 km/s)',
    lsrKms: 240,
    r0Kpc: 8.275,
    source: 'GRAVITY Collaboration 2021 (A&A 647:A59, Sgr A* orbit & LSR fit)',
    implementation: 'modelPotential',
    details: {
      sgrAMassMsun: 4.297e6,
      diskMassMsun: 8.5e10,
      diskScaleKpc: 4.0,
      darkHaloProfile: 'NFW',
      darkHaloScaleKpc: 10.5,
    },
  },
] as const;

export const DEFAULT_GALAXY_MODEL: GalaxyModel = GALAXY_MODELS[0]!;

/**
 * Solar motion relative to the Cosmic Microwave Background (CMB) rest frame.
 * Values from Planck 2018 / 2020 results (Aghanim et al. 2020, A&A 641:A1).
 */
export const CMB_DIPOLE_SPEED_KMS = 369.82; // ± 0.11 km/s
export const CMB_DIPOLE_L_DEG = 264.021; // ± 0.011 deg galactic longitude
export const CMB_DIPOLE_B_DEG = 48.253; // ± 0.005 deg galactic latitude
export const CMB_DIPOLE_SOURCE = 'Planck Collaboration 2020 (A&A 641:A1, CMB dipole)';

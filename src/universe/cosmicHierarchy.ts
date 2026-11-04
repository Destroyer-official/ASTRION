/**
 * NASA-Standard Cosmic Hierarchy & Cosmological Tree Architecture
 *
 * Implements a unified, extensible celestial hierarchy spanning:
 * Superclusters -> Local Group -> Galaxies -> Substructures -> Star Systems ->
 * Planetary Systems -> Satellite Systems -> Spacecraft & Belts
 *
 * References:
 * - IAU Commission 28 (Galaxies) & Commission 54 (Stellar Structure)
 * - NASA Exoplanet Archive & JPL Solar System Dynamics (SSD)
 * - SIMBAD Astronomical Database & NED (NASA/IPAC Extragalactic Database)
 */

export type CosmicTier =
  | 'supercluster'       // Laniakea, Virgo Supercluster, Great Attractor
  | 'local_group'        // Local Group of Galaxies
  | 'galaxy'             // Milky Way, Andromeda, Triangulum, Magellanic Clouds
  | 'galaxy_structure'   // Sagittarius A*, Central Bulge, Spiral Arms, Globular Clusters
  | 'interstellar_cloud' // Nebulae, Star-forming regions, Open Clusters
  | 'star_system'        // Alpha Centauri, Sirius, TRAPPIST-1, Kepler-186
  | 'planetary_system'   // Solar System, Exoplanetary Systems
  | 'satellite_system'   // Moons (Earth Moon, Galilean Moons, Titan, Triton, Charon)
  | 'debris_belt'        // Asteroid Belt, Kuiper Belt, Oort Cloud
  | 'spacecraft';        // Flagship missions (Voyager, JWST, New Horizons, Parker)

export type CosmicCategory =
  | 'supercluster'
  | 'galaxy'
  | 'core_black_hole'
  | 'stellar_cluster'
  | 'nebula'
  | 'star'
  | 'exoplanet'
  | 'planet'
  | 'dwarf_planet'
  | 'moon'
  | 'asteroid'
  | 'comet'
  | 'belt'
  | 'spacecraft';

export interface CosmicNode {
  readonly id: string;
  readonly name: string;
  readonly alternateNames?: readonly string[];
  readonly tier: CosmicTier;
  readonly parentId?: string;
  readonly category: CosmicCategory;
  readonly description: string;
  readonly astrometry?: {
    /** Right Ascension (J2000) in decimal degrees */
    readonly raDeg?: number;
    /** Declination (J2000) in decimal degrees */
    readonly decDeg?: number;
    /** Parallax in milliarcseconds (mas) from Hipparcos / Gaia DR3 */
    readonly parallaxMas?: number;
    /** Distance in light-years */
    readonly distanceLy: number;
    /** Distance in kiloparsecs */
    readonly distanceKpc?: number;
    /** Distance in Megaparsecs */
    readonly distanceMpc?: number;
  };
  readonly facts: {
    readonly spectralType?: string;
    readonly massKg?: number;
    readonly massSolar?: number;
    readonly radiusKm: number;
    readonly luminositySolar?: number;
    readonly surfaceTempK?: number;
    readonly semiMajorAxisAu?: number;
    readonly orbitalPeriodDays?: number;
    readonly orbitalSpeedKms?: number;
    readonly eccentricity?: number;
    readonly inclinationDeg?: number;
    readonly distanceFromSunLy?: number;
    readonly distanceFromSgrAKpc?: number;
    readonly discoveredYear?: number;
    readonly missionAgency?: string;
  };
  readonly cameraPreset: {
    readonly focusId: string;
    readonly frameId: string;
    readonly distance: number;
    readonly direction: readonly [number, number, number];
  };
}

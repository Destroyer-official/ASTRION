import { kmToAu, kmsToAuDay } from '@/data/constants';

/**
 * JPL Horizons NAIF command mapping for Solar System bodies.
 * Uses 500@0 (Solar System Barycenter) as the origin, ecliptic reference plane of J2000,
 * and ICRF coordinate frame, directly matching NASA's Eyes on the Solar System.
 */
export const HORIZONS_COMMANDS: Record<string, string> = {
  sun: '10',
  mercury: '199',
  venus: '299',
  earth: '399',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
  moon: '301',
  phobos: '401',
  deimos: '402',
  io: '501',
  europa: '502',
  ganymede: '503',
  callisto: '504',
  mimas: '601',
  enceladus: '602',
  tethys: '603',
  dione: '604',
  rhea: '605',
  titan: '606',
  iapetus: '608',
  miranda: '705',
  ariel: '701',
  umbriel: '702',
  titania: '703',
  oberon: '704',
  triton: '801',
  nereid: '802',
  charon: '901',
};

export interface HorizonsVectorResult {
  bodyId: string;
  command: string;
  epochJd: number;
  dateStr: string;
  positionKm: [number, number, number];
  velocityKms: [number, number, number];
  positionAu: [number, number, number];
  velocityAuDay: [number, number, number];
  rangeKm?: number;
  source: string;
}

/**
 * Parses raw text returned by the NASA/JPL Horizons API into typed 3D state vectors.
 */
export function parseHorizonsVectorText(text: string, bodyId = ''): HorizonsVectorResult | null {
  const soeIdx = text.indexOf('$$SOE');
  const eoeIdx = text.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1 || eoeIdx <= soeIdx) return null;

  const block = text.slice(soeIdx + 5, eoeIdx).trim();
  const sourceMatch = text.match(/Target body name:.*\{source:\s*([^}]+)\}/i);
  const source = sourceMatch ? sourceMatch[1]!.trim() : 'DE441';

  // Match Julian Date line: 2461320.500000000 = A.D. 2026-Oct-07 00:00:00.0000 TDB
  const jdMatch = block.match(/^([0-9.]+)\s*=\s*([^,\n\r]+)/m);
  const epochJd = jdMatch ? parseFloat(jdMatch[1]!) : 0;
  const dateStr = jdMatch ? jdMatch[2]!.trim() : '';

  // Match X, Y, Z coordinates in kilometers
  const xyzMatch = block.match(/X\s*=\s*([-+0-9.E]+)\s+Y\s*=\s*([-+0-9.E]+)\s+Z\s*=\s*([-+0-9.E]+)/i);
  if (!xyzMatch) return null;
  const px = parseFloat(xyzMatch[1]!);
  const py = parseFloat(xyzMatch[2]!);
  const pz = parseFloat(xyzMatch[3]!);

  // Match VX, VY, VZ velocities in km/s
  const vMatch = block.match(/VX\s*=\s*([-+0-9.E]+)\s+VY\s*=\s*([-+0-9.E]+)\s+VZ\s*=\s*([-+0-9.E]+)/i);
  const vx = vMatch ? parseFloat(vMatch[1]!) : 0;
  const vy = vMatch ? parseFloat(vMatch[2]!) : 0;
  const vz = vMatch ? parseFloat(vMatch[3]!) : 0;

  const rgMatch = block.match(/RG\s*=\s*([-+0-9.E]+)/i);
  const rangeKm = rgMatch ? parseFloat(rgMatch[1]!) : Math.hypot(px, py, pz);

  return {
    bodyId,
    command: HORIZONS_COMMANDS[bodyId] ?? '',
    epochJd,
    dateStr,
    positionKm: [px, py, pz],
    velocityKms: [vx, vy, vz],
    positionAu: [kmToAu(px), kmToAu(py), kmToAu(pz)],
    velocityAuDay: [kmsToAuDay(vx), kmsToAuDay(vy), kmsToAuDay(vz)],
    rangeKm,
    source,
  };
}

/**
 * Builds the NASA JPL Horizons REST API URL for requesting geometric cartesian state vectors.
 */
export function buildHorizonsUrl(command: string, date: Date): string {
  const d0 = date.toISOString().slice(0, 10);
  const nextDay = new Date(date.getTime() + 86_400_000);
  const d1 = nextDay.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@0'", // Solar System Barycenter
    START_TIME: `'${d0}'`,
    STOP_TIME: `'${d1}'`,
    STEP_SIZE: "'1d'",
    REF_SYSTEM: "'ICRF'",
    REF_PLANE: "'ECLIPTIC'",
  });

  return `https://ssd.jpl.nasa.gov/api/horizons.api?${params.toString()}`;
}

export interface HorizonsClientOptions {
  timeoutMs?: number;
  maxParallel?: number;
  fetchFn?: typeof fetch;
  hostname?: string;
  now?: () => number;
}

export class HorizonsClient {
  private cache = new Map<string, HorizonsVectorResult>();
  private readonly timeoutMs: number;
  private readonly maxParallel: number;
  private readonly fetchFn: typeof fetch;
  private readonly getHostname: () => string;
  private readonly now: () => number;
  private offlineUntil = 0;

  constructor(optionsOrTimeout?: HorizonsClientOptions | number, maxParallel = 4) {
    if (typeof optionsOrTimeout === 'number') {
      this.timeoutMs = optionsOrTimeout;
      this.maxParallel = maxParallel;
      this.fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (() => Promise.reject(new Error('fetch unavailable')));
      this.getHostname = () => (typeof window !== 'undefined' && window.location ? window.location.hostname : '');
      this.now = () => Date.now();
    } else {
      const opts = optionsOrTimeout ?? {};
      this.timeoutMs = opts.timeoutMs ?? 15_000;
      this.maxParallel = opts.maxParallel ?? 4;
      this.fetchFn = opts.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (() => Promise.reject(new Error('fetch unavailable'))));
      this.getHostname = opts.hostname != null ? () => opts.hostname! : () => (typeof window !== 'undefined' && window.location ? window.location.hostname : '');
      this.now = opts.now ?? (() => Date.now());
    }
  }

  /** Clears the in-memory response cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Checks if the client is currently in offline/unreachable cooldown */
  isOffline(): boolean {
    return this.now() < this.offlineUntil;
  }

  /** Triggers a cooldown during which network calls are skipped in favor of local truth data */
  markOffline(durationMs = 30_000): void {
    this.offlineUntil = this.now() + durationMs;
  }

  /**
   * Fetches state vector directly from NASA JPL Horizons for a given body and date.
   */
  async fetchVector(bodyId: string, date: Date): Promise<HorizonsVectorResult | null> {
    if (this.isOffline()) return null;

    const cmd = HORIZONS_COMMANDS[bodyId];
    if (!cmd) return null;

    const dateKey = date.toISOString().slice(0, 10);
    const cacheKey = `${bodyId}:${dateKey}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const fullUrl = buildHorizonsUrl(cmd, date);
      const host = this.getHostname();
      const url =
        (host === 'localhost' || host === '127.0.0.1')
          ? fullUrl.replace('https://ssd.jpl.nasa.gov/api/horizons.api', '/api/horizons')
          : fullUrl;
      const res = await this.fetchFn(url, { headers: { Accept: 'text/plain' }, signal: ctrl.signal });
      if (!res.ok) {
        if (res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) {
          this.markOffline(30_000);
        }
        return null;
      }

      const text = await res.text();
      const parsed = parseHorizonsVectorText(text, bodyId);
      if (parsed) {
        this.cache.set(cacheKey, parsed);
        return parsed;
      }
    } catch {
      // Offline fallback: mark cooldown so we do not flood the console with repeated network errors
      this.markOffline(30_000);
    } finally {
      clearTimeout(timer);
    }

    return null;
  }

  /**
   * Fetches live state vectors for all major bodies in parallel (bounded so the
   * public JPL API is never hammered with dozens of simultaneous requests).
   */
  async fetchSystem(bodyIds: string[], date: Date): Promise<Record<string, HorizonsVectorResult>> {
    if (this.isOffline()) return {};
    const results: Record<string, HorizonsVectorResult> = {};
    for (let i = 0; i < bodyIds.length; i += this.maxParallel) {
      if (this.isOffline()) break;
      const chunk = bodyIds.slice(i, i + this.maxParallel);
      const settled = await Promise.allSettled(chunk.map((id) => this.fetchVector(id, date)));
      settled.forEach((s, k) => {
        if (s.status === 'fulfilled' && s.value) results[chunk[k]!] = s.value;
      });
      if (this.isOffline()) break;
    }
    return results;
  }

  /**
   * Constructs direct URL to NASA's Eyes on the Solar System for identical date and target.
   */
  getEyesUrl(date: Date, target = 'home'): string {
    const iso = date.toISOString().slice(0, 19);
    const t = target === 'sun' || target === 'barycenter' ? 'home' : target;
    return `https://eyes.nasa.gov/apps/solar-system/#/${encodeURIComponent(t)}?time=${encodeURIComponent(iso)}`;
  }
}

export function createHorizonsClient(options?: HorizonsClientOptions): HorizonsClient {
  return new HorizonsClient(options);
}

export const horizonsClient = new HorizonsClient();

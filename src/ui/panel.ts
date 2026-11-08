import { AU_KM, AU_PER_LIGHT_YEAR, DAY_S, GM_SUN_KM3_S2, SGRA_MASS_SOLAR, gmToInternal, auDayToKms, kmsToAuDay } from '@/data/constants';
import type { BodyRow } from '@/sim/readout';
import type { IntegratorName } from '@/sim/config';
import type { AppStore, ScaleMode } from '@/sim/store';
import type { ComputedFacts } from '@/sim/facts';
import type { GalaxyReadout } from '@/sim/galaxySim';
import type { GalaxyModel } from '@/data/galaxy';
import type { ValidationRow } from '@/sim/ephemeris';
import { ALL_BODIES } from '@/sim/registry';
import { getCosmicNode, searchCosmicNodes, getCosmicBreadcrumbs, cosmicCatalog } from '@/universe/cosmicRegistry';
import type { CosmicNode, CosmicTier } from '@/universe/cosmicHierarchy';
import { formatCosmicDistance } from '@/universe/cosmicCoordinates';
import { solveLambert } from '@/physics/lambert';
import { generatePorkchopGrid } from '@/physics/porkchop';
import { computeLinkBudget } from '@/physics/linkBudget';
import { computeClockDriftRate } from '@/physics/relativityClock';
import { tdbToUtc, utcToTt, getLeapSeconds } from '@/physics/time';
import { periapsisToBMag, hyperbolicTurnAngle } from '@/physics/bplane';
import { PLANET_SOI_AU } from '@/physics/flyby';
import { universeBackbone } from '@/universe/universePhysicsBackbone';
import type { ModuleHealth } from '@/observability';
import { createUniversalCoordinate, METERS_PER_AU } from '@/universe/cosmicScaleEngine';

const BODY_BY_ID = new Map(ALL_BODIES.map((body) => [body.id, body]));
const bodyParams = (id: string) => {
  const body = BODY_BY_ID.get(id)!;
  return { gm: body.gmKm3S2, radiusKm: body.radiusKm, name: body.name };
};

export interface Option {
  id: string;
  label: string;
  category?: string;
}

export interface PanelContext {
  sunRadiusKm: number;
  frames: Option[];
  focuses: Option[];
  presets: Option[];
  galaxyModels: readonly GalaxyModel[];
  validationTable: ValidationRow[];
  ephemerisCoverage?: {
    minDays: number;
    maxDays: number;
    fromDate: string;
    toDate: string;
  } | null;
  onReset(): void;
  onSeekDate(d: Date): string | null | Promise<string | null>;
  onNow(): string | null | Promise<string | null>;
  onReseedHorizons?(): Promise<{ live: boolean; source: string }> | void;
  onOpenEyes?(): void;
  onGalaxyReset?(): void;
  onGalaxyCamera?(cam: string): void;
  onGalaxyModelChange?(modelId: string): void;
  onPhysicsChange?(opts: {
    integrator?: IntegratorName;
    relativity?: boolean;
    eihRelativity?: boolean;
    quadrupole?: boolean;
    harmonics?: boolean;
    srp?: boolean;
  }): void;
  onZoomChange?(distanceAu: number): void;
  getBodyState?(id: string): { pos: [number, number, number]; vel: [number, number, number] } | null;
}

export interface PanelData {
  dateUtc: string;
  jd?: number;
  sunBaryAu: number;
  sunSpeedKms: number;
  energyDrift: number;
  angMomDrift: number;
  comDriftAu?: number;
  invariantOk?: boolean;
  invariantViolations?: readonly string[];
  moduleHealth?: readonly ModuleHealth[];
  rows: BodyRow[];
  busy: boolean;
  fps: number;
  quality: number;
  workerFault?: boolean;
  selectedFacts?: ComputedFacts | null;
  galaxyReadout?: GalaxyReadout | null;
  cameraDistanceAu?: number;
}

/** Compact one-line health summary; unknown modules do not mask a real fault. */
function formatModuleHealth(rows: readonly ModuleHealth[]): string {
  const problems = rows.filter((row) => row.status !== 'ok' && row.status !== 'unknown');
  if (problems.length === 0) {
    return rows.some((row) => row.status === 'unknown') ? 'PARTIAL' : 'ALL OK';
  }
  return problems.map((row) => `${row.module} ${row.status.toUpperCase()}`).join(', ');
}

/**
 * Format simulation speed into human-readable NASA units.
 * Supports down to authentic 1:1 real-time (1 second / 1 second = 1/86400 d/s),
 * seconds/sec, minutes/sec, hours/sec, days/sec, and years/sec.
 */
export function formatSimSpeed(speedDaysPerSec: number): string {
  const secPerSec = speedDaysPerSec * 86400;

  if (secPerSec < 59.95) {
    if (Math.abs(secPerSec - 1.0) < 0.05) {
      return '1.0× Real-Time (1 s/s)';
    }
    return `${secPerSec.toFixed(1)} s/s (${secPerSec.toFixed(1)}×)`;
  }

  const minPerSec = secPerSec / 60;
  if (minPerSec < 59.95) {
    return `${minPerSec.toFixed(1)} min/s (${Math.round(secPerSec).toLocaleString()}×)`;
  }

  const hrPerSec = minPerSec / 60;
  if (hrPerSec < 23.95) {
    return `${hrPerSec.toFixed(1)} hr/s (${Math.round(secPerSec).toLocaleString()}×)`;
  }

  if (speedDaysPerSec < 365.25) {
    return `${speedDaysPerSec.toFixed(1)} d/s`;
  }

  return `${(speedDaysPerSec / 365.25).toFixed(2)} yr/s`;
}

export function createPanel(root: HTMLElement, store: AppStore, ctx: PanelContext) {
  root.innerHTML = `
    <div class="panel-inner">
      <div class="panel-header" style="flex-direction: column; align-items: flex-start; gap: 2px;">
        <h1 style="font-size: 14px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
          <span>🌌</span> ASTRION Astrodynamics
        </h1>
        <div id="panelSubtitle" style="font-size: 10px; color: #7dd3fc; opacity: 0.9;">
          High-Precision Ephemerides, Relativistic N-Body Dynamics & Galactic Kinematics
        </div>
      </div>

      <!-- Universal Cosmic Search -->
      <div class="cosmic-search-container" style="margin-top: 6px; position: relative;">
        <div style="display: flex; gap: 4px; align-items: center;">
          <input id="cosmicSearchInput" type="text" aria-label="Search the celestial catalog" placeholder="🔍 Search celestial catalog: Sgr A*, Jupiter, Proxima b, Voyager 1, Ceres..." style="flex: 1; padding: 4px 8px; font-size: 11px; background: rgba(15,23,42,0.8); border: 1px solid rgba(56,189,248,0.3); border-radius: 4px; color: #fff; outline: none;">
          <button id="cosmicSearchClear" style="padding: 2px 6px; font-size: 10px; display: none;">✕</button>
        </div>
        <div id="cosmicSearchResults" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: rgba(15,23,42,0.98); border: 1px solid rgba(56,189,248,0.4); border-radius: 4px; z-index: 1000; max-height: 240px; overflow-y: auto; margin-top: 3px; box-shadow: 0 8px 24px rgba(0,0,0,0.8);"></div>
      </div>

      <!-- Universal Cosmic Breadcrumbs -->
      <div id="cosmicBreadcrumbs" style="margin-top: 5px; font-size: 10px; color: #94a3b8; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 3px 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;">
        <span style="color: #38bdf8; font-weight: 600;">🌌 Universe</span> &rsaquo;
        <span>Virgo</span> &rsaquo;
        <span>Milky Way</span> &rsaquo;
        <span style="color: #fde047; font-weight: 600;">Solar System</span>
      </div>

      <!-- Dynamics Mode Indicator & Reseed -->
      <div class="dynamics-bar" style="margin-top: 4px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 11px; opacity: 0.7;">Dynamics:</span>
          <span id="dynamicsStatus" role="status" aria-live="polite" class="status-badge badge-sim">Yoshida-4 N-Body</span>
        </div>
        <div style="display: flex; gap: 4px;">
          <button id="toggleDynamics" style="font-size: 10px; padding: 2px 6px;">Switch Mode</button>
          <button id="reseedBtn" style="font-size: 10px; padding: 2px 6px;" title="Reseed state vectors from JPL Horizons DE440/DE441 ephemeris">🛰️ Horizons Sync</button>
        </div>
      </div>

      <!-- Simulation Playback & Time Controls -->
      <div style="display: grid; gap: 8px; margin-top: 6px;">
        <div class="row">
          <button id="play" style="flex: 1; font-weight: 600;">Pause</button>
          <button id="rev" style="flex: 1;">Forward</button>
          <button id="reset">Reset</button>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <label style="margin: 0; font-weight: 500; font-size: 11px;">Simulation Speed</label>
            <button id="realtimeBtn" type="button" style="font-size: 10px; padding: 2px 7px; border-radius: 4px; background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.4); color: #38bdf8; cursor: pointer; font-weight: 600;" title="Snap simulation speed to true 1:1 real-time (1 second / 1 second)">⏱️ 1× Real-Time</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input id="speed" type="range" aria-label="Simulation speed, logarithmic days per second" min="-4.94" max="4.5" step="0.02" value="2" style="flex: 1;">
            <span id="speedLabel" style="color: #38bdf8; font-weight: 600; font-size: 11px; white-space: nowrap; min-width: 105px; text-align: right;">100.0 d/s</span>
          </div>
        </div>

        <div class="row">
          <input id="date" type="date" aria-label="Simulation date" style="flex: 1;">
          <button id="go">Go</button>
          <button id="now" title="Sync live to current real-world UTC time">Now (Live)</button>
        </div>
        <div id="ephCoverageStatus" role="status" aria-live="polite" style="display:none; margin-top:2px; font-size:10px; line-height:1.35; color:#bae6fd;"></div>

        <!-- Professional NASA Navigation Dropdown & Camera Zoom Slider -->
        <div style="display: grid; gap: 8px; margin-top: 4px;">
          <label>Mission Target & Scale
            <select id="presetSelect" aria-label="Camera and scale preset" style="width: 100%; font-size: 11px; padding: 4px 6px; background: rgba(15,23,42,0.9); border: 1px solid rgba(56,189,248,0.4); border-radius: 4px; color: #fff; margin-top: 3px;">
            </select>
          </label>

          <label>Camera Zoom
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 3px;">
              <button id="zoomOutBtn" type="button" style="padding: 2px 8px; font-size: 13px; font-weight: 700; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; cursor: pointer;" title="Zoom Out">−</button>
              <input id="cameraZoom" type="range" aria-label="Camera zoom, logarithmic distance" min="-6.0" max="5.0" step="0.02" value="1.74" style="flex: 1;">
              <button id="zoomInBtn" type="button" style="padding: 2px 8px; font-size: 13px; font-weight: 700; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; cursor: pointer;" title="Zoom In">+</button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
              <span id="zoomMinLabel" style="font-size: 10px; opacity: 0.6;">Surface (m/km)</span>
              <span id="zoomLabel" style="color: #38bdf8; font-weight: 600; font-size: 11px;">55.0 AU</span>
              <span id="zoomMaxLabel" style="font-size: 10px; opacity: 0.6;">Deep Space</span>
            </div>
          </label>
        </div>

        <!-- Selected Body Facts Card (Right Below Presets) -->
        <div id="factsBox" class="facts-box" style="display:none; margin-top: 6px;"></div>

        <!-- Internal camera focus select (kept in DOM for event/store bindings) -->
        <select id="focus" aria-label="Focus body" style="display:none;"></select>

        <label>Reference Frame
          <select id="frame" aria-label="Reference frame"></select>
        </label>

        <label>Scale mode
          <select id="scaleMode" aria-label="Scale mode">
            <option value="pixels" selected>Proportional Visible Scale (Dynamic Visual Clarity)</option>
            <option value="true">True 1:1 Physical Scale (IAU/IAG Cartographic Standards)</option>
            <option value="exaggerated">Exaggerated Scale</option>
          </select>
        </label>

        <label id="exagRow" style="display:none;">Exaggeration
          <input id="scaleExag" type="range" aria-label="Size exaggeration" min="1" max="300" step="1" value="20">
          <span id="exagVal">20x</span>
        </label>

        <label>Trail length
          <select id="trailDays" aria-label="Trail length in days">
            <option value="3">3 days (Fast Moons)</option>
            <option value="28">28 days (Lunar Month)</option>
            <option value="365.25">1 year (Earth)</option>
            <option value="4383">12 years (Jupiter)</option>
            <option value="10759">30 years (Saturn)</option>
            <option value="29220" selected>80 years (Outer System & Corkscrew)</option>
            <option value="36525">100 years</option>
          </select>
        </label>

        <div class="row">
          <label><input id="showOrbitPaths" type="checkbox" checked> 🪐 Orbit Paths</label>
          <label><input id="trails" type="checkbox" checked> 🌀 Trails</label>
          <label><input id="showLabels" type="checkbox" checked> 🏷️ Labels</label>
          <label><input id="showMilkyWay" type="checkbox" checked> 🌌 Milky Way</label>
          <label><input id="showOortCloud" type="checkbox"> ☄️ Oort Cloud</label>
        </div>

        <!-- NASA Flight Dynamics & Symplectic Truth Engine -->
        <details class="astro-details" style="margin-top: 6px; background: rgba(15,23,42,0.7); border: 1px solid rgba(56,189,248,0.25); border-radius: 6px; padding: 6px 8px;">
          <summary style="font-size: 11px; font-weight: 600; color: #7dd3fc; cursor: pointer; user-select: none;">
            🔬 NASA Astrodynamic Physics & Truth Integrator
          </summary>
          <div style="display: grid; gap: 6px; margin-top: 6px; font-size: 10px;">
            <label>Symplectic Integrator
              <select id="integrator" aria-label="Symplectic integrator" style="width: 100%; font-size: 10px; padding: 3px 5px; background: #0f172a; border: 1px solid rgba(56,189,248,0.4); border-radius: 4px; color: #fff; margin-top: 2px;">
                <option value="ias15">IAS15 Adaptive Gauss-Radau (15th-Order Reference)</option>
                <option value="yoshida8">Yoshida 8th-Order Symplectic (21-stage)</option>
                <option value="yoshida6" selected>Yoshida 6th-Order Symplectic (Default 7-Stage)</option>
                <option value="yoshida4">Yoshida 4th-Order Symplectic (Balanced)</option>
                <option value="leapfrog">2nd-Order Verlet / Leapfrog (Standard)</option>
              </select>
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 2px;">
              <label style="display: flex; align-items: center; gap: 4px;"><input id="eihRelativity" type="checkbox"> EIH 1PN Multi-Body</label>
              <label style="display: flex; align-items: center; gap: 4px;"><input id="relativity" type="checkbox" checked> Solar GR Precession</label>
              <label style="display: flex; align-items: center; gap: 4px;"><input id="quadrupole" type="checkbox" checked> Sun J2 Oblateness</label>
              <label style="display: flex; align-items: center; gap: 4px;"><input id="harmonics" type="checkbox"> High-Order J2–J4 / C22</label>
              <label style="display: flex; align-items: center; gap: 4px;"><input id="srp" type="checkbox"> Solar Rad Pressure (SRP)</label>
            </div>
          </div>
        </details>

        <!-- Interplanetary Lambert Flight Planner -->
        <details class="astro-details" style="margin-top: 4px; background: rgba(15,23,42,0.7); border: 1px solid rgba(253,224,71,0.25); border-radius: 6px; padding: 6px 8px;">
          <summary style="font-size: 11px; font-weight: 600; color: #fde047; cursor: pointer; user-select: none;">
            🚀 Interplanetary Lambert Flight Planner
          </summary>
          <div style="display: grid; gap: 6px; margin-top: 6px; font-size: 10px;">
            <div style="display: flex; gap: 6px;">
              <label style="flex: 1;">Departure Origin
                <select id="lambertOrigin" aria-label="Lambert transfer departure origin" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;"></select>
              </label>
              <label style="flex: 1;">Target Destination
                <select id="lambertTarget" aria-label="Lambert transfer target destination" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;"></select>
              </label>
            </div>
            <div style="display: flex; gap: 6px; align-items: flex-end;">
              <label style="flex: 1;">Transfer Time (Days)
                <input id="lambertTof" type="number" aria-label="Lambert transfer time of flight in days" min="10" max="5000" value="259" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;">
              </label>
              <button id="lambertSolveBtn" type="button" style="padding: 4px 8px; font-size: 10px; font-weight: 600; background: #0284c7; color: #fff; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">Compute Lambert</button>
              <button id="porkchopBtn" type="button" style="padding: 4px 8px; font-size: 10px; font-weight: 600; background: #7c3aed; color: #fff; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;" title="Run Porkchop analysis to find global minimum Delta-v launch window">⚡ Porkchop Scan</button>
            </div>
            <div id="lambertResult" style="padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(110,231,183,0.3); border-radius: 4px; font-family: var(--font-mono, monospace); white-space: pre-wrap; font-size: 9.5px; color: #6ee7b7; display: none; line-height: 1.4;"></div>
          </div>
        </details>

        <!-- Hyperbolic B-Plane & Gravity Assist Targeting -->
        <details class="astro-details" style="margin-top: 4px; background: rgba(15,23,42,0.7); border: 1px solid rgba(168,85,247,0.25); border-radius: 6px; padding: 6px 8px;">
          <summary style="font-size: 11px; font-weight: 600; color: #c084fc; cursor: pointer; user-select: none;">
            🎯 Hyperbolic B-Plane & Gravity Assist Targeting
          </summary>
          <div style="display: grid; gap: 6px; margin-top: 6px; font-size: 10px;">
            <div style="display: flex; gap: 6px;">
              <label style="flex: 1;">Encounter Planet
                <select id="bplanePlanet" aria-label="B-plane encounter planet" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;">
                  <option value="jupiter" selected>Jupiter (Gravity Assist King)</option>
                  <option value="earth">Earth (Resonant Return / Flyby)</option>
                  <option value="venus">Venus (Inner System Slingshot)</option>
                  <option value="mars">Mars (Outer Boost)</option>
                  <option value="saturn">Saturn (Deep Space Slingshot)</option>
                </select>
              </label>
              <label style="flex: 1;">Periapsis Alt (km)
                <input id="bplaneAlt" type="number" aria-label="B-plane periapsis altitude in kilometres" min="100" max="2000000" value="5000" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;">
              </label>
            </div>
            <div style="display: flex; gap: 6px; align-items: flex-end;">
              <label style="flex: 1;">Approach v_∞ (km/s)
                <input id="bplaneVinf" type="number" aria-label="B-plane approach v-infinity in km per second" min="0.5" max="50" step="0.5" value="10.0" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;">
              </label>
              <button id="bplaneComputeBtn" type="button" style="padding: 4px 8px; font-size: 10px; font-weight: 600; background: #9333ea; color: #fff; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">Compute B-Plane</button>
            </div>
            <div id="bplaneResult" style="padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(192,132,252,0.3); border-radius: 4px; font-family: var(--font-mono, monospace); white-space: pre-wrap; font-size: 9.5px; color: #c084fc; display: none; line-height: 1.4;"></div>
          </div>
        </details>

        <!-- Universal Physics & Relativistic Light Backbone (Phase 8) -->
        <details class="astro-details" style="margin-top: 4px; background: rgba(15,23,42,0.7); border: 1px solid rgba(56,189,248,0.3); border-radius: 6px; padding: 6px 8px;">
          <summary style="font-size: 11px; font-weight: 600; color: #38bdf8; cursor: pointer; user-select: none;">
            ⚡ Universal Physics & Relativistic Light Backbone
          </summary>
          <div style="display: grid; gap: 6px; margin-top: 6px; font-size: 10px;">
            <div style="display: flex; gap: 6px; align-items: flex-end;">
              <label style="flex: 1;">Celestial Target & Scale
                <select id="backboneTarget" aria-label="Trajectory backbone target" style="width: 100%; font-size: 10px; padding: 2px 4px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; margin-top: 2px;">
                  <option value="mars" selected>Mars (Planetary Scale, 1.5 AU)</option>
                  <option value="neptune">Neptune (Outer System, 30.0 AU)</option>
                  <option value="proxima_centauri">Proxima Centauri (Interstellar, 4.24 ly)</option>
                  <option value="sgra">Sagittarius A* (SMBH Lensing & Photon Sphere, 26,700 ly)</option>
                  <option value="andromeda_galaxy">Andromeda Galaxy M31 (Local Group Infall, 2.5 Mly)</option>
                  <option value="virgo_cluster">Virgo Cluster (FLRW Dark Energy, 54 Mly)</option>
                  <option value="laniakea">Laniakea Supercluster (Cosmic Web Basin, 250 Mly)</option>
                </select>
              </label>
              <button id="backboneComputeBtn" type="button" style="padding: 4px 8px; font-size: 10px; font-weight: 600; background: #0284c7; color: #fff; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">⚡ Inspect Physics</button>
            </div>
            <div id="backboneResult" style="padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(56,189,248,0.3); border-radius: 4px; font-family: var(--font-mono, monospace); white-space: pre-wrap; font-size: 9.5px; color: #7dd3fc; display: none; line-height: 1.4;"></div>
          </div>
        </details>

        <!-- Telemetry Readout -->
        <pre id="readout" role="status" aria-live="polite" aria-atomic="true"></pre>
      </div>
    </div>
  `;

  const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  const subtitle = q<HTMLElement>('#panelSubtitle');
  if (subtitle) {
    const n = cosmicCatalog.getAllNodes().length;
    subtitle.textContent = `Solar System · Planetary Moons · Astrodynamics Registry — ${n} catalog objects`;
  }

  const dynamicsStatus = q<HTMLElement>('#dynamicsStatus');
  const toggleDynamics = q<HTMLButtonElement>('#toggleDynamics');
  const reseedBtn = q<HTMLButtonElement>('#reseedBtn');

  const play = q<HTMLButtonElement>('#play'),
    rev = q<HTMLButtonElement>('#rev'),
    speed = q<HTMLInputElement>('#speed'),
    speedLabel = q<HTMLSpanElement>('#speedLabel');
  const frameSel = q<HTMLSelectElement>('#frame'),
    focusSel = q<HTMLSelectElement>('#focus');
  const scaleModeSel = q<HTMLSelectElement>('#scaleMode');
  const scaleExagIn = q<HTMLInputElement>('#scaleExag');
  const exagRow = q<HTMLElement>('#exagRow');
  const exagVal = q<HTMLElement>('#exagVal');
  const compressIn = q<HTMLInputElement>('#compress') as HTMLInputElement | null;
  const cLabel = q<HTMLSpanElement>('#cLabel') as HTMLSpanElement | null;
  const factsBox = q<HTMLDivElement>('#factsBox');
  const showOrbitPathsIn = q<HTMLInputElement>('#showOrbitPaths');
  const showLabelsIn = q<HTMLInputElement>('#showLabels');
  const showMilkyWayIn = q<HTMLInputElement>('#showMilkyWay');
  const showOortCloudIn = q<HTMLInputElement>('#showOortCloud');
  const trailSel = q<HTMLSelectElement>('#trailDays'),
    dateIn = q<HTMLInputElement>('#date');
  const out = q<HTMLPreElement>('#readout');
  const solarGalaxyModel = q<HTMLSelectElement>('#solarGalaxyModel') as HTMLSelectElement | null;

  factsBox.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong id="factsTitle" style="font-size:1.15em;color:#ffd700;"></strong>
      <button id="closeFacts" aria-label="Close selected body facts" style="padding:1px 6px;font-size:0.8em;">✕</button>
    </div>
    <div id="factsContent"></div>
  `;
  const factsTitle = q<HTMLElement>('#factsTitle');
  const factsContent = q<HTMLElement>('#factsContent');
  const ephCoverageStatus = q<HTMLElement>('#ephCoverageStatus');
  let coverageNoticeUntil = 0;
  q<HTMLButtonElement>('#closeFacts').onclick = () => store.set('selected', null);

  fill(frameSel, ctx.frames);
  fill(focusSel, ctx.focuses);

  const presetSelect = q<HTMLSelectElement>('#presetSelect');
  const cameraZoomIn = q<HTMLInputElement>('#cameraZoom');
  const zoomLabel = q<HTMLSpanElement>('#zoomLabel');
  const zoomMinLabel = q<HTMLSpanElement>('#zoomMinLabel');
  const zoomMaxLabel = q<HTMLSpanElement>('#zoomMaxLabel');
  const zoomInBtn = q<HTMLButtonElement>('#zoomInBtn');
  const zoomOutBtn = q<HTMLButtonElement>('#zoomOutBtn');

  // Populate navigation dropdown with clean, professional, non-duplicated optgroups
  const categoryOrder: Array<{ cat: string; title: string }> = [
    { cat: 'solar', title: '🪐 Solar System Scales' },
    { cat: 'galaxy', title: '🌌 Milky Way & Galactic Orbit' },
    { cat: 'planets', title: '🪐 Planets & Major Worlds' },
    { cat: 'moons', title: '🌙 Major Moons & Satellites' },
  ];

  if (presetSelect) {
    presetSelect.innerHTML = categoryOrder
      .map((grp) => {
        const items = ctx.presets.filter((p) => p.category === grp.cat);
        if (items.length === 0) return '';
        return `<optgroup label="${grp.title}">${items.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`;
      })
      .join('');

    presetSelect.onchange = () => {
      store.set('preset', presetSelect.value);
    };
  }

  let isZoomDragging = false;
  const formatZoomDistance = (distAu: number): string => {
    if (distAu < 0.000001) {
      const m = Math.round(distAu * AU_KM * 1000);
      return `${m.toLocaleString()} m (${(distAu * 1e6).toFixed(2)} µAU)`;
    }
    if (distAu < 0.0001) {
      const km = Math.round(distAu * AU_KM);
      return `${km.toLocaleString()} km (${(distAu * 1e6).toFixed(1)} µAU)`;
    }
    if (distAu < 0.01) {
      const km = Math.round(distAu * AU_KM);
      return `${km.toLocaleString()} km (${distAu.toFixed(5)} AU)`;
    }
    if (distAu < 1) {
      const km = Math.round(distAu * AU_KM);
      return `${distAu.toFixed(4)} AU (${km.toLocaleString()} km)`;
    }
    if (distAu < 100) {
      return `${distAu.toFixed(2)} AU`;
    }
    if (distAu < AU_PER_LIGHT_YEAR) {
      return `${Math.round(distAu).toLocaleString()} AU`;
    }
    const ly = distAu / AU_PER_LIGHT_YEAR;
    return `${ly.toFixed(2)} ly (${Math.round(distAu).toLocaleString()} AU)`;
  };

  if (cameraZoomIn) {
    cameraZoomIn.addEventListener('pointerdown', () => { isZoomDragging = true; });
    window.addEventListener('pointerup', () => { isZoomDragging = false; });

    cameraZoomIn.oninput = () => {
      const distAu = 10 ** Number(cameraZoomIn.value);
      if (zoomLabel) zoomLabel.textContent = formatZoomDistance(distAu);
      ctx.onZoomChange?.(distAu);
    };
  }

  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      const curDist = 10 ** Number(cameraZoomIn.value);
      const newDist = Math.max(10 ** -6.0, curDist / 1.5);
      cameraZoomIn.value = String(Math.log10(newDist));
      if (zoomLabel) zoomLabel.textContent = formatZoomDistance(newDist);
      ctx.onZoomChange?.(newDist);
    };
  }

  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      const curDist = 10 ** Number(cameraZoomIn.value);
      const newDist = Math.min(10 ** 5.0, curDist * 1.5);
      cameraZoomIn.value = String(Math.log10(newDist));
      if (zoomLabel) zoomLabel.textContent = formatZoomDistance(newDist);
      ctx.onZoomChange?.(newDist);
    };
  }

  dateIn.value = new Date().toISOString().slice(0, 10);

  const sync = () => {
    const s = store.get();

    // Dynamics badge
    if (s.dynamicsMode === 'ephemeris') {
      dynamicsStatus.textContent = 'DE440 Ephemeris';
      dynamicsStatus.className = 'status-badge badge-eph';
    } else {
      dynamicsStatus.textContent = 'Yoshida-4 N-Body';
      dynamicsStatus.className = 'status-badge badge-sim';
    }

    const coverage = ctx.ephemerisCoverage;
    const defaultCoverage = coverage
      ? `Ephemeris validated from ${coverage.fromDate} to ${coverage.toDate} UTC. Dates outside this range are clamped.`
      : 'Ephemeris validation window unavailable — contact maintainers before relying on absolute positions.';
    ephCoverageStatus.style.display = s.dynamicsMode === 'ephemeris' ? 'block' : 'none';
    if (s.dynamicsMode === 'ephemeris' && coverage) {
      dateIn.min = coverage.fromDate;
      dateIn.max = coverage.toDate;
    } else if (s.dynamicsMode === 'ephemeris') {
      dateIn.removeAttribute('min');
      dateIn.removeAttribute('max');
    } else {
      dateIn.removeAttribute('min');
      dateIn.removeAttribute('max');
    }
    ephCoverageStatus.textContent =
      Date.now() < coverageNoticeUntil ? ephCoverageStatus.textContent : defaultCoverage;

    play.textContent = s.playing ? 'Pause' : 'Play';
    rev.textContent = s.reversed ? 'Backward' : 'Forward';
    speed.value = String(Math.log10(s.speed));
    speedLabel.textContent = formatSimSpeed(s.speed);
    frameSel.value = s.frame;
    focusSel.value = s.focus;
    trailSel.value = String(s.trailDays);
    scaleModeSel.value = s.scaleMode;
    exagRow.style.display = s.scaleMode === 'exaggerated' ? 'block' : 'none';
    scaleExagIn.value = String(s.scaleExaggeration);
    exagVal.textContent = `${s.scaleExaggeration}x`;
    if (compressIn) compressIn.value = String(Math.log10(s.compress));
    if (showOrbitPathsIn) showOrbitPathsIn.checked = s.showOrbitPaths !== false;
    if (showLabelsIn) showLabelsIn.checked = s.showLabels !== false;
    if (showMilkyWayIn) showMilkyWayIn.checked = !!s.showMilkyWay;
    if (showOortCloudIn) showOortCloudIn.checked = !!s.showOortCloud;
    const ratio = Math.round(1 / s.compress);
    if (cLabel) {
      cLabel.textContent =
        ratio === 1 ? '1:1' : s.preset === 'cosmic' ? `wake ×${ratio}` : `1:${ratio} (visual only)`;
    }

    if (solarGalaxyModel) solarGalaxyModel.value = s.galaxyModelId ?? 'iau1985';

    if (presetSelect) presetSelect.value = s.preset;

    // Update Cosmic Breadcrumbs
    const activeCosmicId =
      (s.selected && getCosmicNode(s.selected)?.id) ||
      (s.preset && PRESET_TO_NODE[s.preset]) ||
      (s.focus && s.focus !== 'barycenter' && getCosmicNode(s.focus)?.id) ||
      'solar_system';
    updateBreadcrumbs(activeCosmicId);

    // Dynamic context-aware zoom scale indicators
    if (zoomMinLabel && zoomMaxLabel) {
      const focusId = s.focus;
      if (focusId && focusId !== 'sun' && focusId !== 'barycenter' && focusId !== 'sgra') {
        zoomMinLabel.textContent = 'Surface / LEO';
        zoomMaxLabel.textContent = 'Orbital System';
      } else if (s.preset === 'milkyWay' || s.preset === 'sgra' || s.preset === 'sunGalaxy' || s.preset === 'cosmic') {
        zoomMinLabel.textContent = 'Inner Core';
        zoomMaxLabel.textContent = 'Galactic Halo';
      } else {
        zoomMinLabel.textContent = 'Sun Core (AU)';
        zoomMaxLabel.textContent = 'Deep Space (AU)';
      }
    }
  };

  // Dynamics mode actions
  toggleDynamics.onclick = () =>
    store.set(
      'dynamicsMode',
      store.get().dynamicsMode === 'ephemeris' ? 'simulation' : 'ephemeris',
    );
  reseedBtn.onclick = async () => {
    const orig = reseedBtn.textContent;
    reseedBtn.disabled = true;
    reseedBtn.textContent = 'Syncing Horizons...';
    try {
      const res = await ctx.onReseedHorizons?.();
      reseedBtn.textContent = res?.live ? '✓ Horizons Synced' : 'Local DE440 (live unavailable)';
    } catch {
      reseedBtn.textContent = 'Sync failed — state unchanged';
    } finally {
      reseedBtn.disabled = false;
    }
    setTimeout(() => {
      reseedBtn.textContent = orig;
    }, 2500);
  };

  const handleGalaxyModel = (val: string) => {
    store.set('galaxyModelId', val);
    ctx.onGalaxyModelChange?.(val);
  };
  if (solarGalaxyModel) solarGalaxyModel.onchange = () => handleGalaxyModel(solarGalaxyModel.value);

  // Playback & input actions
  play.onclick = () => store.set('playing', !store.get().playing);
  rev.onclick = () => store.set('reversed', !store.get().reversed);
  const showCoverageNotice = (message: string | null) => {
    if (!message) return;
    ephCoverageStatus.textContent = message;
    coverageNoticeUntil = Date.now() + 6_000;
  };
  const seekAndReport = async (result: string | null | Promise<string | null>) => {
    showCoverageNotice(await result);
  };
  q('#reset').onclick = ctx.onReset;
  q('#now').onclick = () => void seekAndReport(ctx.onNow());
  q('#go').onclick = () => {
    if (dateIn.value) void seekAndReport(ctx.onSeekDate(new Date(`${dateIn.value}T00:00:00Z`)));
  };
  const realtimeBtn = q<HTMLButtonElement>('#realtimeBtn');
  if (realtimeBtn) {
    realtimeBtn.onclick = () => {
      // Authentic NASA 1:1 real-time: 1 second per second (1/86400 days/sec)
      store.set('speed', 1 / 86400);
    };
  }
  speed.oninput = () => {
    const sVal = 10 ** Number(speed.value);
    store.set('speed', sVal);
    speedLabel.textContent = formatSimSpeed(sVal);
  };
  if (frameSel) frameSel.onchange = () => store.set('frame', frameSel.value);
  if (focusSel) focusSel.onchange = () => store.set('focus', focusSel.value);
  if (scaleModeSel) scaleModeSel.onchange = () => store.set('scaleMode', scaleModeSel.value as ScaleMode);
  if (scaleExagIn) {
    scaleExagIn.oninput = () => {
      store.set('scaleExaggeration', Number(scaleExagIn.value));
      if (exagVal) exagVal.textContent = `${scaleExagIn.value}x`;
    };
  }
  if (compressIn) {
    compressIn.oninput = () => {
      store.set('compress', 10 ** Number(compressIn.value));
    };
  }
  if (trailSel) trailSel.onchange = () => store.set('trailDays', Number(trailSel.value));
  const trailsIn = q<HTMLInputElement>('#trails');
  if (trailsIn) {
    trailsIn.onchange = (e) =>
      store.set('trails', (e.target as HTMLInputElement).checked);
  }
  if (showOrbitPathsIn) {
    showOrbitPathsIn.onchange = (e) =>
      store.set('showOrbitPaths', (e.target as HTMLInputElement).checked);
  }
  if (showLabelsIn) {
    showLabelsIn.onchange = (e) =>
      store.set('showLabels', (e.target as HTMLInputElement).checked);
  }
  if (showMilkyWayIn) {
    showMilkyWayIn.onchange = (e) =>
      store.set('showMilkyWay', (e.target as HTMLInputElement).checked);
  }
  if (showOortCloudIn) {
    showOortCloudIn.onchange = (e) =>
      store.set('showOortCloud', (e.target as HTMLInputElement).checked);
  }

  // -------------------------------------------------------------
  // NASA High-Precision Symplectic Physics & Force Model Wiring
  // -------------------------------------------------------------
  const intSel = q<HTMLSelectElement>('#integrator') as HTMLSelectElement | null;
  const eihRelIn = q<HTMLInputElement>('#eihRelativity') as HTMLInputElement | null;
  const relIn = q<HTMLInputElement>('#relativity') as HTMLInputElement | null;
  const quadIn = q<HTMLInputElement>('#quadrupole') as HTMLInputElement | null;
  const harmIn = q<HTMLInputElement>('#harmonics') as HTMLInputElement | null;
  const srpIn = q<HTMLInputElement>('#srp') as HTMLInputElement | null;

  const emitPhysics = () => {
    ctx.onPhysicsChange?.({
      integrator: (intSel?.value as IntegratorName) ?? 'yoshida6',
      relativity: relIn ? relIn.checked : true,
      eihRelativity: eihRelIn ? eihRelIn.checked : false,
      quadrupole: quadIn ? quadIn.checked : true,
      harmonics: harmIn ? harmIn.checked : false,
      srp: srpIn ? srpIn.checked : false,
    });
  };
  if (intSel) intSel.onchange = emitPhysics;
  if (eihRelIn) eihRelIn.onchange = emitPhysics;
  if (relIn) relIn.onchange = emitPhysics;
  if (quadIn) quadIn.onchange = emitPhysics;
  if (harmIn) harmIn.onchange = emitPhysics;
  if (srpIn) srpIn.onchange = emitPhysics;

  // -------------------------------------------------------------
  // Interplanetary Lambert Orbital Transfer Targeting Solver
  // -------------------------------------------------------------
  const lambertOrigin = q<HTMLSelectElement>('#lambertOrigin') as HTMLSelectElement | null;
  const lambertTarget = q<HTMLSelectElement>('#lambertTarget') as HTMLSelectElement | null;
  const lambertTof = q<HTMLInputElement>('#lambertTof') as HTMLInputElement | null;
  const lambertSolveBtn = q<HTMLButtonElement>('#lambertSolveBtn') as HTMLButtonElement | null;
  const porkchopBtn = q<HTMLButtonElement>('#porkchopBtn') as HTMLButtonElement | null;
  const lambertResult = q<HTMLDivElement>('#lambertResult') as HTMLDivElement | null;

  if (lambertOrigin && lambertTarget) {
    const planets = ctx.focuses.filter(
      (f) => !['barycenter', 'sgra', 'sun'].includes(f.id) && !f.id.includes('moon')
    );
    fill(lambertOrigin, planets);
    fill(lambertTarget, planets);
    lambertOrigin.value = 'earth';
    lambertTarget.value = 'mars';
  }

  if (lambertSolveBtn && lambertOrigin && lambertTarget && lambertTof && lambertResult) {
    lambertSolveBtn.onclick = () => {
      const oId = lambertOrigin.value;
      const tId = lambertTarget.value;
      if (oId === tId) {
        lambertResult.style.display = 'block';
        lambertResult.textContent = 'Origin and target must be different celestial bodies.';
        return;
      }
      const oState = ctx.getBodyState?.(oId);
      const tState = ctx.getBodyState?.(tId);
      if (!oState || !tState) {
        lambertResult.style.display = 'block';
        lambertResult.textContent = 'Ephemeris telemetry unavailable for selected bodies.';
        return;
      }

      const tof = Number(lambertTof.value) || 259;
      const GM_SUN_AU = gmToInternal(GM_SUN_KM3_S2);
      try {
        const sol = solveLambert(GM_SUN_AU, oState.pos, tState.pos, tof, true);
        const v1Rel = [sol.v1[0] - oState.vel[0], sol.v1[1] - oState.vel[1], sol.v1[2] - oState.vel[2]];
        const v2Rel = [sol.v2[0] - tState.vel[0], sol.v2[1] - tState.vel[1], sol.v2[2] - tState.vel[2]];
        const dv1Kms = auDayToKms(Math.hypot(v1Rel[0]!, v1Rel[1]!, v1Rel[2]!));
        const dv2Kms = auDayToKms(Math.hypot(v2Rel[0]!, v2Rel[1]!, v2Rel[2]!));
        const dvTotal = dv1Kms + dv2Kms;
        const c3 = dv1Kms * dv1Kms;
        const isp = 380; // Hydrolox / Methalox flight standard (RL10 / Raptor Vacuum)
        const ve = isp * 0.00980665; // km/s
        const propFraction = (1 - Math.exp(-dvTotal / ve)) * 100;

        lambertResult.style.display = 'block';
        lambertResult.textContent = [
          `✦ Universal Stumpff Lambert Transfer (${tof} days)`,
          `Departure Δv₁:   ${dv1Kms.toFixed(2)} km/s  (C₃ = ${c3.toFixed(1)} km²/s²)`,
          `Arrival Δv₂:     ${dv2Kms.toFixed(2)} km/s`,
          `Total Mission Δv: ${dvTotal.toFixed(2)} km/s`,
          `Transfer Orbit:  a = ${sol.a.toFixed(3)} AU | e = ${sol.e.toFixed(4)}`,
          `Propellant Mass:  ${propFraction.toFixed(1)}% (Isp = 380s, Tsiolkovsky)`,
        ].join('\n');
      } catch (err: unknown) {
        lambertResult.style.display = 'block';
        lambertResult.textContent = `Lambert solver convergence: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
  }

  if (porkchopBtn && lambertOrigin && lambertTarget && lambertTof && lambertResult) {
    porkchopBtn.onclick = () => {
      const oId = lambertOrigin.value;
      const tId = lambertTarget.value;
      if (oId === tId) {
        lambertResult.style.display = 'block';
        lambertResult.textContent = 'Origin and target must be different celestial bodies.';
        return;
      }
      const oState = ctx.getBodyState?.(oId);
      const tState = ctx.getBodyState?.(tId);
      if (!oState || !tState) {
        lambertResult.style.display = 'block';
        lambertResult.textContent = 'Ephemeris telemetry unavailable for selected bodies.';
        return;
      }

      const curDate = dateIn.value ? new Date(`${dateIn.value}T00:00:00Z`).getTime() : Date.now();
      const curJd = curDate / 86400000 + 2440587.5;
      const GM_SUN_AU = gmToInternal(GM_SUN_KM3_S2);

      const r1Len = Math.hypot(oState.pos[0], oState.pos[1], oState.pos[2]);
      const r2Len = Math.hypot(tState.pos[0], tState.pos[1], tState.pos[2]);
      const n1 = Math.sqrt(GM_SUN_AU / (r1Len * r1Len * r1Len));
      const n2 = Math.sqrt(GM_SUN_AU / (r2Len * r2Len * r2Len));

      const originProp = (jd: number) => {
        const dt = jd - curJd;
        const angle = n1 * dt;
        const c = Math.cos(angle), s = Math.sin(angle);
        const pos: [number, number, number] = [
          oState.pos[0] * c - oState.pos[1] * s,
          oState.pos[0] * s + oState.pos[1] * c,
          oState.pos[2],
        ];
        const vel: [number, number, number] = [
          oState.vel[0] * c - oState.vel[1] * s,
          oState.vel[0] * s + oState.vel[1] * c,
          oState.vel[2],
        ];
        return { pos, vel };
      };

      const targetProp = (jd: number) => {
        const dt = jd - curJd;
        const angle = n2 * dt;
        const c = Math.cos(angle), s = Math.sin(angle);
        const pos: [number, number, number] = [
          tState.pos[0] * c - tState.pos[1] * s,
          tState.pos[0] * s + tState.pos[1] * c,
          tState.pos[2],
        ];
        const vel: [number, number, number] = [
          tState.vel[0] * c - tState.vel[1] * s,
          tState.vel[0] * s + tState.vel[1] * c,
          tState.vel[2],
        ];
        return { pos, vel };
      };

      const grid = generatePorkchopGrid({
        mu: GM_SUN_AU,
        originState: originProp,
        targetState: targetProp,
        depStartJd: curJd - 30,
        depEndJd: curJd + 60,
        depSteps: 10,
        arrStartJd: curJd + 120,
        arrEndJd: curJd + 360,
        arrSteps: 10,
        minTofDays: 90,
        maxTofDays: 380,
      });

      const best = grid.best;
      lambertTof.value = String(Math.round(best.tofDays));
      const depDateIso = new Date((best.depJd - 2440587.5) * 86400000).toISOString().slice(0, 10);
      const arrDateIso = new Date((best.arrJd - 2440587.5) * 86400000).toISOString().slice(0, 10);

      lambertResult.style.display = 'block';
      lambertResult.textContent = [
        `⚡ Optimal Porkchop Transfer Window Found:`,
        `Departure Date:   ${depDateIso} (JD ${best.depJd.toFixed(1)})`,
        `Arrival Date:     ${arrDateIso} (JD ${best.arrJd.toFixed(1)})`,
        `Optimal TOF:      ${Math.round(best.tofDays)} days`,
        `Minimum Total Δv: ${best.dvTotalKms.toFixed(2)} km/s`,
        `Departure C₃:     ${best.c3.toFixed(1)} km²/s² (v_inf = ${best.vInfDepKms.toFixed(2)} km/s)`,
        `Arrival v_inf:    ${best.vInfArrKms.toFixed(2)} km/s`,
        `Propellant Mass:  ${(best.propellantFraction * 100).toFixed(1)}% (Isp = 380s)`,
      ].join('\n');
    };
  }

  // -------------------------------------------------------------
  // Hyperbolic B-Plane Targeting & Gravity Assist Analysis
  // -------------------------------------------------------------
  const bplanePlanet = q<HTMLSelectElement>('#bplanePlanet') as HTMLSelectElement | null;
  const bplaneAlt = q<HTMLInputElement>('#bplaneAlt') as HTMLInputElement | null;
  const bplaneVinf = q<HTMLInputElement>('#bplaneVinf') as HTMLInputElement | null;
  const bplaneComputeBtn = q<HTMLButtonElement>('#bplaneComputeBtn') as HTMLButtonElement | null;
  const bplaneResult = q<HTMLDivElement>('#bplaneResult') as HTMLDivElement | null;

  const PLANET_PARAMS: Record<string, { gm: number; radiusKm: number; name: string }> = Object.fromEntries(
    ['jupiter', 'earth', 'venus', 'mars', 'saturn'].map((id) => [id, bodyParams(id)]),
  );

  if (bplaneComputeBtn && bplanePlanet && bplaneAlt && bplaneVinf && bplaneResult) {
    bplaneComputeBtn.onclick = () => {
      const pid = bplanePlanet.value;
      const param = PLANET_PARAMS[pid];
      if (!param) return;

      const altKm = Number(bplaneAlt.value) || 5000;
      const vInfKms = Number(bplaneVinf.value) || 10.0;

      const rpKm = param.radiusKm + altKm;
      const rpAu = rpKm / AU_KM;

      const gmAu = gmToInternal(param.gm);
      const vInfAuDay = kmsToAuDay(vInfKms);

      const bMagAu = periapsisToBMag(gmAu, rpAu, vInfAuDay);
      const bMagKm = bMagAu * AU_KM;

      const turnAngleRad = hyperbolicTurnAngle(gmAu, rpAu, vInfAuDay);
      const turnAngleDeg = (turnAngleRad * 180) / Math.PI;

      const vpAuDay = Math.sqrt(vInfAuDay * vInfAuDay + (2 * gmAu) / rpAu);
      const vpKms = auDayToKms(vpAuDay);

      const c3 = vInfKms * vInfKms;
      const freeDeltaV = 2 * vInfKms * Math.sin(turnAngleRad / 2);

      const soiAu = PLANET_SOI_AU[pid] ?? 0.1;
      const soiKm = soiAu * AU_KM;

      bplaneResult.style.display = 'block';
      bplaneResult.textContent = [
        `✦ Hyperbolic B-Plane & Gravity Assist Solution:`,
        `Encounter Target:    ${param.name} (R = ${param.radiusKm.toLocaleString()} km)`,
        `Target Periapsis:    ${altKm.toLocaleString()} km alt (r_p = ${Math.round(rpKm).toLocaleString()} km)`,
        `Approach Speed:      v_∞ = ${vInfKms.toFixed(2)} km/s  (C₃ = ${c3.toFixed(1)} km²/s²)`,
        `B-Vector Magnitude:  |B| = ${Math.round(bMagKm).toLocaleString()} km (Focusing: ${(bMagKm / rpKm).toFixed(2)}×)`,
        `Encounter Turn Angle: δ = ${turnAngleDeg.toFixed(2)}°`,
        `Periapsis Velocity:  v_p = ${vpKms.toFixed(2)} km/s`,
        `Free Heliocentric Δv: ${freeDeltaV.toFixed(2)} km/s gained`,
        `Laplace SOI Radius:  ${Math.round(soiKm).toLocaleString()} km (${soiAu.toFixed(5)} AU)`,
      ].join('\n');
    };
  }

  // -------------------------------------------------------------
  // Universal Multi-Scale Physics & Relativistic Light Backbone (Phase 8)
  // -------------------------------------------------------------
  const backboneTarget = q<HTMLSelectElement>('#backboneTarget') as HTMLSelectElement | null;
  const backboneComputeBtn = q<HTMLButtonElement>('#backboneComputeBtn') as HTMLButtonElement | null;
  const backboneResult = q<HTMLDivElement>('#backboneResult') as HTMLDivElement | null;

  const TARGET_SPECS: Record<string, {
    name: string;
    tier: CosmicTier;
    anchorId: string;
    distanceLy: number;
    distanceAu?: number;
    velKms: number;
    gmInternal?: number;
    luminositySolar?: number;
  }> = {
    mars: { name: 'Mars (Planetary Scale)', tier: 'planetary_system', anchorId: 'sun', distanceLy: 1.524 / AU_PER_LIGHT_YEAR, distanceAu: 1.524, velKms: 24.1, gmInternal: gmToInternal(bodyParams('mars').gm), luminositySolar: 1e-9 },
    neptune: { name: 'Neptune (Outer System)', tier: 'planetary_system', anchorId: 'sun', distanceLy: 30.07 / AU_PER_LIGHT_YEAR, distanceAu: 30.07, velKms: 5.4, gmInternal: gmToInternal(bodyParams('neptune').gm), luminositySolar: 1e-9 },
    proxima_centauri: { name: 'Proxima Centauri (Alpha Cen C)', tier: 'star_system', anchorId: 'milky_way', distanceLy: 4.2465, velKms: 32.2, luminositySolar: 0.0017 },
    sgra: { name: 'Sagittarius A* (SMBH Lensing)', tier: 'galaxy_structure', anchorId: 'milky_way', distanceLy: 26700, velKms: 0, gmInternal: gmToInternal(GM_SUN_KM3_S2 * SGRA_MASS_SOLAR), luminositySolar: 100 },
    andromeda_galaxy: { name: 'Andromeda Galaxy (M31)', tier: 'local_group', anchorId: 'laniakea', distanceLy: 2537000, velKms: -110, luminositySolar: 2.6e10 },
    virgo_cluster: { name: 'Virgo Galaxy Cluster', tier: 'supercluster', anchorId: 'laniakea', distanceLy: 54000000, velKms: 1150, luminositySolar: 1e12 },
    laniakea: { name: 'Laniakea Supercluster', tier: 'supercluster', anchorId: 'laniakea', distanceLy: 250000000, velKms: 600, luminositySolar: 1e14 },
  };

  if (backboneComputeBtn && backboneTarget && backboneResult) {
    backboneComputeBtn.onclick = () => {
      const tid = backboneTarget.value;
      const spec = TARGET_SPECS[tid];
      if (!spec) return;

      const obsCoord = createUniversalCoordinate('sun', 'planetary_system', { x: 0, y: 0, z: 0 });
      let tgtCoord;
      if (spec.distanceAu) {
        tgtCoord = createUniversalCoordinate(spec.anchorId, spec.tier, { x: 0, y: 0, z: 0 }, { x: spec.distanceAu * METERS_PER_AU, y: 0, z: 0 });
      } else {
        tgtCoord = createUniversalCoordinate(spec.anchorId, spec.tier, { x: spec.distanceLy, y: 0, z: 0 });
      }

      // Earth orbital velocity ~ 29.78 km/s
      const obsVelAU = { x: 0, y: (29.78 * 86400) / AU_KM, z: 0 };
      const tgtVelAU = { x: 0, y: (spec.velKms * 86400) / AU_KM, z: 0 };

      const physics = universeBackbone.evaluateTargetPhysics(
        tgtCoord,
        obsCoord,
        tgtVelAU,
        obsVelAU,
        {
          targetGmInternal: spec.gmInternal,
          targetLuminositySolar: spec.luminositySolar,
        },
      );

      const lt = physics.lightTime!;
      const ltStr = lt.tauSeconds < 3600
        ? `${(lt.tauSeconds / 60).toFixed(2)} min (${lt.tauSeconds.toFixed(1)} s)`
        : lt.tauSeconds < 86400 * 365.25
        ? `${(lt.tauSeconds / 86400).toFixed(2)} days`
        : `${(lt.tauSeconds / (86400 * 365.25)).toFixed(2)} years`;

      const g = physics.gravity;
      const gRegimeLabels: Record<string, string> = {
        planetary_pn: 'Planetary 1PN Post-Newtonian (EIH + Harmonics)',
        galactic_nfw: 'Galactic Navarro-Frenk-White (NFW) Dark Matter Halo',
        local_group: 'Local Group Mutual Infall & Tidal Dynamics',
        cosmological_flrw: 'Cosmological FLRW Dark Energy Metric Acceleration',
      };

      const z = physics.redshift!;
      const phot = physics.photometry!;

      backboneResult.style.display = 'block';
      backboneResult.textContent = [
        `⚡ Universal Backbone Physics Telemetry:`,
        `Target Object:       ${spec.name}`,
        `Coordinate Regime:   Tier [${tgtCoord.tier}] | Local Anchor: [${tgtCoord.anchorId}]`,
        `Local Displacement:  ${tgtCoord.localOffsetMeters.x.toLocaleString()} m (Sub-mm Precision)`,
        `Global Distance:     ${spec.distanceLy < 1 ? (spec.distanceLy * AU_PER_LIGHT_YEAR).toFixed(3) + ' AU' : spec.distanceLy.toLocaleString() + ' ly'}`,
        `------------------------------------------------------------`,
        `🔬 Multi-Scale Gravity Regime:`,
        `  Active Regime:     ${gRegimeLabels[g.regime] ?? g.regime}`,
        `  Acceleration:      ${g.accMagnitudeMPerS2.toExponential(4)} m/s²`,
        ...(g.darkEnergyRepulsionKpcMyr2 ? [`  Dark Energy Out:   ${g.darkEnergyRepulsionKpcMyr2.toExponential(3)} kpc/Myr² (Cosmic Acceleration)`] : []),
        `------------------------------------------------------------`,
        `📡 Relativistic Light & Radiation:`,
        `  One-Way Light Time: ${ltStr} (Iterations: ${lt.iterations})`,
        `  Round-Trip Time:    ${(lt.roundTripSeconds / (lt.roundTripSeconds < 3600 ? 60 : 86400)).toFixed(2)} ${lt.roundTripSeconds < 3600 ? 'min' : 'days'}`,
        `  Stellar Aberration: ${physics.aberration?.displacementArcsec.toFixed(3)}″ (Earth v/c Lorentz)`,
        `  Spectral Redshift:  z_total = ${z.zTotal.toExponential(4)} (Radial v: ${z.radialVelocityKms.toFixed(1)} km/s)`,
        `  Doppler Beaming:    ${z.beamingFactor.toFixed(4)}× intensity factor`,
        `  Apparent Magnitude: m_V = ${phot.apparentMagnitude.toFixed(2)} (Flux: ${phot.fluxWattsPerM2.toExponential(3)} W/m²)`,
      ].join('\n');
    };
  }

  // -------------------------------------------------------------
  // Universal NASA Multiscale Navigation & Catalog Registry Mapping
  // -------------------------------------------------------------
  const PRESET_TO_NODE: Record<string, string> = {
    milkyWay: 'milky_way',
    sgra: 'sgra',
    sunGalaxy: 'sun',
    cosmic: 'solar_system',
    oort: 'oort_cloud',
    outer: 'solar_system',
    inner: 'solar_system',
    earthMoon: 'earth',
    marsMoons: 'mars',
    jupiterMoons: 'jupiter',
    saturnMoons: 'saturn',
    uranusMoons: 'uranus',
    neptuneMoons: 'neptune',
    plutoCharon: 'pluto',
    mercury: 'mercury',
    venus: 'venus',
    earth: 'earth',
    mars: 'mars',
    jupiter: 'jupiter',
    saturn: 'saturn',
    uranus: 'uranus',
    neptune: 'neptune',
    pluto: 'pluto',
    ceres: 'ceres',
    vesta: 'vesta',
    moon: 'moon',
    io: 'io',
    europa: 'europa',
    ganymede: 'ganymede',
    callisto: 'callisto',
    titan: 'titan',
    enceladus: 'enceladus',
    triton: 'triton',
  };

  const NODE_TO_PRESET: Record<string, string> = {
    laniakea: 'milkyWay',
    virgo_supercluster: 'milkyWay',
    milky_way: 'milkyWay',
    sgra: 'sgra',
    sun: 'outer',
    solar_system: 'outer',
    orion_spur: 'sunGalaxy',
    // External galaxies & Local Group neighbors
    andromeda: 'milkyWay',
    triangulum: 'milkyWay',
    lmc: 'milkyWay',
    smc: 'milkyWay',
    messier_87: 'milkyWay',
    centaurus_a: 'milkyWay',
    sagittarius_dwarf: 'milkyWay',
    // Star systems & benchmarks
    alpha_centauri: 'sunGalaxy',
    proxima_centauri: 'sunGalaxy',
    proxima_b: 'sunGalaxy',
    trappist_1: 'sunGalaxy',
    trappist_1_e: 'sunGalaxy',
    pegasi_51: 'sunGalaxy',
    '51_peg_b': 'sunGalaxy',
    kepler_186: 'sunGalaxy',
    k2_18: 'sunGalaxy',
    k2_18_b: 'sunGalaxy',
    barnards_star: 'sunGalaxy',
    vega: 'sunGalaxy',
    altair: 'sunGalaxy',
    sirius: 'sunGalaxy',
    canopus: 'sunGalaxy',
    rigel: 'sunGalaxy',
    antares: 'sunGalaxy',
    betelgeuse: 'sunGalaxy',
    deneb: 'sunGalaxy',
    tau_ceti: 'sunGalaxy',
    // Solar System structure & spacecraft
    voyager_1: 'outer',
    voyager_2: 'outer',
    new_horizons: 'outer',
    parker_solar_probe: 'outer',
    jwst: 'earth',
    oort_cloud: 'oort',
    kuiper_belt: 'outer',
    asteroid_belt: 'ceres',
    mercury: 'mercury',
    venus: 'venus',
    earth: 'earth',
    moon: 'moon',
    mars: 'mars',
    jupiter: 'jupiter',
    saturn: 'saturn',
    uranus: 'uranus',
    neptune: 'neptune',
    pluto: 'pluto',
    ceres: 'ceres',
    vesta: 'vesta',
    europa: 'europa',
    titan: 'titan',
    io: 'io',
    ganymede: 'ganymede',
    callisto: 'callisto',
    enceladus: 'enceladus',
    triton: 'triton',
  };

  /** HTML-escapes catalog/user strings — every value interpolated into innerHTML. */
  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTierIcon(tier: string, category: string): string {
    if (category === 'supercluster') return '🌌';
    if (tier === 'local_group' || tier === 'galaxy') return '🌌';
    if (category === 'black_hole') return '🕳️';
    if (category === 'star' || category === 'exoplanet_host') return '⭐';
    if (category === 'planet' || tier === 'planetary_system') return '🪐';
    if (category === 'moon' || tier === 'satellite_system') return '🌙';
    if (category === 'dwarf_planet' || category === 'asteroid') return '☄️';
    if (category === 'debris_belt') return '🌐';
    if (category === 'spacecraft') return '🛰️';
    return '✨';
  }

  const cosmicBreadcrumbsEl = q<HTMLElement>('#cosmicBreadcrumbs');
  const updateBreadcrumbs = (activeId: string) => {
    if (!cosmicBreadcrumbsEl) return;
    const crumbs = getCosmicBreadcrumbs(activeId);
    if (!crumbs.length) return;

    cosmicBreadcrumbsEl.innerHTML = crumbs
      .map((node, idx) => {
        const isLast = idx === crumbs.length - 1;
        const icon = getTierIcon(node.tier, node.category);
        const color = isLast ? '#fde047' : '#94a3b8';
        const weight = isLast ? '700' : '500';
        return `
          <span class="crumb-btn" data-node-id="${node.id}" style="cursor: pointer; color: ${color}; font-weight: ${weight};" title="${node.tier.toUpperCase()}: ${node.name}">
            ${icon} ${node.name.split(' (')[0]}
          </span>
          ${!isLast ? '<span style="color: #64748b; font-size: 9px;">›</span>' : ''}
        `;
      })
      .join('');
  };

  const navigateToCosmicNode = (nodeId: string) => {
    const node = getCosmicNode(nodeId);
    if (!node) return;

    const presetId = NODE_TO_PRESET[nodeId];
    if (presetId) {
      store.set('preset', presetId);
    } else if (node.cameraPreset) {
      store.set('frame', node.cameraPreset.frameId);
      store.set('focus', node.cameraPreset.focusId);
    }

    if (ctx.focuses.some((f) => f.id === nodeId)) {
      store.set('selected', nodeId);
      store.set('focus', nodeId);
    } else if (node.cameraPreset?.focusId && ctx.focuses.some((f) => f.id === node.cameraPreset!.focusId)) {
      store.set('focus', node.cameraPreset.focusId);
    }

    updateBreadcrumbs(nodeId);
  };

  if (cosmicBreadcrumbsEl) {
    cosmicBreadcrumbsEl.onclick = (e) => {
      const target = (e.target as HTMLElement).closest('.crumb-btn') as HTMLElement | null;
      if (!target || !target.dataset['nodeId']) return;
      navigateToCosmicNode(target.dataset['nodeId']);
    };
  }

  const searchInput = q<HTMLInputElement>('#cosmicSearchInput');
  const searchResults = q<HTMLElement>('#cosmicSearchResults');
  const searchClear = q<HTMLButtonElement>('#cosmicSearchClear');

  let searchMatches: readonly CosmicNode[] = [];
  let activeMatch = -1;
  let lastQuery = '';

  const hideSearchResults = () => {
    if (searchResults) searchResults.style.display = 'none';
    activeMatch = -1;
  };

  const highlightActiveMatch = () => {
    if (!searchResults) return;
    const items = searchResults.querySelectorAll<HTMLElement>('.search-item');
    items.forEach((el, i) => {
      const active = i === activeMatch;
      el.classList.toggle('search-item-active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const selectSearchMatch = (nodeId: string) => {
    const node = getCosmicNode(nodeId);
    if (!node || !searchInput) return;
    searchInput.value = node.name;
    hideSearchResults();
    navigateToCosmicNode(nodeId);
  };

  const performSearch = (rawQuery: string) => {
    if (!searchResults || !searchInput) return;
    const query = rawQuery.trim();
    lastQuery = query;
    activeMatch = -1;
    if (!query) {
      hideSearchResults();
      if (searchClear) searchClear.style.display = 'none';
      return;
    }
    if (searchClear) searchClear.style.display = 'block';
    searchMatches = searchCosmicNodes(query);

    const esc = escapeHtml;
    if (searchMatches.length === 0) {
      searchResults.setAttribute('role', 'status');
      searchResults.style.display = 'block';
      searchResults.innerHTML = `
        <div style="padding: 8px 12px; font-size: 11px; color: #94a3b8; text-align: center;">
          No celestial objects found matching "<em>${esc(query)}</em>".
        </div>
      `;
      return;
    }

    searchResults.setAttribute('role', 'listbox');
    searchResults.style.display = 'block';
    searchResults.innerHTML = searchMatches
      .map((node, idx) => {
        const icon = getTierIcon(node.tier, node.category);
        const distStr = node.astrometry?.distanceLy !== undefined
          ? formatCosmicDistance(node.astrometry.distanceLy)
          : node.facts.semiMajorAxisAu !== undefined
          ? `${node.facts.semiMajorAxisAu.toFixed(2)} AU`
          : '';
        const tierBadge = node.tier.replace(/_/g, ' ').toUpperCase();
        const selected = idx === activeMatch ? ' aria-selected="true"' : ' aria-selected="false"';
        return `
          <div class="search-item${idx === activeMatch ? ' search-item-active' : ''}" data-node-id="${esc(node.id)}" role="option"${selected} id="cosmicSearchOption${idx}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="font-weight: 600; font-size: 11px; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                <span>${icon}</span>
                <span>${esc(node.name)}</span>
              </div>
              <span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(56,189,248,0.15); color: #38bdf8; font-family: monospace;">${esc(tierBadge)}</span>
            </div>
            <div style="font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${esc(node.description)}</span>
              ${distStr ? `<span style="color: #cbd5e1; font-weight: 500; font-family: monospace;">${esc(distStr)}</span>` : ''}
            </div>
          </div>
        `;
      })
      .join('');
    highlightActiveMatch();
  };

  if (searchInput && searchResults && searchClear) {
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-controls', 'cosmicSearchResults');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('spellcheck', 'false');

    searchInput.oninput = () => {
      performSearch(searchInput.value);
      searchInput.setAttribute('aria-expanded', searchResults.style.display !== 'none' ? 'true' : 'false');
    };
    searchInput.onfocus = () => {
      if (searchInput.value.trim()) performSearch(searchInput.value);
    };

    searchInput.onkeydown = (e) => {
      const hasResults = searchResults.style.display !== 'none' && searchMatches.length > 0;
      switch (e.key) {
        case 'ArrowDown': {
          if (!hasResults) break;
          activeMatch = (activeMatch + 1) % searchMatches.length;
          highlightActiveMatch();
          e.preventDefault();
          break;
        }
        case 'ArrowUp': {
          if (!hasResults) break;
          activeMatch = activeMatch <= 0 ? searchMatches.length - 1 : activeMatch - 1;
          highlightActiveMatch();
          e.preventDefault();
          break;
        }
        case 'Enter': {
          if (hasResults) {
            e.preventDefault();
            const target = activeMatch >= 0 ? searchMatches[activeMatch] : searchMatches[0];
            if (target) selectSearchMatch(target.id);
          }
          break;
        }
        case 'Escape': {
          if (searchResults.style.display !== 'none') {
            hideSearchResults();
            searchInput.setAttribute('aria-expanded', 'false');
            e.preventDefault();
          }
          break;
        }
        default:
          break;
      }
    };

    searchClear.onclick = () => {
      searchInput.value = '';
      searchInput.setAttribute('aria-expanded', 'false');
      searchClear.style.display = 'none';
      hideSearchResults();
      searchInput.focus();
    };

    searchResults.onclick = (e) => {
      const item = (e.target as HTMLElement).closest('.search-item') as HTMLElement | null;
      if (!item || !item.dataset['nodeId']) return;
      selectSearchMatch(item.dataset['nodeId']);
    };

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target as Node) && !searchResults.contains(e.target as Node)) {
        if (lastQuery.length > 0) hideSearchResults();
      }
    });
  }

  store.subscribe(sync);
  sync();

  return {
    update(d: PanelData): void {
      // Don't clobber a date the user is actively typing: the readout refreshes
      // ~10x/second and would otherwise rewrite the field mid-typing.
      if (document.activeElement !== dateIn) {
        dateIn.value = d.dateUtc ? d.dateUtc.slice(0, 10) : '';
      }

      const gr = d.galaxyReadout;
      const curGalModel = ctx.galaxyModels.find((m) => m.id === (store.get().galaxyModelId ?? 'iau1985'));
      const galModelImplementation =
        curGalModel?.implementation === 'modelPotential'
          ? 'model potential implemented'
          : 'LSR/R0 preset only';
      const galHeader = gr
        ? [
            `Galactic Model:    ${curGalModel?.label ?? 'IAU 1985'} (${curGalModel?.source.split('(')[0]?.trim()}; ${galModelImplementation})`,
            `Galactic Position: R=${gr.rKpc.toFixed(2)} kpc | z=${gr.zPc >= 0 ? '+' : ''}${gr.zPc.toFixed(0)} pc`,
            `Galactic Velocity: ${gr.speedKms.toFixed(1)} km/s (Azimuthal ${gr.vAzimuthalKms.toFixed(1)} km/s)`,
            `Sun Midplane:      in ${gr.timeToNextMidplaneMyr.toFixed(1)} Myr (${gr.vertPhase.toUpperCase()})`,
            '------------------------------------------------',
          ]
        : [];

      const jdTdb = d.jd ?? (Date.parse(d.dateUtc) / (DAY_S * 1000) + 2440587.5);
      const jdUtc = tdbToUtc(jdTdb);
      const ttOffsetS = (utcToTt(jdUtc) - jdUtc) * DAY_S;
      const tdbOffsetS = (jdTdb - jdUtc) * DAY_S;
      const leapSec = getLeapSeconds(jdUtc);

      const lines: string[] = [
        `Date (UTC)     ${d.dateUtc}`,
        `Terrestrial TT +${ttOffsetS.toFixed(3)}s (${leapSec} leap-s, TT-TAI 32.184s)`,
        `Barycentric TDB+${tdbOffsetS.toFixed(3)}s (relativistic Fairhead-Bretagnon)`,
        `Julian Date    ${jdTdb.toFixed(6)} (TDB)`,
        `Sun-SSB dist   ${(d.sunBaryAu * AU_KM).toLocaleString('en-US', { maximumFractionDigits: 0 })} km (${((d.sunBaryAu * AU_KM) / ctx.sunRadiusKm).toFixed(2)} R_sun)`,
        `Sun speed      ${d.sunSpeedKms.toFixed(3)} km/s`,
        `|ΔE/E|         ${d.energyDrift.toExponential(2)}`,
        `|ΔL/L|         ${d.angMomDrift.toExponential(2)}`,
        d.comDriftAu == null
          ? ''
          : `|ΔCM|          ${d.comDriftAu.toExponential(2)} AU`,
        d.invariantOk == null
          ? ''
          : `Integrity      ${d.invariantOk ? 'OK' : `VIOLATION: ${(d.invariantViolations ?? []).join(', ')}`}`,
        d.moduleHealth ? `Health         ${formatModuleHealth(d.moduleHealth)}` : '',
        `Render         ${d.fps.toFixed(0)} FPS (${(1000 / Math.max(1, d.fps)).toFixed(1)} ms) · quality Q${d.quality}`,
        d.busy ? 'SIMULATION BUSY' : '',
        d.workerFault ? 'WORKER FAULT — reload the page (sim parked safely)' : '',
        ...galHeader,
        '',
        'Body         Dist(AU)   Dist(km)      Speed(km/s)',
        '------------------------------------------------',
        ...d.rows.map(
          (r) =>
            `${r.name.padEnd(12)} ${r.rAu.toFixed(4).padStart(9)} ${(r.rAu * AU_KM).toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(13)} ${r.vKms.toFixed(2).padStart(11)}`,
        ),
      ];
      out.textContent = lines.filter(Boolean).join('\n');

      // Sync camera zoom slider with live distance (unless user is actively dragging the slider)
      if (!isZoomDragging && d.cameraDistanceAu != null && d.cameraDistanceAu > 0 && cameraZoomIn && zoomLabel) {
        const logVal = Math.log10(d.cameraDistanceAu);
        cameraZoomIn.value = String(Math.max(-6.0, Math.min(5.0, logVal)));
        zoomLabel.textContent = formatZoomDistance(d.cameraDistanceAu);
      }

      // Selection facts card
      if (d.selectedFacts) {
        const sf = d.selectedFacts;
        let telecomHtml = '';
        if (ctx.getBodyState && sf.id !== 'earth') {
          const eState = ctx.getBodyState('earth');
          const sState = ctx.getBodyState('sun');
          const bState = ctx.getBodyState(sf.id);
          if (eState && bState) {
            const GM_SUN_AU = gmToInternal(GM_SUN_KM3_S2);
            const lb = computeLinkBudget(
              bState.pos,
              eState.pos,
              sState?.pos ?? [0, 0, 0],
              { txPowerWatts: 20, antennaDiameterM: 1.5, antennaEfficiency: 0.6 }
            );
            const cd = computeClockDriftRate(
              bState.pos,
              bState.vel,
              [GM_SUN_AU],
              [sState?.pos ?? [0, 0, 0]]
            );
            telecomHtml = `
              <div style="margin-top:8px;background:rgba(15,23,42,0.85);border:1px solid rgba(56,189,248,0.3);border-radius:4px;padding:6px;font-size:0.92em;line-height:1.4;">
                <div style="color:#7dd3fc;font-weight:600;margin-bottom:3px;display:flex;justify-content:space-between;">
                  <span>📡 DSN Link & Relativistic Metrology</span>
                  <span style="font-size:0.85em;color:${lb.isSolarConjunction ? '#f87171' : '#6ee7b7'};">${lb.isSolarConjunction ? '⚠️ Conjunction Blackout' : '✓ Clear Link'}</span>
                </div>
                <div><strong>Range to Earth:</strong> ${lb.distanceKm.toLocaleString('en-US', { maximumFractionDigits: 0 })} km (${lb.distanceAu.toFixed(4)} AU)</div>
                <div><strong>Light Travel Time:</strong> OWLT ${(lb.owltSeconds / 60).toFixed(1)} min | RTLT ${(lb.rtltSeconds / 60).toFixed(1)} min</div>
                <div><strong>Free-Space Path Loss:</strong> ${lb.fsplDb.toFixed(1)} dB (X-band 8.4 GHz)</div>
                <div><strong>Sun-Earth-Probe Angle:</strong> ${lb.sepAngleDeg.toFixed(1)}°</div>
                <div><strong>Relativistic Clock Drift:</strong> ${cd.driftMicrosPerDay > 0 ? '+' : ''}${cd.driftMicrosPerDay.toFixed(2)} µs/day</div>
              </div>
            `;
          }
        }

        factsBox.style.display = 'block';
        factsTitle.textContent = sf.name;
        factsContent.innerHTML = `
          <div style="font-size:0.85em;line-height:1.45;margin-top:6px;">
            <div style="background:rgba(56,189,248,0.1);border-left:3px solid #38bdf8;padding:4px 8px;border-radius:4px;margin-bottom:8px;">
              <div><strong>Equatorial Radius:</strong> ${sf.radiusKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km</div>
              ${sf.flattening > 0.0001 ? `<div><strong>Polar Radius:</strong> ${sf.polarRadiusKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km (oblateness ${(sf.flattening * 100).toFixed(2)}%)</div>` : ''}
              <div><strong>Volumetric Mean Radius:</strong> ${sf.volumetricRadiusKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km</div>
            </div>
            ${
              sf.id === 'sun'
                ? `
                <div><strong>Dist to SSB (Empty Point):</strong> ${sf.distSunAu.toFixed(6)} AU (${(sf.distSunAu * AU_KM).toLocaleString('en-US', { maximumFractionDigits: 0 })} km)</div>
                <div><strong>Barycentric Wobble Speed:</strong> ${(sf.speedKms * 1000).toFixed(1)} m/s (${sf.speedKms.toFixed(3)} km/s)</div>
                <div><strong>Axial Obliquity:</strong> 7.25° to ecliptic (RA 286.13°, Dec 63.87°)</div>
                <div><strong>Carrington Sidereal Period:</strong> 25.38 days (14.1844°/day)</div>
                <div style="margin-top:6px;border-top:1px dashed rgba(255,255,255,0.15);padding-top:6px;">
                  ${Object.entries(sf.facts)
                    .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
                    .join('')}
                </div>
              `
                : sf.isMoon && sf.parentName && sf.distParentKm !== undefined
                ? `
                <div style="color:#67e8f9;font-weight:600;margin-bottom:3px;">🌙 Orbiting Host: ${sf.parentName}</div>
                <div><strong>Distance to ${sf.parentName}:</strong> ${sf.distParentKm.toLocaleString('en-US', { maximumFractionDigits: 0 })} km (${sf.distParentAu?.toFixed(6)} AU)</div>
                <div><strong>Orbital Speed around ${sf.parentName}:</strong> ${sf.speedRelParentKms?.toFixed(2)} km/s</div>
                <div><strong>Orbital Period:</strong> ${Number.isFinite(sf.elements.period) ? (sf.elements.period < 1 ? `${(sf.elements.period * 24).toFixed(1)} hours` : `${sf.elements.period.toFixed(2)} days`) : 'N/A'}</div>
                <div><strong>Semi-Major Axis:</strong> ${Number.isFinite(sf.elements.a) && sf.elements.a > 0 ? `${(sf.elements.a * AU_KM).toLocaleString('en-US', { maximumFractionDigits: 0 })} km` : 'N/A'}</div>
                <div><strong>Eccentricity:</strong> ${Number.isFinite(sf.elements.e) ? sf.elements.e.toFixed(4) : 'N/A'}</div>
                <div><strong>Tidal Locking:</strong> Synchronous (${Math.abs(sf.siderealDayDays) < 1 ? `${(Math.abs(sf.siderealDayDays) * 24).toFixed(1)}h` : `${sf.siderealDayDays.toFixed(2)}d`})</div>
                <div><strong>Axial Obliquity:</strong> ${sf.axialTiltDeg.toFixed(2)}°</div>
                <div><strong>Dist to Sun:</strong> ${sf.distSunAu.toFixed(3)} AU (${sf.lightMinutes.toFixed(1)} light-min)</div>
                <div style="margin-top:4px;border-top:1px dashed rgba(255,255,255,0.15);padding-top:4px;">
                  ${Object.entries(sf.facts)
                    .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
                    .join('')}
                </div>
              `
                : `
                <div><strong>Dist to Sun:</strong> ${sf.distSunAu.toFixed(4)} AU (${(sf.distSunAu * AU_KM).toLocaleString('en-US', { maximumFractionDigits: 0 })} km)</div>
                <div><strong>Light Travel:</strong> ${sf.lightMinutes.toFixed(2)} light-min</div>
                <div><strong>Orbital Speed:</strong> ${sf.speedKms.toFixed(2)} km/s</div>
                <div><strong>Semi-major axis:</strong> ${sf.elements.a.toFixed(4)} AU</div>
                <div><strong>Eccentricity:</strong> ${sf.elements.e.toFixed(4)}</div>
                <div><strong>Orbital Period:</strong> ${sf.elements.period >= 365.25 ? `${(sf.elements.period / 365.25).toFixed(2)} yr` : `${sf.elements.period.toFixed(2)} days`}</div>
                <div><strong>Axial Tilt:</strong> ${sf.axialTiltDeg.toFixed(2)}°</div>
                <div><strong>Sidereal Day:</strong> ${Math.abs(sf.siderealDayDays) < 1 ? `${(Math.abs(sf.siderealDayDays) * 24).toFixed(1)} hours` : `${sf.siderealDayDays.toFixed(2)} days`}</div>
                <div><strong>Subsolar Point:</strong> ${sf.subsolarLatDeg.toFixed(1)}° lat, ${sf.subsolarLonDeg.toFixed(1)}° lon</div>
                <div style="margin-top:4px;border-top:1px dashed rgba(255,255,255,0.15);padding-top:4px;">
                  ${Object.entries(sf.facts)
                    .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
                    .join('')}
                </div>
              `
            }
            ${telecomHtml}
          </div>
        `;
      } else {
        factsBox.style.display = 'none';
      }
    },
  };
}

function fill(sel: HTMLSelectElement, opts: Option[]) {
  sel.innerHTML = opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');
}

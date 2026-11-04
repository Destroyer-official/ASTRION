import * as THREE from 'three';
import './style.css';
import { dateToJd, jdToDate, auDayToKms, AU_KM } from '@/data/constants';
import { loadSystem, ALL_BODIES } from '@/sim/registry';
import { SimClient } from '@/sim/simClient';
import { GalaxySim } from '@/sim/galaxySim';
import { EphemerisProvider } from '@/sim/ephemeris';
import { createStore, type AppState } from '@/sim/store';
import { buildFrames } from '@/frames/registry';
import { transformState } from '@/frames/transform';
import { createViewer } from '@/render/viewer';
import { createPanel } from '@/ui/panel';
import { PRESETS } from '@/ui/presets';
import { relativeRows } from '@/sim/readout';
import { computeBodyFacts } from '@/sim/facts';
import { GALAXY_MODELS } from '@/data/galaxy';
import { horizonsClient } from '@/sim/horizonsClient';

const HISTORY_CAP = 20_000;
const MAX_JUMP_DAYS = 73_050;

// Load all 36 celestial "science" bodies: Sun, 8 planets, Pluto, 22 moons + 4 asteroids
const model = loadSystem(ALL_BODIES);
const ephemeris = new EphemerisProvider(model);
const validationTable = ephemeris.getValidationTable();

const sun = model.ids.indexOf('sun');

const getLsrKms = (id: string) => GALAXY_MODELS.find((m) => m.id === id)?.lsrKms ?? 220;

let frames = buildFrames(model.ids, model.names, getLsrKms('iau1985'));
let frameById = new Map(frames.map((f) => [f.id, f]));

// Filter presets against the loaded system
const validPresets: Record<string, (typeof PRESETS)[string]> = {};
for (const [id, p] of Object.entries(PRESETS)) {
  if (frameById.has(p.frame) && (p.focus === 'barycenter' || p.focus === 'sgra' || model.ids.includes(p.focus))) {
    validPresets[id] = p;
  }
}

const client = new SimClient(model, {
  maxDt: 0.5,
  // Per-message step budget: bounds one worker hop to <= 200 d (~1000 steps),
  // so long seeks stream with progress instead of freezing the worker.
  // Continuous flow is chunked smaller still (chunkDays) in SimClient.
  maxSteps: 1000,
  historyCap: HISTORY_CAP,
  historyIntervalDays: 2,
  integrator: 'yoshida4',
  relativity: true,
  quadrupole: true,
  fixedDt: 0.2,
});

const galaxySim = new GalaxySim();

const store = createStore<AppState>({
  mode: 'solar',
  showMilkyWay: true,
  showOortCloud: false,
  showGalacticHalo: true,
  showLabels: true,
  showOrbitPaths: true,
  dynamicsMode: 'simulation',
  galaxyModelId: 'iau1985',
  showRealityInspector: false,
  showValidationTable: false,
  playing: true,
  reversed: false,
  speed: 15,
  galaxySpeed: 2.0,
  galaxyZExag: 1.0,
  galaxyCamera: 'perspective',
  preset: 'cosmic',
  trails: true,
  frame: 'body:sun',
  focus: 'sun',
  trailDays: 4383,
  scaleMode: 'pixels',
  scaleExaggeration: 20,
  selected: 'earth',
  compress: 1,
});

let isApplyingPreset = false;
let travelToken = 0;

const BODY_VISIT_PRESET_MAP: Record<string, string> = {
  mercury: 'visitMercury',
  venus: 'visitVenus',
  earth: 'visitEarth',
  mars: 'visitMars',
  jupiter: 'visitJupiter',
  saturn: 'visitSaturn',
  uranus: 'visitUranus',
  neptune: 'visitNeptune',
  pluto: 'visitPluto',
  ceres: 'visitCeres',
  vesta: 'visitVesta',
  pallas: 'visitPallas',
  hygiea: 'visitHygiea',
  moon: 'visitMoon',
  io: 'visitIo',
  europa: 'visitEuropa',
  ganymede: 'visitGanymede',
  titan: 'visitTitan',
  enceladus: 'visitEnceladus',
  triton: 'visitTriton',
  charon: 'visitCharon',
};

function getOptimalBodyView(id: string): { dist: number; dir: readonly [number, number, number] } {
  if (id === 'sgra') {
    return { dist: 350, dir: [-0.95, -0.2, 0.25] };
  }
  if (id === 'sun') {
    return { dist: 0.038, dir: [0, -0.85, 0.52] };
  }
  if (PRESETS[id]) {
    return { dist: PRESETS[id]!.dist, dir: PRESETS[id]!.dir };
  }
  const presetKey = BODY_VISIT_PRESET_MAP[id];
  if (presetKey && PRESETS[presetKey]) {
    const p = PRESETS[presetKey]!;
    return { dist: p.dist, dir: p.dir };
  }
  const i = model.ids.indexOf(id);
  const rKm = i >= 0 ? model.radiusKm[i]! : 1000;
  const rAu = rKm / AU_KM;
  // Frame comfortably at ~8x radius, minimum 2.5e-6 AU to stay well clear of near-plane and ensure crisp visibility
  const dist = Math.max(rAu * 8, 2.5e-6);
  return { dist, dir: [0.12, -0.78, 0.48] };
}

function selectBody(id: string): void {
  if (!id) return;
  store.set('selected', id);
  if (id !== 'sgra') {
    store.set('scaleMode', 'true');
  }

  const isGal = id === 'sgra';
  const view = getOptimalBodyView(id);
  const token = ++travelToken;
  isApplyingPreset = true;

  viewer.cancelFlight();

  // Safety fallback: if flight gets cancelled by user drag or wheel, ensure isApplyingPreset resets
  setTimeout(() => {
    if (token === travelToken && isApplyingPreset) {
      isApplyingPreset = false;
    }
  }, 2000);

  if (isGal) {
    viewer.flyTo(() => viewer.sgrAWorldPosition(), view.dist, {
      dir: view.dir,
      pinTargetOnDone: true,
      onDone: () => {
        if (token !== travelToken) return;
        store.set('preset', 'sgra');
        store.set('frame', 'galactic-aligned');
        store.set('focus', 'sgra');
        isApplyingPreset = false;
      },
    });
    return;
  }

  const curPreset = store.get().preset;
  const isFromGalaxy = curPreset === 'milkyWay' || curPreset === 'sgra' || curPreset === 'sunGalaxy';
  if (isFromGalaxy) {
    const fallbackPreset = id === 'sun' ? 'inner' : (PRESETS[id] ? id : 'inner');
    store.set('preset', fallbackPreset);
  }

  viewer.flyToFocus(id, view.dist, {
    dir: view.dir,
    pinTargetOnDone: true,
    onDone: () => {
      if (token !== travelToken) return;
      // In authentic NASA solar system visualization, frame stays heliocentric (body:sun) or barycentric.
      // Do not change frame to non-inertial body:id which converts planetary orbits into 2D retrograde loops!
      store.set('focus', id);
      const canonicalPreset = PRESETS[id] ? id : (BODY_VISIT_PRESET_MAP[id] ?? 'inner');
      store.set('preset', canonicalPreset);
      isApplyingPreset = false;
    },
  });
}

const viewer = createViewer(document.getElementById('app')!, model, HISTORY_CAP, {
  // Click a sun, planet, moon or label: glide the camera to it, then focus it.
  onSelect: (id, isZoom) => {
    if (!id) return;
    if (isZoom) {
      store.set('selected', id);
    } else {
      selectBody(id);
    }
  },
  onZoomTargetReached: (id) => {
    if (!id) return;
    store.set('selected', id);
    store.set('focus', id);
    const canonicalPreset = PRESETS[id] ? id : (BODY_VISIT_PRESET_MAP[id] ?? store.get().preset);
    store.set('preset', canonicalPreset);
    isApplyingPreset = false;
  },
});
(window as any).__viewer = viewer;
(window as any).__galaxySim = galaxySim;
(window as any).__store = store;

// Precompute full 500 Myr galactic orbit path and supply to viewer (0.1 Myr step, symmetrical past & future for live wake)
viewer.setGalaxyOrbitPath(galaxySim.generateOrbitPath(500, 0.1, 0.5));
// Live rotation curve: disk stars orbit at the Vc(R) the Sun itself feels,
// so the whole galaxy co-moves differentially instead of spinning rigidly.
const syncRotationCurve = () => viewer.setGalaxyRotationCurve((r) => galaxySim.pot.circularSpeedKms(r));
syncRotationCurve();

const focusIndex = (id: string) => (id === 'barycenter' || id === 'sgra' ? -1 : model.ids.indexOf(id));

function viewPreset(id: string): void {
  const p = validPresets[id] ?? PRESETS[id]!;
  const targetFrame = frameById.get(p.frame);
  if (id === 'milkyWay') {
    viewer.setGalaxyView('overview', targetFrame, galaxySim.getState(), store.get().galaxyZExag);
  } else if (id === 'sgra') {
    viewer.setGalaxyView('sgra', targetFrame, galaxySim.getState(), store.get().galaxyZExag);
  } else if (id === 'sunGalaxy') {
    viewer.setGalaxyView('sun-orion', targetFrame, galaxySim.getState(), store.get().galaxyZExag);
  } else if (p.galactocentric) {
    // Voyage camera: locked to Sgr A* so the Sun visibly travels (never a follow-sun dashcam).
    viewer.setGalactoView(p.dir, p.dist);
  } else {
    viewer.setView(p.dir, p.dist);
  }
  store.set('trailDays', p.trailDays);
}


function applyPreset(id: string): void {
  const p = validPresets[id] ?? PRESETS[id];
  if (!p) {
    isApplyingPreset = false;
    return;
  }
  const token = ++travelToken;
  viewer.cancelFlight();
  isApplyingPreset = true;
  // Non-spatial state applies immediately (rendering aids, not coordinates).
  store.set('trailDays', p.trailDays);
  store.set('compress', p.compress ?? 1);
  if (id === 'oort') {
    store.set('showOortCloud', true);
  }
  if (p.focus !== 'barycenter' && p.focus !== 'sgra') {
    store.set('selected', p.focus);
  } else if (id === 'sunUnified' || id === 'wobble') {
    store.set('selected', 'sun');
  }
  if (id === 'sunUnified' || id === 'wobble' || p.category === 'planets' || p.category === 'moons') {
    store.set('scaleMode', 'true');
  }

  const swapSpatial = () => {
    if (token !== travelToken) return;
    store.set('preset', id);
    store.set('frame', p.frame);
    store.set('focus', p.focus);
    isApplyingPreset = false;
  };

  if (id === 'milkyWay' || id === 'sgra' || id === 'sunGalaxy') {
    // Whole-sky reframes rotate the world: swap now (reads as an intentional
    // warp), then glide the camera through the new layout chasing its anchor.
    swapSpatial();
    const targetFrame = frameById.get(p.frame);
    const viewType = id === 'milkyWay' ? 'overview' : id === 'sgra' ? 'sgra' : 'sun-orion';
    const chase =
      id === 'sunGalaxy'
        ? () => {
            viewer.flyToFocus('sun', p.dist, {
              dir: p.dir,
              onDone: () =>
                viewer.setGalaxyView(viewType, targetFrame, galaxySim.getState(), store.get().galaxyZExag),
            });
          }
        : () => {
            viewer.flyTo(() => viewer.sgrAWorldPosition(), p.dist, {
              dir: p.dir,
              onDone: () =>
                viewer.setGalaxyView(viewType, targetFrame, galaxySim.getState(), store.get().galaxyZExag),
            });
          };
    chase();
    return;
  }

  // Body presets: fly to the focus in CURRENT coordinates (tracking it), swap
  // the coordinate origin at arrival, pin the camera rigidly so the tracked
  // body never pops. Seamless by construction.
  const focusIdx = focusIndex(p.focus);
  if (focusIdx >= 0) {
    viewer.flyToFocus(p.focus, p.dist, {
      dir: p.dir,
      pinTargetOnDone: !p.galactocentric,
      onDone: () => swapSpatial(),
    });
  } else {
    viewer.flyTo(() => new THREE.Vector3(0, 0, 0), p.dist, {
      dir: p.dir,
      pinTargetOnDone: !p.galactocentric,
      onDone: () => swapSpatial(),
    });
  }
}

function applyFrameDefaults(id: string): void {
  if (id.startsWith('galactic') || id.startsWith('cmb')) {
    store.set('focus', 'sun');
    store.set('trailDays', 730.5);
    store.set('compress', 0.05);
    viewer.setView([1, 0, 0.3], 120);
  } else {
    store.set('focus', id.startsWith('body:') ? id.slice(5) : 'barycenter');
    store.set('compress', 1);
    viewPreset(store.get().preset);
  }
}

const travelPos = new Float64Array(model.state.n * 3);
const travelVel = new Float64Array(model.state.n * 3);

const seekToJd = async (jd: number) => {
  travelToken++;
  viewer.cancelFlight();
  const days = Math.max(-MAX_JUMP_DAYS, Math.min(MAX_JUMP_DAYS, jd - model.epochJd));
  if (store.get().dynamicsMode === 'ephemeris') {
    // Ephemeris mode: jump display directly and evaluate exact analytical position & velocity
    client.display.t = days;
    ephemeris.interpolate(days, client.display.pos, client.display.vel);
  } else {
    // Instant exact travel: seed the live N-body state from local high-precision
    // DE440 cubic Hermite ephemeris if within the 60-year window (0 ms, 100% offline-safe),
    // or live JPL Horizons API if outside the local table.
    const win = ephemeris.window();
    const isWithinWindow = days >= win.min && days <= win.max;

    const ok = await client.travelTo(days, async (d) => {
      // 1. Within local DE440 window: instant analytical interpolation (no network overhead)
      if (isWithinWindow) {
        ephemeris.interpolate(d, travelPos, travelVel);
        return { pos: travelPos, vel: travelVel };
      }
      // 2. Beyond local window: query live JPL Horizons API if online
      if (!horizonsClient.isOffline()) {
        const vecs = await horizonsClient.fetchSystem(model.ids, jdToDate(model.epochJd + d));
        if (model.ids.every((id) => !!vecs[id])) {
          model.ids.forEach((id, i) => {
            const v = vecs[id]!;
            travelPos[3 * i] = v.positionAu[0];
            travelPos[3 * i + 1] = v.positionAu[1];
            travelPos[3 * i + 2] = v.positionAu[2];
            travelVel[3 * i] = v.velocityAuDay[0];
            travelVel[3 * i + 1] = v.velocityAuDay[1];
            travelVel[3 * i + 2] = v.velocityAuDay[2];
          });
          return { pos: travelPos, vel: travelVel };
        }
      }
      return null;
    });
    if (!ok) client.seek(days);
  }
  client.history.clear();
};

const panel = createPanel(document.getElementById('panel')!, store, {
  sunRadiusKm: model.radiusKm[sun]!,
  frames: frames.map((f) => ({ id: f.id, label: f.label })),
  focuses: [
    { id: 'barycenter', label: 'Solar System Barycenter' },
    ...model.ids.map((id, i) => ({ id, label: model.names[i]! })),
    { id: 'sgra', label: 'Sagittarius A* (Galactic Center)' },
  ],
  presets: Object.entries(validPresets)
    .filter(([_, p]) => !p.hidden)
    .map(([id, p]) => ({
      id,
      label: p.label,
      category: p.category ?? 'solar',
    })),
  galaxyModels: GALAXY_MODELS,
  validationTable,
  onReset: () => {
    travelToken++;
    viewer.cancelFlight();
    client.reset(); // clears history via bump()
    // In ephemeris mode the worker reset alone leaves the date untouched,
    // so Reset looked dead: rewind the display to the epoch as well.
    if (store.get().dynamicsMode === 'ephemeris') {
      client.display.t = 0;
      ephemeris.interpolate(0, client.display.pos, client.display.vel);
    }
  },
  onSeekDate: (d) => seekToJd(dateToJd(d)),
  onNow: () => seekToJd(dateToJd(new Date())),
  onReseedHorizons: async () => {
    const r = await ephemeris.reseedLive(client.display.t, client.display);
    // Reseed teleports bodies to truth vectors: old trail points belong to a
    // different arc and must go, or they draw cross-screen streaks.
    client.history.clear();
    return r;
  },
  onOpenEyes: () => {
    const curDate = jdToDate(model.epochJd + client.display.t);
    const target = store.get().selected || 'home';
    const eyesUrl = horizonsClient.getEyesUrl(curDate, target);
    window.open(eyesUrl, '_blank');
  },
  onGalaxyReset: () => galaxySim.reset(),
  onGalaxyCamera: (cam) =>
    viewer.setGalaxyView(cam, frameById.get(store.get().frame), galaxySim.getState(), store.get().galaxyZExag),
  onGalaxyModelChange: (modelId) => {
    const galModel = GALAXY_MODELS.find((m) => m.id === modelId);
    const lsr = galModel?.lsrKms ?? 220;
    const r0 = galModel?.r0Kpc ?? 8.2;
    galaxySim.setLsrSpeed(lsr, r0);
    viewer.setGalaxyOrbitPath(galaxySim.generateOrbitPath(500, 0.1, 0.5));
    syncRotationCurve();
    frames = buildFrames(model.ids, model.names, lsr);
    frameById = new Map(frames.map((f) => [f.id, f]));
  },
  onPhysicsChange: (opts) => client.setPhysics(opts),
  onZoomChange: (distAu) => viewer.setCameraDistance(distAu),
  getBodyState: (id: string) => {
    const idx = model.ids.indexOf(id);
    if (idx < 0) return null;
    return {
      pos: [client.display.pos[3 * idx]!, client.display.pos[3 * idx + 1]!, client.display.pos[3 * idx + 2]!] as [number, number, number],
      vel: [client.display.vel[3 * idx]!, client.display.vel[3 * idx + 1]!, client.display.vel[3 * idx + 2]!] as [number, number, number],
    };
  },
});

store.subscribe((s, changed) => {
  if (changed === 'preset' && !isApplyingPreset) applyPreset(s.preset);
  if (changed === 'reversed') client.newDirection();
  if (changed === 'frame' && !isApplyingPreset) applyFrameDefaults(s.frame);
  if (changed === 'focus') {
    const fIdx = focusIndex(s.focus);
    if (fIdx >= 0) {
      store.set('selected', s.focus);
    }
    if (!isApplyingPreset && (fIdx >= 0 || s.focus === 'sgra')) {
      selectBody(s.focus);
    }
  }
  if (changed === 'dynamicsMode' && s.dynamicsMode === 'ephemeris') {
    ephemeris.interpolate(client.display.t, client.display.pos, client.display.vel);
  }
  if (changed === 'dynamicsMode') {
    // Sim-drifted and ephemeris-truth positions differ: never connect them.
    client.history.clear();
    if (s.dynamicsMode === 'simulation') {
      // Re-sync the idle worker to the visible time, or the display snaps back
      // to wherever the worker was left when the mode last changed.
      client.seek(client.display.t);
    }
  }
});

applyPreset('cosmic');

// Preallocated coordinate scratch arrays
const P = new Float64Array(3 * model.state.n),
  V = new Float64Array(3 * model.state.n);
function sunSpeedKms(frameId: string): number {
  transformState(frameById.get(frameId)!, client.display, P, V);
  return auDayToKms(Math.hypot(V[3 * sun]!, V[3 * sun + 1]!, V[3 * sun + 2]!));
}

let last = performance.now();
let frameNo = 0;
// Adaptive quality: rolling frame-rate estimate drives viewer.setQuality so
// weak machines stay smooth (downgrade fast, upgrade slowly, grace at boot).
let fpsEma = 60;
let qualityLevel = 0;
let qualityTimer = 0;
let qualityUpStreak = 0;
const bootTime = performance.now();
function tick(now: number) {
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;
  const s = store.get();

  if (dtReal > 0) fpsEma += (1 / dtReal - fpsEma) * 0.05;
  qualityTimer += dtReal;
  if (qualityTimer > 2 && now - bootTime > 8000) {
    qualityTimer = 0;
    if (fpsEma < 40 && qualityLevel < 2) {
      qualityLevel++;
      viewer.setQuality(qualityLevel);
      qualityUpStreak = 0;
    } else if (fpsEma > 57 && qualityLevel > 0) {
      if (++qualityUpStreak >= 3) {
        qualityLevel--;
        viewer.setQuality(qualityLevel);
        qualityUpStreak = 0;
      }
    } else {
      qualityUpStreak = 0;
    }
  }

  // Step both galactic motion and planetary & moon dynamics simultaneously
  if (s.playing) {
    galaxySim.step(s.galaxySpeed * dtReal * (s.reversed ? -1 : 1));
  }

  if (s.dynamicsMode === 'ephemeris') {
    if (s.playing) {
      client.display.t += s.speed * dtReal * (s.reversed ? -1 : 1);
      // The anchor table ends: clamp the date instead of freezing the planets
      // while the readout keeps advancing (silent clamp = wrong date on screen).
      const w = ephemeris.window();
      client.display.t = Math.max(w.min, Math.min(w.max, client.display.t));
    }
    ephemeris.interpolate(client.display.t, client.display.pos, client.display.vel);
    // Trails need a live history in ephemeris mode too (the worker is idle here).
    if (s.playing) {
      client.history.sample(client.display);
    }
  } else {
    if (s.playing) client.request(s.speed * dtReal * (s.reversed ? -1 : 1));
    client.updateDisplay();
  }

  const curPreset = validPresets[s.preset] ?? PRESETS[s.preset];
  viewer.render(client.display, {
    mode: s.mode,
    preset: s.preset,
    presetCategory: curPreset?.category ?? 'solar',
    showMilkyWay: s.showMilkyWay,
    showOortCloud: s.showOortCloud,
    showGalacticHalo: s.showGalacticHalo,
    showLabels: s.showLabels,
    showOrbitPaths: s.showOrbitPaths !== false,
    galaxyState: galaxySim.getState(),
    galaxyCamera: s.galaxyCamera,
    galaxyZExag: s.galaxyZExag,
    frame: frameById.get(s.frame)!,
    focus: focusIndex(s.focus),
    trails: s.trails,
    trailDays: s.trailDays,
    history: client.history,
    scaleMode: s.scaleMode,
    scaleExaggeration: s.scaleExaggeration,
    selected: s.selected,
    compress: s.compress,
    galactocentric: curPreset?.galactocentric ?? false,
    helioExag: curPreset?.helioExag ?? 2,
  });

  if (frameNo++ % 6 === 0) {
    const selectedFacts = s.selected ? computeBodyFacts(s.selected, client.display, model) : null;
    panel.update({
      dateUtc: jdToDate(model.epochJd + client.display.t).toISOString().slice(0, 19) + ' UTC',
      jd: model.epochJd + client.display.t,
      sunBaryAu: client.baryDist[sun]!,
      sunSpeedKms: sunSpeedKms(s.frame),
      energyDrift: s.dynamicsMode === 'ephemeris' ? 0 : client.energyDrift,
      angMomDrift: s.dynamicsMode === 'ephemeris' ? 0 : client.angMomDrift,
      rows: relativeRows(client.display, model.names, sun),
      busy: client.busy,
      workerFault: client.workerDead,
      fps: fpsEma,
      quality: qualityLevel,
      selectedFacts,
      galaxyReadout: galaxySim.computeReadout(),
      cameraDistanceAu: viewer.getCameraDistance(),
    });
  }
  requestAnimationFrame(tick);
}

if (typeof window !== 'undefined') {
  (window as any).__viewer = viewer;
  (window as any).__client = client;
  (window as any).__store = store;
  (window as any).__model = model;
}

requestAnimationFrame(tick);

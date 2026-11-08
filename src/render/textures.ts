import * as THREE from 'three';

/** Procedural celestial texture generator for realistic planetary surfaces.
 * Fallback layer: used when a real map file is absent (offline / not fetched).
 * Deterministic — a seeded RNG means every load looks identical. */

/** Mulberry32: tiny seeded PRNG so procedural maps are stable across reloads. */
let _randState = 0x2f6e2b1;
function rand(): number {
  _randState |= 0;
  _randState = (_randState + 0x6d2b79f5) | 0;
  let t = Math.imul(_randState ^ (_randState >>> 15), 1 | _randState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Re-seed the procedural generator (tests / reproducibility). */
export function setTextureSeed(seed: number): void {
  _randState = seed | 0;
}

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (typeof document === 'undefined') {
    // Headless / SSR / Node mock for tests
    const dummyCtx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_target, prop) => {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => ({ addColorStop: () => {} });
        }
        return () => {};
      },
      set: () => true,
    });
    const dummyCanvas = { width, height, getContext: () => dummyCtx } as unknown as HTMLCanvasElement;
    return [dummyCanvas, dummyCtx];
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createSunTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);

  // 1. Photosphere base: mottled white-gold (SDO/HMI continuum look).
  // Deliberately flat: limb darkening is view-dependent and lives in the sun
  // shader, so it must NOT be baked into the map.
  ctx.fillStyle = '#f7b733';
  ctx.fillRect(0, 0, 1024, 512);

  // Supergranulation: very low alpha large warm/cool cells (~30 px).
  for (let i = 0; i < 260; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 28 + 12;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 225, 140, 0.10)' : 'rgba(200, 110, 20, 0.10)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Fine solar granulation: bright cells over dark lanes, two scales, dense.
  for (let i = 0; i < 9000; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 2.6 + 0.8;
    const roll = rand();
    ctx.fillStyle = roll > 0.55 ? '#ffeca8' : roll > 0.3 ? '#f79c1d' : '#b34a08';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Helper: coronal loop arcade between two footpoints (bright thin arcs).
  function drawLoopArcade(x1: number, y1: number, x2: number, y2: number, n: number) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const mx = x1 + (x2 - x1) * t;
      const my = y1 + (y2 - y1) * t;
      const apex = -((rand() * 26 + 14) * (0.6 + 0.4 * Math.sin(t * Math.PI)));
      ctx.strokeStyle = `rgba(255, 252, 230, ${0.35 + rand() * 0.3})`;
      ctx.lineWidth = rand() * 1.6 + 0.6;
      ctx.beginPath();
      ctx.moveTo(x1 + (mx - x1) * 0.15, y1 + (my - y1) * 0.15);
      ctx.quadraticCurveTo(mx, my + apex, x2 - (x2 - mx) * 0.15, y2 - (y2 - my) * 0.15);
      ctx.stroke();
    }
  }

  // Helper to draw realistic bipolar sunspot groups with umbra, penumbra, and bright faculae
  function drawSunspotGroup(cx: number, cy: number, scale: number) {
    // Bright magnetic faculae / plage surrounding the active region
    for (let i = 0; i < 28; i++) {
      const fx = cx + (rand() - 0.5) * 60 * scale;
      const fy = cy + (rand() - 0.5) * 30 * scale;
      const fr = (rand() * 8 + 4) * scale;
      ctx.fillStyle = 'rgba(255, 255, 200, 0.55)';
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Leader sunspot: larger with penumbra and dark umbra
    ctx.fillStyle = '#6b2e04'; // Penumbra
    ctx.beginPath();
    ctx.ellipse(cx, cy, 14 * scale, 10 * scale, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#140400'; // Deep dark Umbra
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7 * scale, 5 * scale, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Follower sunspot: displaced in longitude with opposite magnetic polarity
    const fx = cx + 24 * scale;
    const fy = cy + (rand() - 0.5) * 8 * scale;
    ctx.fillStyle = '#7a3406'; // Penumbra
    ctx.beginPath();
    ctx.ellipse(fx, fy, 9 * scale, 6.5 * scale, -0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#140400'; // Umbra
    ctx.beginPath();
    ctx.ellipse(fx, fy, 4.5 * scale, 3 * scale, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Coronal loops arching leader -> follower (SDO/AIA active-region look).
    drawLoopArcade(cx, cy, fx, fy, 9);

    // Satellite pore spots
    for (let i = 0; i < 4; i++) {
      const px = cx + (rand() - 0.5) * 45 * scale;
      const py = cy + (rand() - 0.5) * 20 * scale;
      ctx.fillStyle = '#220800';
      ctx.beginPath();
      ctx.arc(px, py, (rand() * 2 + 1.2) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Prominent active sunspot groups at typical solar activity latitudes (±15° to ±25°)
  // Latitude +18°: y ≈ 512 * (90 - 18)/180 = 205
  drawSunspotGroup(280, 205, 1.3);
  drawSunspotGroup(780, 215, 1.1);

  // Latitude -22°: y ≈ 512 * (90 - (-22))/180 = 318
  drawSunspotGroup(450, 318, 1.4);
  drawSunspotGroup(920, 310, 0.9);

  // Latitude +12°: y ≈ 512 * (90 - 12)/180 = 222
  drawSunspotGroup(120, 222, 1.0);

  // 5. Quiet-sun loop arcades scattered in the activity belts (faint).
  for (let i = 0; i < 26; i++) {
    const cx = rand() * 1024;
    const band = rand() > 0.5 ? 1 : -1;
    const cy = 256 + band * (rand() * 90 + 40);
    drawLoopArcade(cx - 20, cy + (rand() - 0.5) * 10, cx + 20, cy + (rand() - 0.5) * 10, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createMercuryTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#8c8882';
  ctx.fillRect(0, 0, 512, 256);

  // Basaltic maria & crater impacts
  for (let i = 0; i < 600; i++) {
    const x = rand() * 512;
    const y = rand() * 256;
    const r = rand() * 6 + 1;
    ctx.fillStyle = rand() > 0.5 ? '#68645e' : '#aba7a0';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createVenusTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#e8cf99');
  grad.addColorStop(0.3, '#edd8a8');
  grad.addColorStop(0.5, '#f5e4bd');
  grad.addColorStop(0.7, '#edd8a8');
  grad.addColorStop(1, '#e8cf99');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Sulfuric acid atmospheric circulation bands
  ctx.fillStyle = 'rgba(215, 185, 125, 0.25)';
  for (let y = 10; y < 250; y += 14) {
    ctx.fillRect(0, y, 512, 6);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createEarthTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);
  // Deep oceans
  ctx.fillStyle = '#10386e';
  ctx.fillRect(0, 0, 1024, 512);

  // Continents (Africa, Eurasia, Americas, Australia)
  ctx.fillStyle = '#2d5a27'; // Lush vegetation / green land
  // Eurasia / Africa block
  ctx.beginPath();
  ctx.ellipse(550, 200, 180, 100, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c49a45'; // Sahara / deserts
  ctx.beginPath();
  ctx.ellipse(520, 240, 90, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d5a27';
  ctx.beginPath();
  ctx.ellipse(540, 340, 70, 90, 0.2, 0, Math.PI * 2); // Africa south
  ctx.fill();
  // North & South America
  ctx.beginPath();
  ctx.ellipse(220, 180, 110, 80, -0.2, 0, Math.PI * 2);
  ctx.ellipse(280, 360, 75, 110, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Australia
  ctx.beginPath();
  ctx.ellipse(800, 380, 60, 45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Polar ice caps
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1024, 30); // Arctic
  ctx.fillRect(0, 480, 1024, 32); // Antarctica

  // Swirling white cloud layers
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let i = 0; i < 40; i++) {
    const cx = rand() * 1024;
    const cy = rand() * 380 + 60;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rand() * 80 + 30, rand() * 15 + 5, rand(), 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createMarsTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  // Red iron oxide deserts
  ctx.fillStyle = '#c15128';
  ctx.fillRect(0, 0, 512, 256);

  // Dark volcanic plains (Syrtis Major, Mare Tyrrhenum)
  ctx.fillStyle = '#6b2d18';
  ctx.beginPath();
  ctx.ellipse(280, 140, 80, 40, 0.3, 0, Math.PI * 2);
  ctx.ellipse(140, 160, 70, 30, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // White polar ice caps
  ctx.fillStyle = '#f8f0ea';
  ctx.beginPath();
  ctx.ellipse(256, 12, 60, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(256, 246, 50, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createJupiterTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);

  // Multi-banded zones and belts
  const bands = [
    { y: 0, h: 40, c: '#b59770' }, // Polar zone
    { y: 40, h: 35, c: '#7f5636' }, // North polar belt
    { y: 75, h: 45, c: '#cfba96' }, // North temperate zone
    { y: 120, h: 50, c: '#8a4b2a' }, // North temperate belt
    { y: 170, h: 45, c: '#e3cfab' }, // North tropical zone
    { y: 215, h: 55, c: '#9c4c23' }, // North equatorial belt
    { y: 270, h: 40, c: '#e5d1b3' }, // Equatorial zone
    { y: 310, h: 55, c: '#91461f' }, // South equatorial belt
    { y: 365, h: 45, c: '#dfcba4' }, // South tropical zone
    { y: 410, h: 40, c: '#7d492c' }, // South temperate belt
    { y: 450, h: 62, c: '#a88c67' }, // South polar zone
  ];
  for (const b of bands) {
    ctx.fillStyle = b.c;
    ctx.fillRect(0, b.y, 1024, b.h);
  }

  // Atmospheric turbulence & eddy swirls
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  for (let i = 0; i < 80; i++) {
    ctx.beginPath();
    ctx.ellipse(rand() * 1024, rand() * 512, rand() * 40 + 10, rand() * 4 + 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The Great Red Spot (in the South Tropical Zone)
  const spotX = 620, spotY = 345;
  ctx.fillStyle = '#bb3820';
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, 55, 32, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#db5530';
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, 35, 20, 0.05, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createSaturnTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  // Golden butterscotch atmospheric bands
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8f7b57');
  grad.addColorStop(0.2, '#c7ab77');
  grad.addColorStop(0.4, '#e5cd97');
  grad.addColorStop(0.5, '#eddcb1');
  grad.addColorStop(0.6, '#dfc488');
  grad.addColorStop(0.8, '#b89961');
  grad.addColorStop(1, '#826f4f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Subtle cloud stripes
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  for (let y = 30; y < 220; y += 12) {
    ctx.fillRect(0, y, 512, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createSaturnRingTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 1);
  // Concentric radial ring bands: C Ring, B Ring, Cassini Division, A Ring, Encke Gap
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0.0, 'rgba(0,0,0,0)'); // Inner space
  grad.addColorStop(0.12, 'rgba(120, 110, 95, 0.3)'); // C Ring (transparent)
  grad.addColorStop(0.28, 'rgba(215, 195, 155, 0.95)'); // B Ring (dense, bright)
  grad.addColorStop(0.58, 'rgba(205, 185, 145, 0.95)'); // B Ring outer
  grad.addColorStop(0.60, 'rgba(10, 10, 10, 0.05)'); // Cassini Division gap!
  grad.addColorStop(0.64, 'rgba(10, 10, 10, 0.05)'); // Cassini Division gap!
  grad.addColorStop(0.66, 'rgba(185, 170, 135, 0.85)'); // A Ring inner
  grad.addColorStop(0.86, 'rgba(175, 160, 125, 0.85)'); // A Ring middle
  grad.addColorStop(0.88, 'rgba(30, 30, 30, 0.1)'); // Encke Gap
  grad.addColorStop(0.92, 'rgba(165, 150, 120, 0.7)'); // A Ring outer
  grad.addColorStop(1.0, 'rgba(0,0,0,0)'); // Beyond A ring
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1);

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export function createUranusTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#78bcc8');
  grad.addColorStop(0.5, '#9ee5ef');
  grad.addColorStop(1, '#78bcc8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createNeptuneTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2d57b8');
  grad.addColorStop(0.4, '#4275e3');
  grad.addColorStop(0.6, '#3664d4');
  grad.addColorStop(1, '#254ba6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Great Dark Spot & methane storm clouds
  ctx.fillStyle = '#1c3882';
  ctx.beginPath();
  ctx.ellipse(320, 130, 45, 25, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.ellipse(310, 160, 40, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}


export function createMoonTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#8f8e8b';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#595754';
  const maria = [
    [160, 90, 60, 45],
    [230, 80, 45, 40],
    [250, 130, 40, 30],
    [290, 110, 35, 30],
    [320, 140, 25, 25],
  ];
  for (const [x, y, rx, ry] of maria) {
    ctx.beginPath();
    ctx.ellipse(x!, y!, rx!, ry!, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 400; i++) {
    const x = rand() * 512, y = rand() * 256, r = rand() * 4 + 1;
    ctx.fillStyle = rand() > 0.3 ? '#b0aeaa' : '#454340';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createIoTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#e5c43b';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = 'rgba(215, 140, 35, 0.4)';
  for (let i = 0; i < 150; i++) {
    ctx.beginPath();
    ctx.ellipse(rand() * 512, rand() * 256, rand() * 30 + 10, rand() * 15 + 5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 60; i++) {
    const x = rand() * 512, y = rand() * 256;
    ctx.fillStyle = '#c93414';
    ctx.beginPath();
    ctx.arc(x, y, rand() * 8 + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1510';
    ctx.beginPath();
    ctx.arc(x, y, rand() * 3 + 1, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createEuropaTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#eaf0f8';
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(165, 92, 59, 0.6)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.moveTo(rand() * 512, rand() * 256);
    ctx.bezierCurveTo(
      rand() * 512, rand() * 256,
      rand() * 512, rand() * 256,
      rand() * 512, rand() * 256
    );
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createGanymedeTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#655e56';
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(180, 195, 210, 0.5)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 35; i++) {
    ctx.beginPath();
    ctx.moveTo(rand() * 512, rand() * 256);
    ctx.lineTo(rand() * 512, rand() * 256);
    ctx.stroke();
  }

  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = '#e8f0fc';
    ctx.beginPath();
    ctx.arc(rand() * 512, rand() * 256, rand() * 3 + 1, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createCallistoTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#3f3a35';
  ctx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 500; i++) {
    const x = rand() * 512, y = rand() * 256, r = rand() * 3 + 1;
    ctx.fillStyle = rand() > 0.4 ? '#b8c4d0' : '#282420';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createTitanTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#bd6e22');
  grad.addColorStop(0.3, '#e08f32');
  grad.addColorStop(0.5, '#ea9d3e');
  grad.addColorStop(0.7, '#e08f32');
  grad.addColorStop(1, '#a85b1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = 'rgba(110, 60, 22, 0.35)';
  for (let y = 110; y < 155; y += 8) {
    ctx.fillRect(0, y, 512, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createPlutoTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#8f5235';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#3a1f14';
  ctx.fillRect(0, 120, 512, 50);

  ctx.fillStyle = '#f6ede0';
  ctx.beginPath();
  ctx.ellipse(230, 130, 45, 55, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(275, 138, 35, 45, -0.15, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createCharonTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#7c7a78';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#683624';
  ctx.beginPath();
  ctx.ellipse(256, 30, 90, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createEnceladusTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#f8faff';
  ctx.fillRect(0, 0, 512, 256);

  // South polar tiger stripe fissures (geysers)
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(120 + i * 70, 200);
    ctx.bezierCurveTo(150 + i * 70, 225, 180 + i * 70, 235, 210 + i * 70, 245);
    ctx.stroke();
  }
  // Subtle crater field in north
  ctx.fillStyle = '#e2e8f0';
  for (let i = 0; i < 150; i++) {
    const x = rand() * 512, y = rand() * 120, r = rand() * 3 + 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createMimasTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#b0b4b8';
  ctx.fillRect(0, 0, 512, 256);

  // Giant Herschel crater (130 km across)
  ctx.fillStyle = '#64748b';
  ctx.beginPath();
  ctx.arc(220, 128, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(220, 128, 14, 0, Math.PI * 2); // central peak
  ctx.fill();

  // Dense crater impact background
  for (let i = 0; i < 350; i++) {
    const x = rand() * 512, y = rand() * 256, r = rand() * 4 + 1;
    ctx.fillStyle = rand() > 0.5 ? '#7f8c9b' : '#c8ced6';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createIapetusTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  // Two-tone world: bright trailing hemisphere, pitch-dark leading hemisphere (Cassini Regio)
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#1e140d'; // pitch coal-dark organic residue
  ctx.beginPath();
  ctx.ellipse(256, 128, 140, 110, 0, 0, Math.PI * 2);
  ctx.fill();

  // Equatorial ridge line
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createTritonTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  // Pinkish nitrogen ice cap + greenish cantaloupe melon-skin terrain
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, 512, 256);

  // South polar nitrogen/methane pink ice
  ctx.fillStyle = '#fbcfe8';
  ctx.fillRect(0, 150, 512, 106);

  // Cantaloupe terrain cellular patterns
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 180; i++) {
    const x = rand() * 512, y = rand() * 150, r = rand() * 8 + 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createPhobosTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#78716c';
  ctx.fillRect(0, 0, 512, 256);

  // Giant Stickney impact crater
  ctx.fillStyle = '#44403c';
  ctx.beginPath();
  ctx.arc(180, 110, 42, 0, Math.PI * 2);
  ctx.fill();

  // Linear groove fracture lines
  ctx.strokeStyle = '#57534e';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(180, 110);
    ctx.lineTo(180 + Math.cos(i * 0.4) * 160, 110 + Math.sin(i * 0.4) * 120);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createDeimosTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = '#8c827a';
  ctx.fillRect(0, 0, 512, 256);

  // Smooth regolith dust mantling with small muted craters
  ctx.fillStyle = '#5c544d';
  for (let i = 0; i < 120; i++) {
    const x = rand() * 512, y = rand() * 256, r = rand() * 6 + 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createIcyMoonTexture(baseColor: string, craterColor: string): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 300; i++) {
    const x = rand() * 512, y = rand() * 256, r = rand() * 4 + 1;
    ctx.fillStyle = rand() > 0.5 ? craterColor : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural Ceres texture calibrated to NASA Dawn HAMO/LAMO imaging:
 * - C-type carbonaceous chondrite low albedo (~0.09) mottled dark surface
 * - Occator Crater with brilliant Cerealia Facula & Vinalia Faculae (sodium carbonate domes)
 * - Ahuna Mons solitary 4-km cryovolcanic dome with bright flank streaks
 * - Haulani Crater with bright impact rays
 * - Large ancient basins (Urvara & Yalode)
 */
export function createCeresTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);

  // 1. Dark carbonaceous C-type asteroid base
  ctx.fillStyle = '#373533';
  ctx.fillRect(0, 0, 1024, 512);

  // 2. Mottled regolith albedo variegations
  for (let i = 0; i < 450; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 30 + 8;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(68, 64, 60, 0.4)' : 'rgba(41, 39, 37, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Dense impact craters across the battered crust
  for (let i = 0; i < 650; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 7 + 1.2;
    ctx.fillStyle = '#22201e';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 105, 100, 0.55)';
    ctx.lineWidth = Math.max(0.75, r * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.7, Math.PI * 1.8);
    ctx.stroke();
  }

  // 4. Large ancient basins (Urvara & Yalode in southern hemisphere)
  ctx.fillStyle = 'rgba(38, 36, 34, 0.7)';
  ctx.beginPath();
  ctx.arc(708, 384, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(95, 90, 85, 0.5)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(35, 33, 31, 0.7)';
  ctx.beginPath();
  ctx.arc(830, 375, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90, 85, 80, 0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 5. Haulani Crater (young ray crater)
  ctx.fillStyle = '#1c1b19';
  ctx.beginPath();
  ctx.arc(31, 240, 14, 0, Math.PI * 2);
  ctx.fill();
  for (let a = 0; a < 8; a++) {
    const angle = (a * Math.PI) / 4 + (rand() - 0.5) * 0.2;
    const len = rand() * 45 + 25;
    ctx.strokeStyle = 'rgba(215, 225, 235, 0.6)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(31, 240);
    ctx.lineTo(31 + Math.cos(angle) * len, 240 + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(31, 240, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 6. Ahuna Mons (solitary 4-km cryovolcanic dome)
  ctx.fillStyle = '#4a4642';
  ctx.beginPath();
  ctx.ellipse(900, 286, 12, 10, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.ellipse(900, 285, 4, 3, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(900, 285);
    ctx.lineTo(900 + (rand() - 0.5) * 16, 285 + (rand() - 0.5) * 14);
    ctx.stroke();
  }

  // 7. OCCATOR CRATER: Iconic 92-km crater with brilliant sodium carbonate salt domes
  ctx.fillStyle = '#181716';
  ctx.beginPath();
  ctx.arc(680, 199, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 115, 110, 0.6)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Cerealia Facula (blinding white central dome)
  const grad = ctx.createRadialGradient(680, 199, 0, 680, 199, 8);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.3, '#f8fafc');
  grad.addColorStop(0.6, 'rgba(226, 232, 240, 0.7)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(680, 199, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(680, 199, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Vinalia Faculae (secondary bright salt deposit cluster)
  const vinaliaOffsets: readonly (readonly [number, number])[] = [
    [5, -2], [7, 1], [8, -3], [6, 4], [9, 2],
  ];
  for (const [dx, dy] of vinaliaOffsets) {
    ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
    ctx.beginPath();
    ctx.arc(680 + dx, 199 + dy, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural Vesta texture calibrated to NASA Dawn imaging:
 * - Basaltic HED achondrite bright albedo (~0.42) regolith
 * - Rheasilvia South Polar Basin (505 km across with 22-km high central mound)
 * - Divalia Fossae parallel equatorial graben canyons
 * - "Snowman" Crater Trio (Marcia, Calpurnia, Minucia)
 */
export function createVestaTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);

  // 1. Basaltic HED achondrite regolith base
  ctx.fillStyle = '#a69f95';
  ctx.fillRect(0, 0, 1024, 512);

  // 2. Variegated basaltic plains and pyroxene/feldspar mineral patches
  for (let i = 0; i < 400; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const rx = rand() * 45 + 15;
    const ry = rand() * 25 + 10;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(186, 179, 169, 0.45)' : 'rgba(128, 120, 112, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Dense northern hemisphere impact craters
  for (let i = 0; i < 600; i++) {
    const x = rand() * 1024;
    const y = rand() * 380;
    const r = rand() * 6 + 1.2;
    ctx.fillStyle = '#5c564f';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(215, 208, 198, 0.6)';
    ctx.lineWidth = Math.max(0.6, r * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 1.85);
    ctx.stroke();
  }

  // 4. DIVALIA FOSSAE: Equatorial graben canyons from impact shock
  ctx.strokeStyle = 'rgba(78, 72, 65, 0.7)';
  for (let j = 0; j < 7; j++) {
    const yBase = 240 + j * 10 + (rand() - 0.5) * 4;
    ctx.lineWidth = rand() * 2.5 + 1.5;
    ctx.beginPath();
    ctx.moveTo(0, yBase);
    for (let x = 60; x <= 1024; x += 60) {
      const yWobble = yBase + Math.sin(x * 0.01 + j) * 8 + (rand() - 0.5) * 3;
      ctx.lineTo(x, yWobble);
    }
    ctx.stroke();
  }

  // 5. "SNOWMAN" CRATER TRIO (Northern hemisphere: Marcia, Calpurnia, Minucia)
  ctx.fillStyle = '#48433d';
  ctx.beginPath();
  ctx.arc(400, 160, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d4cdc2';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.fillStyle = '#4e4942';
  ctx.beginPath();
  ctx.arc(405, 134, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d4cdc2';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = '#544f48';
  ctx.beginPath();
  ctx.arc(414, 114, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d4cdc2';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 6. RHEASILVIA SOUTH POLAR IMPACT BASIN (505 km across with 22-km central peak)
  ctx.fillStyle = '#7a7268';
  ctx.fillRect(0, 410, 1024, 102);

  for (let r = 240; r >= 60; r -= 40) {
    ctx.strokeStyle = 'rgba(65, 60, 54, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(512, 475, r * 1.8, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const peakGrad = ctx.createRadialGradient(512, 475, 0, 512, 475, 60);
  peakGrad.addColorStop(0, '#ded7cc');
  peakGrad.addColorStop(0.4, '#b8b0a4');
  peakGrad.addColorStop(1, '#7a7268');
  ctx.fillStyle = peakGrad;
  ctx.beginPath();
  ctx.ellipse(512, 475, 75, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural Psyche texture calibrated to NASA mission & radar/spectroscopic profile:
 * - M-type metallic nickel-iron surface
 * - High-contrast metallic grains and crystalline mottling
 * - Silicate inclusions (pyroxene-rich impact melt patches)
 * - Sharp unweathered metallic impact depressions
 */
export function createPsycheTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(1024, 512);

  // 1. Metallic nickel-iron base
  ctx.fillStyle = '#717379';
  ctx.fillRect(0, 0, 1024, 512);

  // 2. High-contrast metallic crystalline grain
  for (let i = 0; i < 900; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const w = rand() * 24 + 4;
    const h = rand() * 12 + 3;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(165, 168, 178, 0.4)' : 'rgba(70, 72, 78, 0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Silicate impact melt inclusions
  for (let i = 0; i < 35; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 32 + 10;
    ctx.fillStyle = 'rgba(115, 118, 112, 0.6)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Sharp, non-eroded metallic impact craters
  for (let i = 0; i < 350; i++) {
    const x = rand() * 1024;
    const y = rand() * 512;
    const r = rand() * 8 + 1.5;
    ctx.fillStyle = '#3a3c42';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c5c8d2';
    ctx.lineWidth = Math.max(0.8, r * 0.28);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.7, Math.PI * 1.8);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Seeded deterministic asteroid surface texture for major belt bodies:
 * Chondritic regolith, multi-scale impact cratering, and albedo patches.
 */
export function createAsteroidTexture(
  seed: number,
  baseColor: string,
  craterColor: string,
  craterCount = 350,
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 256);
  setTextureSeed(seed);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 256);

  // Variegated regolith patches
  for (let i = 0; i < 150; i++) {
    const x = rand() * 512;
    const y = rand() * 256;
    const rx = rand() * 25 + 8;
    const ry = rand() * 15 + 4;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Impact craters
  for (let i = 0; i < craterCount; i++) {
    const x = rand() * 512;
    const y = rand() * 256;
    const r = rand() * 5 + 1;
    ctx.fillStyle = craterColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(0.5, r * 0.2);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 1.8);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export const PLANET_TEXTURE_GETTERS: Record<string, () => THREE.CanvasTexture> = {
  sun: createSunTexture,
  mercury: createMercuryTexture,
  venus: createVenusTexture,
  earth: createEarthTexture,
  mars: createMarsTexture,
  jupiter: createJupiterTexture,
  saturn: createSaturnTexture,
  uranus: createUranusTexture,
  neptune: createNeptuneTexture,
  moon: createMoonTexture,
  phobos: createPhobosTexture,
  deimos: createDeimosTexture,
  io: createIoTexture,
  europa: createEuropaTexture,
  ganymede: createGanymedeTexture,
  callisto: createCallistoTexture,
  mimas: createMimasTexture,
  enceladus: createEnceladusTexture,
  tethys: () => createIcyMoonTexture('#d1d5db', '#9ca3af'),
  dione: () => createIcyMoonTexture('#cbd5e1', '#64748b'),
  rhea: () => createIcyMoonTexture('#e2e8f0', '#94a3b8'),
  titan: createTitanTexture,
  hyperion: () => createIcyMoonTexture('#a89f91', '#57534e'),
  iapetus: createIapetusTexture,
  miranda: () => createIcyMoonTexture('#e2e8f0', '#64748b'),
  ariel: () => createIcyMoonTexture('#cbd5e1', '#94a3b8'),
  umbriel: () => createIcyMoonTexture('#64748b', '#334155'),
  titania: () => createIcyMoonTexture('#d1d5db', '#6b7280'),
  oberon: () => createIcyMoonTexture('#9ca3af', '#4b5563'),
  triton: createTritonTexture,
  pluto: createPlutoTexture,
  charon: createCharonTexture,
  // NASA Dawn targets & Asteroid Belt
  ceres: createCeresTexture,
  vesta: createVestaTexture,
  psyche: createPsycheTexture,
  pallas: () => createAsteroidTexture(0x42a, '#505256', '#2b2d30', 450),
  hygiea: () => createAsteroidTexture(0x73b, '#3e3d3b', '#252423', 300),
  iris: () => createAsteroidTexture(0x81c, '#686663', '#403e3c', 350),
  juno: () => createAsteroidTexture(0x92d, '#7a7672', '#4c4844', 380),
  eunomia: () => createAsteroidTexture(0xa3e, '#7d7973', '#4d4944', 360),
  euphrosyne: () => createAsteroidTexture(0xb4f, '#42413f', '#2a2928', 320),
  interamnia: () => createAsteroidTexture(0xc50, '#4a4947', '#2e2d2c', 340),
  davida: () => createAsteroidTexture(0xd61, '#444342', '#2c2b2a', 330),
  sylvia: () => createAsteroidTexture(0xe72, '#484745', '#2f2e2d', 310),
  cybele: () => createAsteroidTexture(0xf83, '#464543', '#2d2c2b', 300),
  camilla: () => createAsteroidTexture(0x094, '#474644', '#2e2d2c', 290),
  thisbe: () => createAsteroidTexture(0x1a5, '#4b4a48', '#302f2e', 310),
  'asteroid-52': () => createAsteroidTexture(0x2b6, '#494846', '#2f2e2d', 320),
};

/**
 * Real planetary maps fetched with `npm run fetch:textures` into public/textures/.
 * Attribution: Solar System Scope free texture set (see public/textures/manifest.json).
 * Returns null when the file is absent (not fetched / offline build) — the caller
 * then keeps the seeded procedural map, so the app never breaks.
 */
export const REAL_TEXTURE_FILES: Record<string, string> = {
  mercury: 'mercury.jpg',
  venus: 'venus.jpg',
  earth: 'earth.jpg',
  moon: 'moon.jpg',
  mars: 'mars.jpg',
  jupiter: 'jupiter.jpg',
  saturn: 'saturn.jpg',
  uranus: 'uranus.jpg',
  neptune: 'neptune.jpg',
  ceres: 'ceres.jpg',
  vesta: 'vesta.jpg',
};

let _loader: THREE.TextureLoader | null = null;

export function hasRealTexture(id: string): boolean {
  return REAL_TEXTURE_FILES[id] !== undefined;
}

export function loadRealTexture(id: string, maxAnisotropy = 4): Promise<THREE.Texture | null> {
  const file = REAL_TEXTURE_FILES[id];
  if (!file || typeof document === 'undefined') return Promise.resolve(null);
  _loader ??= new THREE.TextureLoader();
  const loader = _loader;
  return new Promise((resolve) => {
    loader.load(
      `textures/${file}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
        resolve(tex);
      },
      undefined,
      () => resolve(null), // missing/undecodable file -> procedural fallback stays
    );
  });
}

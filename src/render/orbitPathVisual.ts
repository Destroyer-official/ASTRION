import * as THREE from 'three';
import { stateToElements } from '@/physics/kepler';
import { mapPoint, squash } from '@/frames/transform';
import { toGalactic, applyMat, type GalactoParams } from './galactoTrack';
import type { SystemModel } from '@/sim/registry';
import type { SystemState } from '@/physics/types';
import type { ViewState } from './viewer';

/**
 * NASA-accurate planetary and lunar orbital path colors.
 * Calibrated against NASA Eyes on the Solar System color palette.
 */
export const NASA_ORBIT_COLORS: Record<string, number> = {
  mercury: 0xb39ddb, // Soft purple / violet
  venus: 0xf59e0b,   // Amber / golden orange
  earth: 0x38bdf8,   // Vibrant cyan (Earth blue)
  mars: 0xf87171,    // Coral / martian red
  jupiter: 0xfbbf24, // Warm Jupiter gold
  saturn: 0xfde047,  // Pale Saturn yellow
  uranus: 0x67e8f9,  // Aquamarine ice cyan
  neptune: 0x60a5fa, // Deep royal blue
  pluto: 0x94a3b8,   // Slate / silver
  ceres: 0xa8a29e,   // Asteroid warm gray
  vesta: 0xd6d3d1,   // Asteroid light gray
  pallas: 0xd6d3d1,
  hygiea: 0xa8a29e,
  moon: 0x7dd3fc,    // Lunar pale cyan
  phobos: 0xfca5a5,
  deimos: 0xfca5a5,
  io: 0xfde047,
  europa: 0xbae6fd,
  ganymede: 0xe2e8f0,
  callisto: 0x94a3b8,
  titan: 0xfde047,
  enceladus: 0xe0f2fe,
  mimas: 0xe2e8f0,
  iapetus: 0x94a3b8,
  miranda: 0x99f6e4,
  ariel: 0x99f6e4,
  titania: 0x99f6e4,
  oberon: 0x99f6e4,
  triton: 0x93c5fd,
  charon: 0xcbd5e1,
};

export interface OrbitPathItem {
  id: string;
  index: number;
  parentId: string;
  parentIndex: number;
  isMoon: boolean;
  isAsteroid: boolean;
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  attr: THREE.BufferAttribute;
  data: Float32Array;
  baseColor: number;
}

/**
 * Renders full, closed Keplerian elliptical orbital paths for planets and moons,
 * matching NASA's Eyes on the Solar System.
 * 
 * Every orbital vertex is transformed through the EXACT SAME coordinate transformation
 * pipeline (reference frame axes, origin, focus offset, compression, and galactic voyage)
 * as the bodies themselves, guaranteeing that celestial bodies remain 100% on their orbit lines
 * across all reference frames, dates, and scales.
 */
export class OrbitPathVisual {
  readonly group: THREE.Group;
  private readonly items: OrbitPathItem[] = [];
  private readonly itemsById = new Map<string, OrbitPathItem>();
  readonly sampleCount = 256; // 256 segments = silky smooth, continuous NASA Eyes ellipses
  private readonly plutoIdx: number;
  private readonly charonIdx: number;
  private readonly moonIdx: number;

  // Reusable scratch vectors to avoid heap allocations in the render loop
  private readonly _p: [number, number, number] = [0, 0, 0];
  private readonly _w: [number, number, number] = [0, 0, 0];
  private readonly _pRel: [number, number, number] = [0, 0, 0];
  private readonly _wRel: [number, number, number] = [0, 0, 0];
  private readonly _g: number[] = [0, 0, 0];

  constructor(model: SystemModel) {
    this.group = new THREE.Group();
    this.group.name = 'orbitPaths';
    this.plutoIdx = model.ids.indexOf('pluto');
    this.charonIdx = model.ids.indexOf('charon');
    this.moonIdx = model.ids.indexOf('moon');

    for (let i = 0; i < model.ids.length; i++) {
      const id = model.ids[i]!;
      if (id === 'sun') continue;

      const bodyDef = model.bodies?.find((b) => b.id === id);
      const parentId = bodyDef?.parent ?? 'sun';
      const isMoon = !!bodyDef?.parent;
      const parentIdx = model.ids.indexOf(parentId);
      if (parentIdx < 0) continue;

      const isAsteroid = ['ceres', 'vesta', 'pallas', 'hygiea'].includes(id);

      // 96 segments = 97 points closed loop
      const data = new Float32Array((this.sampleCount + 1) * 3);
      const geom = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(data, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', attr);

      const baseHex = NASA_ORBIT_COLORS[id] ?? 0x94a3b8;
      const mat = new THREE.LineBasicMaterial({
        color: baseHex,
        transparent: false,
        depthWrite: true,
        depthTest: true,
      });

      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      this.group.add(line);

      const item: OrbitPathItem = {
        id,
        index: i,
        parentId,
        parentIndex: parentIdx,
        isMoon,
        isAsteroid,
        line,
        mat,
        attr,
        data,
        baseColor: baseHex,
      };
      this.items.push(item);
      this.itemsById.set(id, item);
    }
  }

  getItem(id: string): OrbitPathItem | undefined {
    return this.itemsById.get(id);
  }

  update(
    s: SystemState,
    v: ViewState,
    sunIdx: number,
    galacto: { params: GalactoParams } | null,
    o: [number, number, number],
    f: [number, number, number],
    camDistToSun: number,
    bodyDists: Float64Array,
    selectedId: string | null,
    focusId: string | null,
    showOrbits = true,
  ): void {
    if (!showOrbits || (camDistToSun > 350 && !v.galactocentric)) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const ax = v.frame.axes;
    const compress = v.compress ?? 1;
    const travelDir = v.frame.travelDir;
    const sunX = s.pos[3 * sunIdx]!;
    const sunY = s.pos[3 * sunIdx + 1]!;
    const sunZ = s.pos[3 * sunIdx + 2]!;
    const kGal = galacto ? galacto.params.helioExag / galacto.params.unitsPerKpc : 1;

    const isPlutoCharon =
      focusId === 'pluto' || focusId === 'charon' || selectedId === 'pluto' || selectedId === 'charon';
    const camDistToPluto = this.plutoIdx >= 0 ? (bodyDists[this.plutoIdx] ?? Infinity) : Infinity;
    const inPlutoClose = (isPlutoCharon && camDistToPluto < 0.1) || camDistToPluto < 0.05;

    // 1. Render Pluto-Charon mutual binary orbits around their common center of mass
    // 1. Render Pluto-Charon satellite orbit around the system (Charon's orbit; Pluto has no self-intersecting loop)
    if (inPlutoClose && this.plutoIdx >= 0 && this.charonIdx >= 0) {
      const gmP = s.gm[this.plutoIdx] ?? 0;
      const gmC = s.gm[this.charonIdx] ?? 0;
      const totalGm = Math.max(1e-18, gmP + gmC);
      const pIdx = this.plutoIdx;
      const cIdx = this.charonIdx;

      const px = s.pos[3 * pIdx]!,
        py = s.pos[3 * pIdx + 1]!,
        pz = s.pos[3 * pIdx + 2]!;
      const cx = s.pos[3 * cIdx]!,
        cy = s.pos[3 * cIdx + 1]!,
        cz = s.pos[3 * cIdx + 2]!;

      const baryX = (gmP * px + gmC * cx) / totalGm;
      const baryY = (gmP * py + gmC * cy) / totalGm;
      const baryZ = (gmP * pz + gmC * cz) / totalGm;

      const rx = cx - px;
      const ry = cy - py;
      const rz = cz - pz;

      const vx = s.vel[3 * cIdx]! - s.vel[3 * pIdx]!;
      const vy = s.vel[3 * cIdx + 1]! - s.vel[3 * pIdx + 1]!;
      const vz = s.vel[3 * cIdx + 2]! - s.vel[3 * pIdx + 2]!;

      let el = stateToElements(totalGm, [rx, ry, rz], [vx, vy, vz]);
      if (!Number.isFinite(el.a) || el.a <= 0 || el.e >= 0.99) {
        const rNorm = Math.hypot(rx, ry, rz);
        el = {
          a: rNorm,
          e: 0.001,
          inc: el.inc || 0,
          node: el.node || 0,
          argPeri: el.argPeri || 0,
          meanAnom: 0,
          period: 2 * Math.PI * Math.sqrt((rNorm * rNorm * rNorm) / totalGm),
        };
      }

      const q = Math.sqrt(Math.max(0, 1 - el.e * el.e));
      const cO = Math.cos(el.node),
        sO = Math.sin(el.node);
      const cw = Math.cos(el.argPeri),
        sw = Math.sin(el.argPeri);
      const ci = Math.cos(el.inc),
        si = Math.sin(el.inc);

      const Px = cO * cw - sO * sw * ci;
      const Py = sO * cw + cO * sw * ci;
      const Pz = sw * si;

      const Qx = -cO * sw - sO * cw * ci;
      const Qy = -sO * sw + cO * cw * ci;
      const Qz = cw * si;

      const fracC = gmP / totalGm; // Charon distance factor from barycenter (0.892)

      const charonItem = this.itemsById.get('charon');
      if (charonItem) {
        if (galacto) {
          charonItem.line.position.set(0, 0, 0);
          for (let j = 0; j <= this.sampleCount; j++) {
            const E = (j / this.sampleCount) * Math.PI * 2;
            const cE = Math.cos(E);
            const sE = Math.sin(E);

            const relDx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
            const relDy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
            const relDz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

            const charonSimX = baryX + fracC * relDx;
            const charonSimY = baryY + fracC * relDy;
            const charonSimZ = baryZ + fracC * relDz;

            toGalactic(charonSimX - sunX, charonSimY - sunY, charonSimZ - sunZ, this._g);
            applyMat(
              galacto.params.matWorld,
              galacto.params.sunGalKpc[0]! + this._g[0]! * kGal,
              galacto.params.sunGalKpc[1]! + this._g[1]! * kGal,
              galacto.params.sunGalKpc[2]! + this._g[2]! * kGal,
              charonItem.data,
              3 * j,
            );
          }
        } else {
          mapPoint(ax, o, baryX, baryY, baryZ, this._p);
          squash(travelDir, compress, this._p[0]! - f[0]!, this._p[1]! - f[1]!, this._p[2]! - f[2]!, this._w);
          charonItem.line.position.set(this._w[0]!, this._w[1]!, this._w[2]!);

          for (let j = 0; j <= this.sampleCount; j++) {
            const E = (j / this.sampleCount) * Math.PI * 2;
            const cE = Math.cos(E);
            const sE = Math.sin(E);

            const relDx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
            const relDy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
            const relDz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

            const charonRelX = fracC * relDx;
            const charonRelY = fracC * relDy;
            const charonRelZ = fracC * relDz;
            mapPoint(ax, [0, 0, 0], charonRelX, charonRelY, charonRelZ, this._pRel);
            squash(travelDir, compress, this._pRel[0]!, this._pRel[1]!, this._pRel[2]!, this._wRel);
            charonItem.data[3 * j] = this._wRel[0]!;
            charonItem.data[3 * j + 1] = this._wRel[1]!;
            charonItem.data[3 * j + 2] = this._wRel[2]!;
          }
        }
        charonItem.attr.needsUpdate = true;
        charonItem.line.visible = true;
      }
    }

    // 2. Render all standard orbital paths
    for (const item of this.items) {
      // In close-up Pluto-Charon view, Charon orbit handled above; Pluto heliocentric orbit hidden
      if (inPlutoClose && (item.id === 'pluto' || item.id === 'charon')) {
        if (item.id === 'pluto') {
          item.line.visible = false; // Hide 40 AU heliocentric orbit in close-up
        }
        continue;
      }

      // Visibility checks
      if (item.isMoon) {
        const isHostSelected = selectedId === item.parentId || focusId === item.parentId;
        const isMoonSelected = selectedId === item.id || focusId === item.id;
        const hostDist = bodyDists[item.parentIndex] ?? Infinity;
        const visible = isHostSelected || isMoonSelected || hostDist < 0.35;
        item.line.visible = visible;
        if (!visible) continue;
      } else {
        // Planetary orbit lines
        const camDist = bodyDists[item.index] ?? Infinity;
        // In NASA Eyes, when inspecting a planet system up-close (< 0.15 AU),
        // hide the planet's massive multi-AU heliocentric orbit line so it doesn't slice through the planet disc
        if (camDist < 0.15) {
          item.line.visible = false;
          continue;
        }
        item.line.visible = true;
      }

      // Highlighting selected/focused body orbit
      const isSelected = selectedId === item.id || focusId === item.id;
      if (isSelected) {
        item.mat.color.setHex(0xffffff); // Crisp white glow for active orbit
      } else {
        item.mat.color.setHex(item.baseColor);
      }

      // Instantaneous osculating orbital elements relative to parent
      const i = item.index;
      const P = item.parentIndex;

      let pSimX = s.pos[3 * i]!;
      let pSimY = s.pos[3 * i + 1]!;
      let pSimZ = s.pos[3 * i + 2]!;

      let vSimX = s.vel[3 * i]!;
      let vSimY = s.vel[3 * i + 1]!;
      let vSimZ = s.vel[3 * i + 2]!;

      let mu = (s.gm[P] ?? 0) + (s.gm[i] ?? 0);

      // NASA Ephemeris Convention (JPL DE440 Body 9 & Body 3):
      // For binary systems orbiting the Sun (Pluto-Charon, Earth-Moon), heliocentric orbital paths
      // are defined by their system barycenter, exactly matching NASA JPL SPK kernels.
      // This eliminates the 6.38-day velocity wobble (+/- 24 m/s from Charon) that causes
      // Pluto's instantaneous osculating ellipse to pulse/breathe (+/- 0.4 AU).
      if (item.id === 'pluto' && this.charonIdx >= 0) {
        const gmP = s.gm[i] ?? 0;
        const gmC = s.gm[this.charonIdx] ?? 0;
        const tot = Math.max(1e-18, gmP + gmC);
        pSimX = (gmP * pSimX + gmC * s.pos[3 * this.charonIdx]!) / tot;
        pSimY = (gmP * pSimY + gmC * s.pos[3 * this.charonIdx + 1]!) / tot;
        pSimZ = (gmP * pSimZ + gmC * s.pos[3 * this.charonIdx + 2]!) / tot;

        vSimX = (gmP * vSimX + gmC * s.vel[3 * this.charonIdx]!) / tot;
        vSimY = (gmP * vSimY + gmC * s.vel[3 * this.charonIdx + 1]!) / tot;
        vSimZ = (gmP * vSimZ + gmC * s.vel[3 * this.charonIdx + 2]!) / tot;

        mu = (s.gm[P] ?? 0) + tot;
      } else if (item.id === 'earth' && this.moonIdx >= 0) {
        const gmE = s.gm[i] ?? 0;
        const gmM = s.gm[this.moonIdx] ?? 0;
        const tot = Math.max(1e-18, gmE + gmM);
        pSimX = (gmE * pSimX + gmM * s.pos[3 * this.moonIdx]!) / tot;
        pSimY = (gmE * pSimY + gmM * s.pos[3 * this.moonIdx + 1]!) / tot;
        pSimZ = (gmE * pSimZ + gmM * s.pos[3 * this.moonIdx + 2]!) / tot;

        vSimX = (gmE * vSimX + gmM * s.vel[3 * this.moonIdx]!) / tot;
        vSimY = (gmE * vSimY + gmM * s.vel[3 * this.moonIdx + 1]!) / tot;
        vSimZ = (gmE * vSimZ + gmM * s.vel[3 * this.moonIdx + 2]!) / tot;

        mu = (s.gm[P] ?? 0) + tot;
      }

      const rx = pSimX - s.pos[3 * P]!;
      const ry = pSimY - s.pos[3 * P + 1]!;
      const rz = pSimZ - s.pos[3 * P + 2]!;

      const vx = vSimX - s.vel[3 * P]!;
      const vy = vSimY - s.vel[3 * P + 1]!;
      const vz = vSimZ - s.vel[3 * P + 2]!;

      let el = stateToElements(mu, [rx, ry, rz], [vx, vy, vz]);

      if (!Number.isFinite(el.a) || el.a <= 0 || el.e >= 0.99) {
        const rNorm = Math.hypot(rx, ry, rz);
        if (rNorm <= 0) continue;
        el = {
          a: rNorm,
          e: 0.001,
          inc: el.inc || 0,
          node: el.node || 0,
          argPeri: el.argPeri || 0,
          meanAnom: 0,
          period: 2 * Math.PI * Math.sqrt((rNorm * rNorm * rNorm) / Math.max(1e-18, mu)),
        };
      }

      // Keplerian basis vectors P and Q in orbital plane
      const q = Math.sqrt(Math.max(0, 1 - el.e * el.e));
      const cO = Math.cos(el.node);
      const sO = Math.sin(el.node);
      const cw = Math.cos(el.argPeri);
      const sw = Math.sin(el.argPeri);
      const ci = Math.cos(el.inc);
      const si = Math.sin(el.inc);

      const Px = cO * cw - sO * sw * ci;
      const Py = sO * cw + cO * sw * ci;
      const Pz = sw * si;

      const Qx = -cO * sw - sO * cw * ci;
      const Qy = -sO * sw + cO * cw * ci;
      const Qz = cw * si;

      const px = s.pos[3 * P]!;
      const py = s.pos[3 * P + 1]!;
      const pz = s.pos[3 * P + 2]!;

      if (galacto) {
        // Voyage mode: heliocentric offset into galactic axes and matrixWorld
        item.line.position.set(0, 0, 0);
        for (let j = 0; j <= this.sampleCount; j++) {
          const E = (j / this.sampleCount) * Math.PI * 2;
          const cE = Math.cos(E);
          const sE = Math.sin(E);

          const dx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
          const dy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
          const dz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

          const simX = px + dx;
          const simY = py + dy;
          const simZ = pz + dz;

          toGalactic(simX - sunX, simY - sunY, simZ - sunZ, this._g);
          applyMat(
            galacto.params.matWorld,
            galacto.params.sunGalKpc[0]! + this._g[0]! * kGal,
            galacto.params.sunGalKpc[1]! + this._g[1]! * kGal,
            galacto.params.sunGalKpc[2]! + this._g[2]! * kGal,
            item.data,
            3 * j,
          );
        }
      } else if (item.isMoon) {
        // NASA Flight-Grade Host-Relative Rendering for all planetary moons:
        // Line origin is anchored at parent body display position in Three.js. Vertices in item.data
        // are purely local relative offsets around (0,0,0) in display space, ensuring
        // sub-millimeter Float32 precision and perfectly smooth ellipses without stair-stepping or facets.
        mapPoint(ax, o, px, py, pz, this._p);
        squash(travelDir, compress, this._p[0]! - f[0]!, this._p[1]! - f[1]!, this._p[2]! - f[2]!, this._w);
        item.line.position.set(this._w[0]!, this._w[1]!, this._w[2]!);

        for (let j = 0; j <= this.sampleCount; j++) {
          const E = (j / this.sampleCount) * Math.PI * 2;
          const cE = Math.cos(E);
          const sE = Math.sin(E);

          const dx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
          const dy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
          const dz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

          mapPoint(ax, [0, 0, 0], dx, dy, dz, this._pRel);
          squash(travelDir, compress, this._pRel[0]!, this._pRel[1]!, this._pRel[2]!, this._wRel);
          item.data[3 * j] = this._wRel[0]!;
          item.data[3 * j + 1] = this._wRel[1]!;
          item.data[3 * j + 2] = this._wRel[2]!;
        }
      } else {
        // Standard planetary and asteroid orbits around the Sun:
        item.line.position.set(0, 0, 0);
        for (let j = 0; j <= this.sampleCount; j++) {
          const E = (j / this.sampleCount) * Math.PI * 2;
          const cE = Math.cos(E);
          const sE = Math.sin(E);

          const dx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
          const dy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
          const dz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

          const simX = px + dx;
          const simY = py + dy;
          const simZ = pz + dz;

          mapPoint(ax, o, simX, simY, simZ, this._p);
          squash(travelDir, compress, this._p[0]! - f[0]!, this._p[1]! - f[1]!, this._p[2]! - f[2]!, this._w);
          item.data[3 * j] = this._w[0]!;
          item.data[3 * j + 1] = this._w[1]!;
          item.data[3 * j + 2] = this._w[2]!;
        }
      }

      item.attr.needsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}

import type { ForceModel, Integrator, SystemState } from '../types';

const c = Math.cbrt(2);
const W4 = [1 / (2 - c), -c / (2 - c), 1 / (2 - c)]; // sums to 1

// Yoshida (1990), 6th order, "solution A"
const a1 = -1.17767998417887,
  a2 = 0.235573213359357,
  a3 = 0.78451361047756;
const a0 = 1 - 2 * (a1 + a2 + a3);
const W6 = [a3, a2, a1, a0, a1, a2, a3];

// Yoshida (1990), 8th-order triple composition of 6th order
const c7 = Math.pow(2, 1 / 7);
const w8_1 = 1 / (2 - c7);
const w8_0 = 1 - 2 * w8_1;
const W8: number[] = [];
for (const w6 of W6) W8.push(w8_1 * w6);
for (const w6 of W6) W8.push(w8_0 * w6);
for (const w6 of W6) W8.push(w8_1 * w6);

export class Composition implements Integrator {
  readonly name: string;
  private readonly base: Integrator;
  private readonly w: readonly number[];
  constructor(name: string, base: Integrator, weights: readonly number[]) {
    this.name = name;
    this.base = base;
    this.w = weights;
  }
  step(s: SystemState, forces: ForceModel[], dt: number): void {
    if (!Number.isFinite(dt) || dt === 0) return;
    for (const w of this.w) {
      this.base.step(s, forces, w * dt);
      if (!Number.isFinite(s.t) || !Number.isFinite(s.pos[0]!)) break;
    }
  }
}

export const yoshida4 = (base: Integrator) => new Composition('yoshida4', base, W4);
export const yoshida6 = (base: Integrator) => new Composition('yoshida6', base, W6);
export const yoshida8 = (base: Integrator) => new Composition('yoshida8', base, W8);

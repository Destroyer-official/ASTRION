import type { SystemState } from '@/physics/types';
import { DEFAULT_CONFIG, type PhysicsConfig } from './config';
import type { SystemModel } from './registry';

export const SIM_SNAPSHOT_VERSION = 1;

export interface SimSnapshot {
  version: number;
  ids: readonly string[];
  epochJd: number;
  t: number;
  n: number;
  gm: Float64Array;
  pos: Float64Array;
  vel: Float64Array;
  config: PhysicsConfig;
}

const INTEGRATORS = new Set(['leapfrog', 'yoshida4', 'yoshida6', 'yoshida8', 'truth8']);

function finiteArray(values: Float64Array, expectedLength: number, label: string): void {
  if (values.length !== expectedLength) {
    throw new Error(`snapshot ${label} length ${values.length}, expected ${expectedLength}`);
  }
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error(`snapshot ${label} contains a non-finite value`);
  }
}

function validateConfig(config: PhysicsConfig): void {
  if (!config || typeof config !== 'object') throw new Error('snapshot config must be an object');
  if (typeof config.integrator !== 'string' || !INTEGRATORS.has(config.integrator)) {
    throw new Error(`snapshot integrator ${String(config.integrator)} is not supported`);
  }
  for (const key of ['dt', 'maxSteps', 'stepsPerPeriod'] as const) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`snapshot config.${key} must be finite and positive`);
    }
  }
  for (const key of ['gr', 'sunJ2', 'planetJ2'] as const) {
    if (typeof config[key] !== 'boolean') throw new Error(`snapshot config.${key} must be boolean`);
  }
  for (const key of ['eihRelativity', 'harmonics', 'srp'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`snapshot config.${key} must be boolean when present`);
    }
  }
}

export function validateSimSnapshot(input: unknown): asserts input is SimSnapshot {
  const snapshot = input as Partial<SimSnapshot>;
  if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot must be an object');
  if (snapshot.version !== SIM_SNAPSHOT_VERSION) {
    throw new Error(`unsupported snapshot version ${String(snapshot.version)}`);
  }
  const ids = snapshot.ids;
  const n = snapshot.n;
  const gm = snapshot.gm;
  const pos = snapshot.pos;
  const vel = snapshot.vel;
  const config = snapshot.config;
  const epochJd = snapshot.epochJd;
  const t = snapshot.t;

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('snapshot ids must be non-empty strings');
  }
  if (new Set(ids).size !== ids.length) throw new Error('snapshot ids must be unique');
  if (!Number.isInteger(n) || (n as number) <= 0 || n !== ids.length) {
    throw new Error('snapshot body count must match the id list');
  }
  if (!Number.isFinite(epochJd)) throw new Error('snapshot epochJd must be finite');
  if (!Number.isFinite(t)) throw new Error('snapshot time must be finite');
  if (!(gm instanceof Float64Array) || !(pos instanceof Float64Array) || !(vel instanceof Float64Array)) {
    throw new Error('snapshot vectors must be Float64Array instances');
  }

  finiteArray(gm, n, 'gm');
  finiteArray(pos, n * 3, 'position');
  finiteArray(vel, n * 3, 'velocity');
  validateConfig(config as PhysicsConfig);
}

export function createSimSnapshot(
  model: SystemModel,
  state: SystemState = model.state,
  config: PhysicsConfig = { ...DEFAULT_CONFIG },
): SimSnapshot {
  const snapshot: SimSnapshot = {
    version: SIM_SNAPSHOT_VERSION,
    ids: [...model.ids],
    epochJd: model.epochJd,
    t: state.t,
    n: state.n,
    gm: state.gm.slice(),
    pos: state.pos.slice(),
    vel: state.vel.slice(),
    config: { ...config },
  };
  validateSimSnapshot(snapshot);
  return snapshot;
}

function toBytes(values: Float64Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return bytes;
}

function fromBytes(bytes: Uint8Array, length: number): Float64Array {
  if (bytes.length !== length * 8) {
    throw new Error(`encoded vector has ${bytes.length} bytes, expected ${length * 8}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float64Array(length);
  for (let i = 0; i < length; i++) values[i] = view.getFloat64(i * 8, true);
  return values;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeConfig(config: PhysicsConfig): PhysicsConfig {
  const out: PhysicsConfig = {
    integrator: config.integrator,
    dt: config.dt,
    maxSteps: config.maxSteps,
    gr: config.gr,
    sunJ2: config.sunJ2,
    planetJ2: config.planetJ2,
    stepsPerPeriod: config.stepsPerPeriod,
  };
  if (config.eihRelativity !== undefined) out.eihRelativity = config.eihRelativity;
  if (config.harmonics !== undefined) out.harmonics = config.harmonics;
  if (config.srp !== undefined) out.srp = config.srp;
  return out;
}

export function serializeSimSnapshot(input: SimSnapshot): string {
  validateSimSnapshot(input);
  const config = normalizeConfig(input.config);
  return JSON.stringify({
    version: input.version,
    ids: [...input.ids],
    epochJd: input.epochJd,
    t: input.t,
    n: input.n,
    gm: bytesToBase64(toBytes(input.gm)),
    pos: bytesToBase64(toBytes(input.pos)),
    vel: bytesToBase64(toBytes(input.vel)),
    config,
  });
}

export function parseSimSnapshot(text: string): SimSnapshot {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('serialized snapshot must be an object');
  }
  const source = value as Record<string, unknown>;
  const encoded = ['gm', 'pos', 'vel'] as const;
  for (const key of encoded) {
    if (typeof source[key] !== 'string') throw new Error(`snapshot ${key} must be base64 text`);
  }
  if (!Array.isArray(source.ids) || typeof source.epochJd !== 'number' || typeof source.t !== 'number' ||
    !Number.isInteger(source.n) || typeof source.version !== 'number' || !source.config ||
    typeof source.config !== 'object') {
    throw new Error('snapshot metadata has the wrong shape');
  }

  const snapshot: SimSnapshot = {
    version: source.version,
    ids: source.ids as string[],
    epochJd: source.epochJd,
    t: source.t,
    n: source.n as number,
    gm: fromBytes(base64ToBytes(source.gm as string), source.n as number),
    pos: fromBytes(base64ToBytes(source.pos as string), (source.n as number) * 3),
    vel: fromBytes(base64ToBytes(source.vel as string), (source.n as number) * 3),
    config: source.config as PhysicsConfig,
  };
  validateSimSnapshot(snapshot);
  return snapshot;
}

export function snapshotToState(snapshot: SimSnapshot): SystemState {
  validateSimSnapshot(snapshot);
  return {
    t: snapshot.t,
    n: snapshot.n,
    gm: snapshot.gm.slice(),
    pos: snapshot.pos.slice(),
    vel: snapshot.vel.slice(),
  };
}

function canonicalHeader(snapshot: SimSnapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    ids: [...snapshot.ids],
    epochJd: snapshot.epochJd,
    t: snapshot.t,
    n: snapshot.n,
    config: normalizeConfig(snapshot.config),
  });
}

function canonicalSnapshotBytes(snapshot: SimSnapshot): ArrayBuffer {
  validateSimSnapshot(snapshot);
  const header = new TextEncoder().encode(canonicalHeader(snapshot));
  const gm = toBytes(snapshot.gm);
  const pos = toBytes(snapshot.pos);
  const vel = toBytes(snapshot.vel);
  const buffer = new ArrayBuffer(header.length + gm.length + pos.length + vel.length + 16);
  const out = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint32(offset, header.length, true);
  offset += 4;
  out.set(header, offset);
  offset += header.length;
  for (const bytes of [gm, pos, vel]) {
    view.setUint32(offset, bytes.length, true);
    offset += 4;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return buffer;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashSimSnapshot(snapshot: SimSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', canonicalSnapshotBytes(snapshot));
  return toHex(new Uint8Array(digest));
}

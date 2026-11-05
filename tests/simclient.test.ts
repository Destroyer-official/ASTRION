import { describe, it, expect, beforeAll } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { SimCore } from '@/sim/simCore';
import { SimClient, type ClientOptions } from '@/sim/simClient';
import type { ToWorker } from '@/sim/protocol';
import { HealthRegistry } from '@/observability';
import { PHASE1_BODIES } from './fixtures/phase1';

/** In-process stand-in for the physics Web Worker: same SimCore, same messages. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readonly seen: ToWorker[] = [];
  static constructed = 0;
  failNext = false;
  terminated = false;
  private readonly core = new SimCore();
  constructor(_url?: string | URL) {
    FakeWorker.constructed++;
  }
  postMessage(msg: ToWorker) {
    this.seen.push(msg);
    setTimeout(() => {
      try {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('simulated worker crash');
        }
        const out = this.core.handle(msg);
        if (out) this.onmessage?.({ data: out } as MessageEvent);
      } catch (err) {
        this.onerror?.(err);
      }
    }, 0);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeAll(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
});

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function makeClient(overrides: Partial<ClientOptions> = {}) {
  const model = loadSystem(PHASE1_BODIES);
  const client = new SimClient(model, {
    maxDt: 1,
    maxSteps: 500,
    historyCap: 4000,
    historyIntervalDays: 5,
    chunkDays: 12,
    maxBacklogDays: 120,
    ...overrides,
  });
  const worker = (client as unknown as { worker: FakeWorker }).worker;
  return { model, client, worker };
}

describe('SimClient worker protocol (fake worker)', () => {
  it('streams advances in bounded bites', async () => {
    const { client, worker } = makeClient();
    await flush();
    expect(client.ready).toBe(true);
    client.request(100);
    await flush();
    const bites = worker.seen.filter((m) => m.type === 'advance').map((m) => (m as { days: number }).days);
    expect(bites.length).toBeGreaterThan(0);
    for (const d of bites) expect(Math.abs(d)).toBeLessThanOrEqual(12);
    expect(client.state.t).toBeGreaterThan(0);
    client.dispose();
  });

  it('publishes worker and invariant health to an injected registry', async () => {
    const changes: string[] = [];
    const health = new HealthRegistry({
      onChange: (_, next) => changes.push(`${next.module}:${next.status}`),
    });
    const { client } = makeClient({ health });
    await flush();
    client.request(20);
    await flush();

    expect(client.invariantOk).toBe(true);
    expect(health.get('physics-worker').status).toBe('ok');
    expect(health.get('simulation-state').status).toBe('ok');
    expect(changes).toContain('physics-worker:ok');
    expect(changes).toContain('simulation-state:ok');
    client.dispose();
  });

  it('travelTo loads exact vectors and syncs the display', async () => {
    const { model, client } = makeClient();
    await flush();
    const want = {
      pos: model.state.pos.map((x) => x + 0.01),
      vel: model.state.vel.slice(),
    };
    const ok = await client.travelTo(100, async () => want);
    expect(ok).toBe(true);
    await flush();
    expect(client.busy).toBe(false);
    expect(client.display.t).toBe(100);
    expect(client.display.pos).toEqual(want.pos);
    expect(client.state.t).toBe(100);
    client.dispose();
  });

  it('travelTo falls back when fetch fails', async () => {
    const { client } = makeClient();
    await flush();
    const ok = await client.travelTo(50, async () => null);
    expect(ok).toBe(false);
    expect(client.busy).toBe(false);
    client.dispose();
  });

  it('seek chains bounded hops to a far target', async () => {
    const { client, worker } = makeClient();
    await flush();
    client.seek(600);
    for (let i = 0; i < 200 && client.busy; i++) await flush(20);
    expect(client.busy).toBe(false);
    expect(client.state.t).toBeCloseTo(600, 6);
    const seeks = worker.seen.filter((m) => m.type === 'seek');
    expect(seeks.length).toBeGreaterThan(1); // chained, not one giant bite
    client.dispose();
  }, 60_000);

  it('survives a worker crash: respawns, reseeds, resumes', async () => {
    FakeWorker.constructed = 0;
    const { client } = makeClient();
    await flush();
    expect(client.ready).toBe(true);
    client.request(20);
    await flush();
    const tBefore = client.state.t;
    expect(tBefore).toBeGreaterThan(0);

    const cur = (client as unknown as { worker: FakeWorker }).worker;
    cur.failNext = true;
    client.request(20); // this message dies with the worker
    await flush(120);
    // Respawned exactly once, ready again, state preserved (never older).
    expect(FakeWorker.constructed).toBe(2);
    expect(client.ready).toBe(true);
    expect(client.busy).toBe(false);
    expect(client.state.t).toBeGreaterThanOrEqual(tBefore);
    // And it still integrates afterwards.
    client.request(20);
    await flush();
    expect(client.state.t).toBeGreaterThan(tBefore);
    expect(client.workerDead).toBe(false);
    client.dispose();
  });

  it('parks the worker after repeated crashes instead of respawn-looping', async () => {
    FakeWorker.constructed = 0;
    const { client } = makeClient();
    await flush();
    for (let i = 0; i < 4; i++) {
      (client as unknown as { worker: FakeWorker }).worker.failNext = true;
      client.request(5);
      await flush(120);
    }
    expect(client.workerDead).toBe(true);
    expect(FakeWorker.constructed).toBe(4); // init + 3 respawns, then stop
    expect(client.busy).toBe(false);
    client.dispose();
  });

  it('an in-flight seek resumes after a crash', async () => {
    const { client } = makeClient();
    await flush();
    client.seek(300);
    await flush(40);
    (client as unknown as { worker: FakeWorker }).worker.failNext = true;
    for (let i = 0; i < 200 && client.busy; i++) await flush(20);
    expect(client.busy).toBe(false);
    expect(client.state.t).toBeCloseTo(300, 6);
    client.dispose();
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { OBLIQUITY_J2000_RAD } from '@/data/galaxy';
import { SpkFile } from '@/sim/spk';

const FILE_BYTES = 4_096;
const SUMMARY_RECORD = 2;
const DATA_FIRST_ADDRESS = 385;
const REFERENCE_FRAME = 1;

interface SpkType3Segment {
  readonly target: number;
  readonly center: number;
  readonly firstEt: number;
  readonly lastEt: number;
  readonly interval?: number;
  readonly records: ReadonlyArray<{
    readonly mid: number;
    readonly radius: number;
    readonly position: readonly [number, number, number];
    readonly velocity: readonly [number, number, number];
  }>;
}

function writeString(view: DataView, offset: number, text: string, length: number): void {
  for (let i = 0; i < length; i++) view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) : 0x20);
}

/** Writes one or more type 3 segments, each with its own directory, into one DAF file. */
function writeType3File(...segments: readonly SpkType3Segment[]): ArrayBuffer {
  const coefficientLength = 3;
  const payloadSize = 2 + 6 * coefficientLength;
  const words = segments.reduce((total, s) => total + s.records.length * payloadSize + 4, 0);
  const buffer = new ArrayBuffer(FILE_BYTES);
  const view = new DataView(buffer);

  writeString(view, 0, 'DAF/SPK ', 8);
  view.setInt32(8, 2, true);
  view.setInt32(12, 6, true);
  writeString(view, 16, 'synthetic type 3 SPK', 60);
  view.setInt32(76, SUMMARY_RECORD, true);
  view.setInt32(80, SUMMARY_RECORD, true);
  view.setInt32(84, DATA_FIRST_ADDRESS + words, true);
  writeString(view, 88, 'LTL-IEEE', 8);

  const summaryBase = (SUMMARY_RECORD - 1) * 1_024;
  view.setFloat64(summaryBase + 0, 0, true);
  view.setFloat64(summaryBase + 8, 0, true);
  view.setFloat64(summaryBase + 16, segments.length, true);
  writeString(view, 2_048, 'synthetic type 3 segment', 40);

  let word = DATA_FIRST_ADDRESS - 1;
  const put = (value: number) => {
    view.setFloat64(word * 8, value, true);
    word++;
  };

  segments.forEach((segment, index) => {
    const firstAddress = word + 1;
    word += segment.records.length * payloadSize;
    const lastAddress = word + 4;

    // One summary holds ND doubles then NI integers packed two per word, and
    // the entries start after the record's next/previous/count words.
    const base = summaryBase + (3 + index * (2 + 3)) * 8;
    view.setFloat64(base + 0, segment.firstEt, true);
    view.setFloat64(base + 8, segment.lastEt, true);
    view.setInt32(base + 16, segment.target, true);
    view.setInt32(base + 20, segment.center, true);
    view.setInt32(base + 24, REFERENCE_FRAME, true);
    view.setInt32(base + 28, 3, true);
    view.setInt32(base + 32, firstAddress, true);
    view.setInt32(base + 36, lastAddress, true);

    word = firstAddress - 1;
    for (const record of segment.records) {
      put(record.mid);
      put(record.radius);
      for (let axis = 0; axis < 3; axis++) {
        put(record.position[axis]!);
        put(0);
        put(0);
      }
      for (let axis = 0; axis < 3; axis++) {
        put(record.velocity[axis]!);
        put(0);
        put(0);
      }
    }

    put(segment.firstEt);
    put(segment.interval ?? 100);
    put(payloadSize);
    put(segment.records.length);
  });
  return buffer;
}

function writeType2File(): ArrayBuffer {
  const coefficientLength = 2;
  const payloadSize = 2 + 3 * coefficientLength;
  const wordsPerRecord = payloadSize;
  const segmentWords = wordsPerRecord + 4;
  const lastAddress = DATA_FIRST_ADDRESS + segmentWords - 1;
  const buffer = new ArrayBuffer(FILE_BYTES);
  const view = new DataView(buffer);

  writeString(view, 0, 'DAF/SPK ', 8);
  view.setInt32(8, 2, true);
  view.setInt32(12, 6, true);
  view.setInt32(76, SUMMARY_RECORD, true);
  view.setInt32(80, SUMMARY_RECORD, true);
  view.setInt32(84, DATA_FIRST_ADDRESS + segmentWords, true);
  writeString(view, 88, 'LTL-IEEE', 8);

  const summaryBase = (SUMMARY_RECORD - 1) * 1_024;
  view.setFloat64(summaryBase + 0, 0, true);
  view.setFloat64(summaryBase + 8, 0, true);
  view.setFloat64(summaryBase + 16, 1, true);
  view.setFloat64(summaryBase + 24, 0, true);
  view.setFloat64(summaryBase + 32, 100, true);
  view.setInt32(summaryBase + 40, 399, true);
  view.setInt32(summaryBase + 44, 10, true);
  view.setInt32(summaryBase + 48, REFERENCE_FRAME, true);
  view.setInt32(summaryBase + 52, 2, true);
  view.setInt32(summaryBase + 56, DATA_FIRST_ADDRESS, true);
  view.setInt32(summaryBase + 60, lastAddress, true);

  let word = DATA_FIRST_ADDRESS - 1;
  const put = (value: number) => {
    view.setFloat64(word * 8, value, true);
    word++;
  };
  put(50);
  put(50);
  put(1);
  put(1);
  put(2);
  put(0);
  put(3);
  put(0);
  put(0);
  put(100);
  put(payloadSize);
  put(1);
  return buffer;
}

describe('SPK binary reader', () => {
  it('parses the DAF header and a SPK type 3 descriptor', () => {
    const file = SpkFile.fromBuffer(
      writeType3File({
        target: 399,
        center: 10,
        firstEt: 0,
        lastEt: 200,
        records: [
          { mid: 50, radius: 50, position: [10, 20, 30], velocity: [1, 2, 3] },
          { mid: 150, radius: 50, position: [100, 200, 300], velocity: [4, 5, 6] },
        ],
      }),
    );

    expect(file.segments).toEqual([
      {
        target: 399,
        center: 10,
        referenceFrame: 1,
        type: 3,
        firstEt: 0,
        lastEt: 200,
        firstAddress: DATA_FIRST_ADDRESS,
        lastAddress: 428,
      },
    ]);
  });

  it('evaluates the record selected by ET and returns type 3 velocity directly', () => {
    const file = SpkFile.fromBuffer(
      writeType3File({
        target: 399,
        center: 10,
        firstEt: 0,
        lastEt: 200,
        records: [
          { mid: 50, radius: 50, position: [10, 20, 30], velocity: [1, 2, 3] },
          { mid: 150, radius: 50, position: [100, 200, 300], velocity: [4, 5, 6] },
        ],
      }),
    );

    expect(file.evaluate(399, 10, 25)).toEqual({ pos: [10, 20, 30], vel: [1, 2, 3] });
    expect(file.evaluate(399, 10, 175)).toEqual({ pos: [100, 200, 300], vel: [4, 5, 6] });
  });

  it('differentiates a type 2 position polynomial for velocity', () => {
    const file = SpkFile.fromBuffer(writeType2File());
    expect(file.evaluate(399, 10, 50)).toEqual({ pos: [1, 2, 3], vel: [1 / 50, 0, 0] });
  });

  it('chains segments to reach a center the file never publishes directly', () => {
    // DE kernels publish Earth as 399/3 (Earth relative to the Earth-Moon
    // barycenter) and 3/0, never 399/0, so a barycentric Earth requires a path.
    const file = SpkFile.fromBuffer(
      writeType3File(
        {
          target: 399,
          center: 3,
          firstEt: 0,
          lastEt: 100,
          records: [{ mid: 50, radius: 50, position: [1, 2, 3], velocity: [0.5, 0.25, 0.125] }],
        },
        {
          target: 3,
          center: 0,
          firstEt: 0,
          lastEt: 100,
          records: [{ mid: 50, radius: 50, position: [10, 20, 30], velocity: [1, 2, 4] }],
        },
      ),
    );

    expect(file.evaluate(399, 0, 50)).toEqual({ pos: [11, 22, 33], vel: [1.5, 2.25, 4.125] });
    expect(file.segments).toHaveLength(2);
  });

  it('throws when no sequence of segments connects the requested bodies', () => {
    const file = SpkFile.fromBuffer(
      writeType3File({
        target: 399,
        center: 3,
        firstEt: 0,
        lastEt: 100,
        records: [{ mid: 50, radius: 50, position: [1, 2, 3], velocity: [1, 1, 1] }],
      }),
    );

    expect(() => file.evaluate(399, 10, 50)).toThrow('no SPK type 2/3 segment path');
  });

  it('rejects a buffer without the DAF/SPK ID word', () => {
    const bad = writeType2File();
    new Uint8Array(bad).fill(0, 0, 8);
    expect(() => SpkFile.fromBuffer(bad)).toThrow('not a DAF/SPK file');
  });

  it('rotates a J2000 segment into the simulation ecliptic frame', () => {
    const file = SpkFile.fromBuffer(
      writeType3File({
        target: 399,
        center: 10,
        firstEt: 0,
        lastEt: 200,
        records: [{ mid: 50, radius: 50, position: [0, 0, 1], velocity: [0, 1, 0] }],
      }),
    );

    const state = file.evaluateEcliptic(399, 10, 50);
    expect(state.pos[0]).toBeCloseTo(0, 15);
    expect(state.pos[1]).toBeCloseTo(Math.sin(OBLIQUITY_J2000_RAD), 15);
    expect(state.pos[2]).toBeCloseTo(Math.cos(OBLIQUITY_J2000_RAD), 15);
    expect(state.vel[1]).toBeCloseTo(Math.cos(OBLIQUITY_J2000_RAD), 15);
    expect(state.vel[2]).toBeCloseTo(-Math.sin(OBLIQUITY_J2000_RAD), 15);
  });
});

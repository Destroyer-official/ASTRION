import { OBLIQUITY_J2000_RAD } from '@/data/galaxy';
import { clenshaw, clenshawWithDerivative, type ChebyshevRecord } from './chebyshev';

const LOGICAL_RECORD_BYTES = 1_024;
const WORD_BYTES = 8;
const SPK_SUMMARY_DOUBLE_COUNT = 2;
const SPK_SUMMARY_INTEGER_COUNT = 6;

export interface SpkStateKm {
  readonly pos: readonly [number, number, number];
  readonly vel: readonly [number, number, number];
}

export interface SpkSegmentDescriptor {
  readonly target: number;
  readonly center: number;
  readonly referenceFrame: number;
  readonly type: number;
  readonly firstEt: number;
  readonly lastEt: number;
  readonly firstAddress: number;
  readonly lastAddress: number;
}

interface Type2Or3Directory {
  readonly init: number;
  readonly intervalLength: number;
  readonly recordPayloadSize: number;
  readonly recordCount: number;
}

/** A read-only parser for DAF/SPK files containing Chebyshev type 2 and 3 segments. */
export class SpkFile {
  private readonly view: DataView;
  private readonly littleEndian: boolean;
  readonly segments: readonly SpkSegmentDescriptor[];

  private constructor(view: DataView, littleEndian: boolean, segments: readonly SpkSegmentDescriptor[]) {
    this.view = view;
    this.littleEndian = littleEndian;
    this.segments = segments;
  }

  /**
   * Parses a DAF/SPK file. The layout is defined by NAIF's DAF and SPK
   * Required Reading documents (both last revised 2022-01-03; fetched 2026-11-05).
   */
  static fromBuffer(buffer: ArrayBuffer): SpkFile {
    if (buffer.byteLength < LOGICAL_RECORD_BYTES) throw new Error('SPK file is shorter than one DAF record');
    const view = new DataView(buffer);
    const id = readAscii(view, 0, 8);
    if (id !== 'DAF/SPK ') throw new Error(`not a DAF/SPK file: id is ${JSON.stringify(id)}`);

    const format = readAscii(view, 88, 8);
    if (format !== 'LTL-IEEE' && format !== 'BIG-IEEE') {
      throw new Error(`unsupported DAF numeric format: ${JSON.stringify(format)}`);
    }
    const littleEndian = format === 'LTL-IEEE';
    const nd = view.getInt32(8, littleEndian);
    const ni = view.getInt32(12, littleEndian);
    if (nd !== SPK_SUMMARY_DOUBLE_COUNT || ni !== SPK_SUMMARY_INTEGER_COUNT) {
      throw new Error(`expected an SPK DAF summary (ND=2, NI=6), got ND=${nd}, NI=${ni}`);
    }

    const firstSummaryRecord = view.getInt32(76, littleEndian);
    const segments: SpkSegmentDescriptor[] = [];
    let summaryRecord = firstSummaryRecord;
    const visited = new Set<number>();

    while (summaryRecord !== 0) {
      if (summaryRecord <= 0 || visited.has(summaryRecord) || buffer.byteLength < summaryRecord * LOGICAL_RECORD_BYTES) {
        throw new Error(`invalid DAF summary chain at record ${summaryRecord}`);
      }
      visited.add(summaryRecord);

      const recordBase = (summaryRecord - 1) * LOGICAL_RECORD_BYTES;
      const next = view.getFloat64(recordBase + WORD_BYTES * 0, littleEndian);
      const count = view.getFloat64(recordBase + WORD_BYTES * 2, littleEndian);
      if (!Number.isInteger(count) || count < 0 || count > 25) {
        throw new Error(`invalid summary count ${count} at record ${summaryRecord}`);
      }

      for (let i = 0; i < count; i++) {
        // Each summary is ND doubles followed by NI integers, packed two 4-byte
        // integers per 8-byte word. It occupies ND + floor(NI/2) double words.
        const summaryBase = recordBase + WORD_BYTES * (3 + i * (nd + Math.floor(ni / 2)));
        const doublesBase = summaryBase;
        const integersBase = doublesBase + nd * WORD_BYTES;
        segments.push({
          firstEt: view.getFloat64(doublesBase, littleEndian),
          lastEt: view.getFloat64(doublesBase + WORD_BYTES, littleEndian),
          target: view.getInt32(integersBase, littleEndian),
          center: view.getInt32(integersBase + 4, littleEndian),
          referenceFrame: view.getInt32(integersBase + 8, littleEndian),
          type: view.getInt32(integersBase + 12, littleEndian),
          firstAddress: view.getInt32(integersBase + 16, littleEndian),
          lastAddress: view.getInt32(integersBase + 20, littleEndian),
        });
      }
      summaryRecord = Math.trunc(next);
    }

    return new SpkFile(view, littleEndian, segments);
  }

  /**
   * Returns the geometric state of `target` relative to `center` in km and
   * km/s. `et` is ephemeris seconds past J2000 TDB. The state is expressed in
   * the frame declared by the selected SPK segment (normally J2000).
   */
  evaluate(target: number, center: number, et: number): SpkStateKm {
    return this.evaluateInReferenceFrame(target, center, et);
  }

  /**
   * Evaluates a NAIF J2000 segment and rotates it to the mean ecliptic frame
   * used by this application's Horizons-derived state vectors.
   */
  evaluateEcliptic(target: number, center: number, et: number): SpkStateKm {
    const state = this.evaluateInReferenceFrame(target, center, et, 1);
    return {
      pos: equatorialToEcliptic(state.pos),
      vel: equatorialToEcliptic(state.vel),
    };
  }

  private evaluateInReferenceFrame(
    target: number,
    center: number,
    et: number,
    referenceFrame?: number,
  ): SpkStateKm {
    if (target === center) return { pos: [0, 0, 0], vel: [0, 0, 0] };

    const direct = this.findSegment(target, center, et, referenceFrame);
    if (direct) return this.evaluateSegment(direct, et);

    // Many DE kernels publish each body relative to the SSB only. Combine two
    // barycentric states to obtain the requested geometric state.
    if (center !== 0) {
      const targetSegment = this.findSegment(target, 0, et, referenceFrame);
      const centerSegment = this.findSegment(center, 0, et, referenceFrame);
      if (targetSegment && centerSegment) {
        const targetValue = this.evaluateSegment(targetSegment, et);
        const centerValue = this.evaluateSegment(centerSegment, et);
        return {
          pos: [
            targetValue.pos[0]! - centerValue.pos[0]!,
            targetValue.pos[1]! - centerValue.pos[1]!,
            targetValue.pos[2]! - centerValue.pos[2]!,
          ],
          vel: [
            targetValue.vel[0]! - centerValue.vel[0]!,
            targetValue.vel[1]! - centerValue.vel[1]!,
            targetValue.vel[2]! - centerValue.vel[2]!,
          ],
        };
      }
    }
    throw new Error(`no SPK type 2/3 segment covers target ${target} relative to center ${center} at ET ${et}`);
  }

  private findSegment(
    target: number,
    center: number,
    et: number,
    referenceFrame?: number,
  ): SpkSegmentDescriptor | undefined {
    // SPICE gives later segments priority. Summary records are appended forward,
    // so scan backward through their natural order.
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const segment = this.segments[i]!;
      if (
        segment.target !== target ||
        segment.center !== center ||
        (referenceFrame !== undefined && segment.referenceFrame !== referenceFrame) ||
        (segment.type !== 2 && segment.type !== 3)
      ) {
        continue;
      }
      if (et >= segment.firstEt && et <= segment.lastEt) return segment;
    }
    return undefined;
  }

  /** Reads and evaluates the record containing `et`, or clamps to the segment boundary. */
  evaluateSegment(segment: SpkSegmentDescriptor, et: number): SpkStateKm {
    const directory = this.readDirectory(segment);
    const clampedEt = Math.max(segment.firstEt, Math.min(segment.lastEt, et));
    const interval = Math.floor((clampedEt - directory.init) / directory.intervalLength);
    const recordIndex = Math.max(0, Math.min(directory.recordCount - 1, interval));
    const wordsPerRecord = directory.recordPayloadSize;
    const recordByteOffset = (segment.firstAddress - 1 + recordIndex * wordsPerRecord) * WORD_BYTES;
    if (recordByteOffset + directory.recordPayloadSize * WORD_BYTES > this.view.byteLength) {
      throw new Error('SPK segment address range extends beyond the file');
    }

    const mid = this.readFloat64(recordByteOffset);
    const radius = this.readFloat64(recordByteOffset + WORD_BYTES);
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('SPK record has an invalid time radius');
    const tau = Math.max(-1, Math.min(1, (clampedEt - mid) / radius));

    if (segment.type === 3) {
      const coefficientCount = (directory.recordPayloadSize - 2) / 6;
      if (!Number.isInteger(coefficientCount) || coefficientCount < 1) {
        throw new Error('SPK type 3 record has an invalid coefficient count');
      }
      const data = recordByteOffset + 2 * WORD_BYTES;
      const pos: [number, number, number] = [0, 0, 0];
      const vel: [number, number, number] = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        pos[axis] = clenshaw(tau, this.readCoefficients(data + axis * coefficientCount * WORD_BYTES, coefficientCount));
        vel[axis] = clenshaw(
          tau,
          this.readCoefficients(data + (axis + 3) * coefficientCount * WORD_BYTES, coefficientCount),
        );
      }
      return { pos, vel };
    }

    const coefficientCount = (directory.recordPayloadSize - 2) / 3;
    if (!Number.isInteger(coefficientCount) || coefficientCount < 1) {
      throw new Error('SPK type 2 record has an invalid coefficient count');
    }
    const record: ChebyshevRecord = {
      tStart: mid - radius,
      tEnd: mid + radius,
      cx: this.readCoefficients(recordByteOffset + 2 * WORD_BYTES, coefficientCount),
      cy: this.readCoefficients(recordByteOffset + (2 + coefficientCount) * WORD_BYTES, coefficientCount),
      cz: this.readCoefficients(recordByteOffset + (2 + 2 * coefficientCount) * WORD_BYTES, coefficientCount),
    };
    const x = clenshawWithDerivative(tau, 2 * radius, record.cx);
    const y = clenshawWithDerivative(tau, 2 * radius, record.cy);
    const z = clenshawWithDerivative(tau, 2 * radius, record.cz);
    return {
      pos: [x.pos, y.pos, z.pos],
      vel: [x.vel, y.vel, z.vel],
    };
  }

  private readDirectory(segment: SpkSegmentDescriptor): Type2Or3Directory {
    const words = segment.lastAddress - segment.firstAddress + 1;
    if (words < 4) throw new Error('SPK type 2/3 segment is too small');
    const tail = (segment.lastAddress - 4) * WORD_BYTES;
    const init = this.readFloat64(tail);
    const intervalLength = this.readFloat64(tail + WORD_BYTES);
    const recordPayloadSize = this.readFloat64(tail + 2 * WORD_BYTES);
    const recordCount = this.readFloat64(tail + 3 * WORD_BYTES);
    if (
      !Number.isInteger(intervalLength) ||
      intervalLength <= 0 ||
      !Number.isInteger(recordPayloadSize) ||
      recordPayloadSize <= 0 ||
      !Number.isInteger(recordCount) ||
      recordCount <= 0
    ) {
      throw new Error('SPK type 2/3 directory contains non-positive or fractional values');
    }
    const expectedWords = recordCount * recordPayloadSize + 4;
    if (expectedWords !== words) {
      throw new Error(`SPK directory declares ${expectedWords} words, but the segment contains ${words}`);
    }
    return { init, intervalLength, recordPayloadSize, recordCount };
  }

  private readCoefficients(byteOffset: number, count: number): number[] {
    const result = new Array<number>(count);
    for (let i = 0; i < count; i++) result[i] = this.readFloat64(byteOffset + i * WORD_BYTES);
    return result;
  }

  private readFloat64(byteOffset: number): number {
    return this.view.getFloat64(byteOffset, this.littleEndian);
  }
}

function equatorialToEcliptic(v: readonly [number, number, number]): [number, number, number] {
  const cos = Math.cos(OBLIQUITY_J2000_RAD);
  const sin = Math.sin(OBLIQUITY_J2000_RAD);
  return [v[0], cos * v[1] + sin * v[2], -sin * v[1] + cos * v[2]];
}

function readAscii(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  return String.fromCharCode(...bytes);
}

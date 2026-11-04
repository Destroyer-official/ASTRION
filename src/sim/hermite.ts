/** Cubic Hermite between (t0,p0,v0) and (t1,p1,v1). Works for t1 < t0 (backward time).
 * Evaluates both exact positions and analytical velocities (dp/dt).
 */
export function hermite(
  t0: number,
  p0: Float64Array,
  v0: Float64Array,
  t1: number,
  p1: Float64Array,
  v1: Float64Array,
  t: number,
  outPos: Float64Array,
  outVel?: Float64Array,
): void {
  const h = t1 - t0;
  if (h === 0) {
    outPos.set(p1);
    if (outVel) outVel.set(v1);
    return;
  }
  const s = (t - t0) / h,
    s2 = s * s,
    s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1,
    h10 = s3 - 2 * s2 + s,
    h01 = -2 * s3 + 3 * s2,
    h11 = s3 - s2;
  for (let k = 0; k < outPos.length; k++) {
    outPos[k] = h00 * p0[k]! + h10 * h * v0[k]! + h01 * p1[k]! + h11 * h * v1[k]!;
  }
  if (outVel) {
    const invH = 1 / h;
    const dh00 = (6 * s2 - 6 * s) * invH;
    const dh01 = (-6 * s2 + 6 * s) * invH;
    const dh10_scaled = 3 * s2 - 4 * s + 1;
    const dh11_scaled = 3 * s2 - 2 * s;
    for (let k = 0; k < outVel.length; k++) {
      outVel[k] = dh00 * p0[k]! + dh01 * p1[k]! + dh10_scaled * v0[k]! + dh11_scaled * v1[k]!;
    }
  }
}


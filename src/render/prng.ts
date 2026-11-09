/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Enables reproducible visuals, procedural textures, and visual regression testing (AUDIT-35).
 */
export function createPrng(seed = 0x2f6e2b1): () => number {
  let s = seed | 0;
  return function rand(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


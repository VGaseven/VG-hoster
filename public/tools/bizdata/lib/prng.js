// Seeded randomness so every scenario, Monte Carlo run and realized outcome can be replayed exactly.

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive. */
export const randInt = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));

/** Triangular distribution sample with minimum a, mode c, maximum b. */
export function triangular(u, a, c, b) {
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** Standard normal sample (Box-Muller). */
export function normal(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

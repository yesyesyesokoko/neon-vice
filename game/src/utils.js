// Small math helpers shared by Neon Vice modules. No dependencies.

// Deterministic pseudo-random generator (mulberry32). Same seed, same stream,
// so replays and tests stay stable.
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

// Wrap an angle to (-PI, PI] so turns always take the short way round.
export function wrapAngle(angle) {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  if (a > Math.PI) a -= twoPi;
  return a;
}

// Shortest signed turn from `from` toward `to`, in radians.
export function angleDelta(from, to) {
  return wrapAngle(to - from);
}

// Ease a heading toward a target heading without overshooting.
export function turnToward(current, target, maxStep) {
  const d = angleDelta(current, target);
  return current + clamp(d, -maxStep, maxStep);
}

// Flat (x, z) distance between two points with x/z fields.
export function dist2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// Full 3D distance between two points with x/y/z fields.
export function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

// Pick a random entry from an array using a supplied rng (defaults to Math.random).
export function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

// The master island seed. Everything procedural that defines *this island*
// (shoreline, terrain noise, surge zones, cay bearing, palms, scatter, fauna
// homes) derives its own sub-seed from the master via subSeed('name'), so a
// given seed always regrows the exact same island.
//
// Resolution order: ?seed=N in the URL wins; otherwise the curated default
// island. Fresh islands come from the ⟳ new-island button (R), which pins
// each roll into ?seed= so it stays shareable.

export const DEFAULT_SEED = 2281;

// a retired "random island every load" toggle once persisted here — sweep
// the stale key from returning visitors (this cleanup can go away someday)
try { window.localStorage.removeItem('cove-random-seed'); } catch (_) { /* blocked storage — fine */ }

const params = new URLSearchParams(window.location.search);

let master = DEFAULT_SEED;
if (params.has('seed')) {
  const n = parseInt(params.get('seed'), 10);
  if (Number.isFinite(n)) master = n >>> 0;
}

export function getSeed() {
  return master;
}

export function setSeed(s) {
  master = s >>> 0;
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// Show the live seed in the address bar (replaceState: no history spam), so
// the island you are standing on is always a copy-pasteable link.
export function writeSeedParam(s) {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(s >>> 0));
  window.history.replaceState(null, '', url);
}

// FNV/xxhash-flavored mix of the master seed and a domain name
export function subSeed(name) {
  let h = (master ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 2246822519) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2654435761) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

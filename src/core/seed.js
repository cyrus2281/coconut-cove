// The master island seed. Everything procedural that defines *this island*
// (shoreline, terrain noise, surge zones, cay bearing, palms, scatter, fauna
// homes) derives its own sub-seed from the master via subSeed('name'), so a
// given seed always regrows the exact same island.
//
// Resolution order: ?seed=N in the URL wins; otherwise the default island.
// The title screen offers a "random island" toggle that reseeds live.

export const DEFAULT_SEED = 2281;
export const RANDOM_PREF_KEY = 'cove-random-seed';

const params = new URLSearchParams(window.location.search);
export const SEED_FROM_URL = params.has('seed');

// ?seed=N wins; otherwise a sticky "random island" preference rolls a fresh
// seed on every page load; otherwise the curated default island.
let master = DEFAULT_SEED;
if (SEED_FROM_URL) {
  const n = parseInt(params.get('seed'), 10);
  if (Number.isFinite(n)) master = n >>> 0;
} else if (window.localStorage.getItem(RANDOM_PREF_KEY) === '1') {
  master = randomSeed();
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

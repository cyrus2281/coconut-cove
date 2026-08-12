// The master island seed. Everything procedural that defines *this island*
// (shoreline, terrain noise, surge zones, cay bearing, palms, scatter, fauna
// homes) derives its own sub-seed from the master via subSeed('name'), so a
// given seed always regrows the exact same island.
//
// Resolution order: ?seed=N in the URL wins; otherwise the default island.
// The title screen offers a "random island" toggle that reseeds live.

export const DEFAULT_SEED = 2281;
export const RANDOM_PREF_KEY = 'cove-random-seed';

// storage can be blocked (private windows, strict privacy settings) — the
// toggle then still works for the visit, it just won't stick
export function readRandomPref() {
  try {
    return window.localStorage.getItem(RANDOM_PREF_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function writeRandomPref(on) {
  try {
    if (on) window.localStorage.setItem(RANDOM_PREF_KEY, '1');
    else window.localStorage.removeItem(RANDOM_PREF_KEY);
  } catch (_) { /* not persistable — fine */ }
}

const params = new URLSearchParams(window.location.search);
export const SEED_FROM_URL = params.has('seed');

// ?seed=N wins; otherwise the sticky "random island" preference rolls a
// fresh seed on every page load; otherwise the curated default island.
let master = DEFAULT_SEED;
if (SEED_FROM_URL) {
  const n = parseInt(params.get('seed'), 10);
  if (Number.isFinite(n)) master = n >>> 0;
} else if (readRandomPref()) {
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

// Show the live seed in the address bar (replaceState: no history spam), so
// the island you are standing on is always a copy-pasteable link. Clearing
// the param hands the next page load back to the random-island preference.
export function writeSeedParam(s) {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(s >>> 0));
  window.history.replaceState(null, '', url);
}

export function clearSeedParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('seed');
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

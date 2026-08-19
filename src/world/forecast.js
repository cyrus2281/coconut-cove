// The forecast: which sky comes next. Pure data and arithmetic — no three.js,
// no DOM — so the tables can be tuned and sanity-checked headless.
//
// Base weights are sunny-heavy (a tropical island earns its postcards), and
// the sky that's just ended bends the next roll through the affinity table:
// a squall likes to leave mist hanging over the water, a gray lid likes to
// start drizzling, a sunshower likes to hand the day back to the sun. The
// sunny floor guarantees a run of bad rolls can never starve the good days.

export const WEATHER_IDS = [
  'sunny', 'breezy', 'overcast', 'mist', 'drizzle', 'squall', 'thunder', 'sunshower',
];

export const BASE_WEIGHT = {
  sunny: 0.34,
  breezy: 0.13,
  overcast: 0.11,
  mist: 0.08,
  drizzle: 0.11,
  squall: 0.10,
  thunder: 0.05,
  sunshower: 0.08,
};

// AFFINITY[prev][next] multiplies BASE_WEIGHT[next] when `prev` has just
// ended. Rows read as little stories: after rain the air hangs heavy (mist
// up, another squall down); a gray lid either thickens or breaks; thunder
// rarely strikes the same afternoon twice.
export const AFFINITY = {
  sunny:     { sunny: 1.3, breezy: 1.1, overcast: 0.9, mist: 0.5, drizzle: 0.8, squall: 0.9, thunder: 0.6, sunshower: 0.9 },
  breezy:    { sunny: 1.0, breezy: 1.2, overcast: 1.2, mist: 0.4, drizzle: 1.0, squall: 1.3, thunder: 0.9, sunshower: 0.8 },
  overcast:  { sunny: 0.8, breezy: 1.0, overcast: 1.2, mist: 1.3, drizzle: 1.6, squall: 1.3, thunder: 1.1, sunshower: 0.7 },
  mist:      { sunny: 1.2, breezy: 0.5, overcast: 1.3, mist: 1.1, drizzle: 1.2, squall: 0.8, thunder: 0.5, sunshower: 0.8 },
  drizzle:   { sunny: 0.9, breezy: 0.9, overcast: 1.3, mist: 1.4, drizzle: 1.1, squall: 1.4, thunder: 1.1, sunshower: 1.1 },
  squall:    { sunny: 0.9, breezy: 1.1, overcast: 1.1, mist: 1.8, drizzle: 1.2, squall: 0.6, thunder: 1.2, sunshower: 1.5 },
  thunder:   { sunny: 0.8, breezy: 1.2, overcast: 1.0, mist: 1.5, drizzle: 1.3, squall: 1.3, thunder: 0.5, sunshower: 1.3 },
  sunshower: { sunny: 1.4, breezy: 1.0, overcast: 0.8, mist: 0.9, drizzle: 0.9, squall: 0.7, thunder: 0.5, sunshower: 0.7 },
};

// however the affinities stack up, a sunny day always keeps at least this
// much of the next roll
export const SUNNY_FLOOR = 0.18;

// fresh islands greet you kindly: extra sunny, and rarely mid-thunderstorm
export const ARRIVAL_BIAS = { sunny: 2.0, mist: 0.7, squall: 0.7, thunder: 0.45 };

// normalized next-weather probabilities after `prev`, floor applied
export function transitionOdds(prev) {
  const aff = AFFINITY[prev] ?? {};
  const odds = {};
  let sum = 0;
  for (const id of WEATHER_IDS) {
    odds[id] = BASE_WEIGHT[id] * (aff[id] ?? 1);
    sum += odds[id];
  }
  for (const id of WEATHER_IDS) odds[id] /= sum;
  if (odds.sunny < SUNNY_FLOOR) {
    const k = (1 - SUNNY_FLOOR) / (1 - odds.sunny);
    for (const id of WEATHER_IDS) odds[id] *= k;
    odds.sunny = SUNNY_FLOOR;
  }
  return odds;
}

export function pickFrom(odds, roll) {
  let acc = 0;
  for (const id of WEATHER_IDS) {
    acc += odds[id];
    if (roll < acc) return id;
  }
  return 'sunny'; // float dust at the top of the ladder lands on the default
}

export function pickNext(prev, roll) {
  return pickFrom(transitionOdds(prev), roll);
}

export function pickArrival(roll) {
  const odds = {};
  let sum = 0;
  for (const id of WEATHER_IDS) {
    odds[id] = BASE_WEIGHT[id] * (ARRIVAL_BIAS[id] ?? 1);
    sum += odds[id];
  }
  for (const id of WEATHER_IDS) odds[id] /= sum;
  return pickFrom(odds, roll);
}

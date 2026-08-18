// The rules that keep everything that swims in the water: under the surface,
// and out of the sand.
//
// Every swimmer in the cove works out its own height from the sea floor under
// it and the water level over it, and every one of them used to end with the
// same shape of clamp: clamp(y, floor + a, tide - b). That reads as a limit but
// is not one. Where the water is thinner than a + b — over the sandbar cay, on
// a shoal, at low tide — the floor rises above the ceiling, and a clamp whose
// min exceeds its max returns the min. The floor wins and the animal is lifted
// clean out of the sea. That is how a blacktip ends up cruising through the air
// above the cay.
//
// Both limits are enforced here instead, for every one of them, against the
// body's own measured extents rather than a number somebody wrote down:
//
//   * the ceiling is the water the shader actually draws (waves and all, see
//     seaSurfaceY), less however far the animal reaches above its origin — a
//     creature's position is its midline, not its dorsal fin;
//   * the floor is the sand, less however far it reaches below that origin, so
//     it rests its belly on the bottom instead of swimming down through it;
//   * where the column is thinner than the animal, neither can be honoured, so
//     the error is split evenly between them: half a hair of back above the
//     water, half a hair of belly in the sand, both shrinking as the brains
//     steer the animal back out (see deeperDir, and its callers in sealife.js).
//     That case should be brief and rare; if it ever reads as a bug on screen,
//     the fix belongs in the steering, not in these clamps.

import { islandHeight } from './island.js';
import { seaSurfaceY } from './water.js';

// A few centimetres of slack at both limits: seaSurfaceY mirrors the swell's
// rise and fall but not the sideways roll of a Gerstner crest, and the terrain
// mesh only samples the height field at its vertices, so a body held exactly
// tangent to either could still show through.
const SKIN = 0.03;

// The clearances a body needs, in metres at scale 1: `rise` above its origin,
// `sink` below it, and `clear` for how far off the bottom this animal likes to
// swim when there is room for it. `pad` is added to both extents for whatever
// the rest pose does not show — a fin beating in the vertex shader, a spine
// flexing on the CPU, a body banking into a turn.
export function swimBody(rise, sink, clear, pad = 0) {
  return { rise: rise + pad, sink: sink + pad, clear };
}

// The same, measured off a geometry. Every creature here is modelled around its
// own midline, so its bounding box is exactly what the clamps want to know, and
// measuring beats writing the numbers down: they then follow the model.
export function bodyFromGeometry(geo, clear, pad = 0) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  return swimBody(box.max.y, -box.min.y, clear, pad);
}

// The highest a body's origin may sit over (x, z): the underside of the water,
// with room for the back. `size` is the creature's scale.
export function swimCeiling(x, z, ground, body, size = 1) {
  return seaSurfaceY(x, z, ground) - body.rise * size - SKIN;
}

// The lowest: belly on the sand.
export function swimBed(ground, body, size = 1) {
  return ground + body.sink * size + SKIN;
}

// Hold a swimmer between the two. Clamp anything that persists across frames (a
// smoothed height, an integrated drift) *after* smoothing as well, or the lag
// walks it back out through the surface as the tide or the swell falls away.
export function holdUnder(want, x, z, ground, body, size = 1) {
  const ceil = swimCeiling(x, z, ground, body, size);
  const bed = swimBed(ground, body, size);
  if (ceil <= bed) return (ceil + bed) / 2; // no room for this animal: share the error
  const floor = Math.min(bed + body.clear, ceil);
  return Math.min(Math.max(want, floor), ceil);
}

// How much water this spot has to spare for this body: negative means it cannot
// hold the animal at all, which is the brains' cue to go and find deeper water.
export function swimRoom(x, z, ground, body, size = 1) {
  return swimCeiling(x, z, ground, body, size) - swimBed(ground, body, size);
}

// Which way the sea floor falls away at (x, z), as a unit vector written into
// `out` (a THREE.Vector2, x/y = world x/z). For swimmers that have to go find
// deeper water rather than wait to be squeezed between the sand and the sky.
// Left at zero length where the floor is flat.
export function deeperDir(x, z, out, step = 2.5) {
  const gx = islandHeight(x + step, z) - islandHeight(x - step, z);
  const gz = islandHeight(x, z + step) - islandHeight(x, z - step);
  const m = Math.hypot(gx, gz);
  if (m < 1e-6) return out.set(0, 0);
  return out.set(-gx / m, -gz / m);
}

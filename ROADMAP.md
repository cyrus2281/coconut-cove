# Coconut Cove — feature roadmap

Ordered by dependency: tides are the foundation several features reference
(islet walkability, wave push, turtle waterline, fish depth); fauna reuses the
footprint decal system; audio spatializes last so every sound source exists;
the seed generator lands last so it regenerates everything above it (each new
module is written seed-ready along the way).

- [x] **Phase 1 — Night & horizon charm**
  - [x] Bioluminescent night surf: `uNightF` uniform from sun elevation; foam/swash glows electric cyan in the water shader; a glowing strip chases the retreating swash on the sand
  - [x] Shooting stars: pooled additive streak sprites, random spawns at night (`__beach.sky.meteor(dur, az)` to force one)
  - [x] Distant sailboat: procedural sloop circling at ~640 m, bob + heel, masthead light after dark
- [x] **Phase 2 — Tides**: semidiurnal `uTide` (A=0.45 m, two cycles per 12-min day, `tideFromTod`); ocean lift, tide-aware depth terms, swash heights relative to the live waterline, `sw_tideSince` falling-tide damp apron (dries ~3× slower than swash), player wade/prints + crab band follow the tide; `__beach.tide()`
- [x] **Phase 3 — Offshore sandbar islet**: cay at az 0.95, ~38 m past the shoreline (crown ≈ +0.25 m, smooth-max dome); a tenth of all shell/pebble scatter washes up on it; verified wadeable at low tide (crossed to r=99), cut off at high (blocked at r=55)
- [ ] **Phase 4 — Wave push physics**: analytic swash velocity (d/dt of run-up) shoves the player up-beach on the bore, drags seaward on the backwash, scaled by submersion
- [ ] **Phase 5 — Beach life**
  - [ ] Crab footprint trails: footprint atlas + per-instance kind (human/crab/turtle), crabs stamp tiny tracks
  - [ ] Fish schools: 2 instanced schools patrolling the shelf (depth 0.6–2.5 m, tide-aware), burst-flee from the wading player
  - [ ] Gulls that land: soar → glide in → land (folded wings) → hop/peck → flush when approached
- [ ] **Phase 6 — Sea turtle at night**: on random nights swim in → haul out → dig (sand flicks + pit) → rest → return before dawn; wide track pairs the tide erases
- [ ] **Phase 7 — Passing rain squall**: weather director (clear → building → squall → clearing), instanced rain streaks, gray dimpled water, whole-island wetting via `uRainWet`, rain audio layer
- [ ] **Phase 8 — Positional audio**: stereo-panned distance-based surf/wind, palm rustle under crowns, synthesized gull cries, rain overhead
- [ ] **Phase 9 — Seeded island generator**: master seed (`?seed=` else default) hashed into sub-seeds for shoreline/terrain/palms/scatter/zones/cay/fauna; `buildWorld(seed)`/`disposeWorld()` refactor; "Use random seed" toggle on the title screen (rebuilds live, URL untouched); seed shown for sharing

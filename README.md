# Mt Hood Digital Twin

An interactive 3D model of Mt Hood, Oregon at true 1:1 scale in winter, built to become the foundation of a ski game. It runs in the browser with Three.js.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Terrain and winter environment | Live and checked against real data |
| 2 | Resorts, runs, lodges and buildings | Live: 427 run segments, 1,135 buildings shaped from lidar. Not yet done: hand-detailed landmark buildings, parking lots, 3D trees |
| 3 | Lifts, moving at real speed | Magic Mile pilot live (chairs, towers, rope; stations not yet). Awaiting sign-off before the other lifts. Record: `public/data/lifts.json`, references: `references/README.md` |

## Run it

```
npm install
npm run dev      # local development
npm run build    # production build in dist/
```

Live site: https://spax0530.github.io/mt-hood-twin/

`npm run deploy` builds the site and publishes it to the `gh-pages` branch, which GitHub Pages serves.

## Controls

Drag to orbit, scroll to zoom, right-drag to pan. WASD or arrow keys fly across the mountain, Shift goes faster. The panel has a jump-to menu, quality setting and time of day.

URL options: `?at=timberline` starts at a place from `public/data/places.json`, `?q=high` sets quality.

## How scale works

The world is in real meters with the summit at the origin: X is east, Y is up, Z is south. Latitude and longitude are converted with the WGS84 ellipsoid (`src/geo.ts`), accurate to roughly 1 part in 100,000 across the mountain. The "Summit check" readout samples the highest ground near the summit coordinates and compares it with the surveyed 3,429 m (11,249 ft).

Earth curvature is not modeled. Across the 30 km scene that is a drop of under 20 m at the far edges and has no effect on distances within a resort.

## Code layout

- `src/config.ts`: data sources, covered area, quality presets
- `src/geo.ts`: coordinate conversion
- `src/terrain/`: tile loading, level-of-detail quadtree, winter surface shader, ground height queries
- `src/environment/`: sky, sun, haze
- `src/camera/`: orbit and fly controls, jump-to
- `src/ui/`: on-screen panel and readouts
- `public/data/`: data files (places now; runs, buildings and lifts later), kept separate from rendering

## Known limits right now

- Elevation is 10 m source data across the mountain. On High quality, ground near the camera is requested from the USGS lidar service at up to 0.8 m per sample. The "Ground detail" readout shows which one you are looking at.
- Buildings have real footprints and lidar-measured heights and roof shapes, but generic wall colors and no windows or doors yet.
- Runs come from OpenStreetMap and have not yet been cross-checked against each resort's current trail map.
- The aerial imagery is from summer. Winter snow, rock and forest are drawn by a shader that uses elevation, steepness and where the imagery shows tree canopy. Forest is a surface texture for now, not individual 3D trees.
- The terrain does not yet cast shadows onto itself.

## Notes for a future game engine port

- All positions are plain meters in a right-handed, Y-up frame, the same convention as Godot and close to Unity (flip Z) and Unreal (centimeters, Z-up).
- Data lives in JSON under `public/data/`, independent of Three.js.
- `Terrain.heightAt(x, z)` is the single source of ground height, which is what physics, lift towers and buildings will use.

See `DATA_SOURCES.md` for every dataset and its license.

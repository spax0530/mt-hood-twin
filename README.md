# Mt Hood Digital Twin

An interactive 3D model of Mt Hood, Oregon at true 1:1 scale in winter, built to become the foundation of a ski game. It runs in the browser with Three.js.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Terrain and winter environment | Live, first check against real data in progress |
| 2 | Resorts, runs, lodges and buildings | Not started |
| 3 | Lifts, moving at real speed | Not started |

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

- Elevation is streamed at about 5 to 10 m detail. 1 m lidar for the whole mountain is too large to stream to a browser. The plan is to bake 1 m lidar for the resort areas only when detail there starts to matter (buildings and lifts).
- The aerial imagery is from summer. Winter snow, rock and forest are drawn by a shader that uses elevation, steepness and where the imagery shows tree canopy. Forest is a surface texture for now, not individual 3D trees.
- The terrain does not yet cast shadows onto itself.

## Notes for a future game engine port

- All positions are plain meters in a right-handed, Y-up frame, the same convention as Godot and close to Unity (flip Z) and Unreal (centimeters, Z-up).
- Data lives in JSON under `public/data/`, independent of Three.js.
- `Terrain.heightAt(x, z)` is the single source of ground height, which is what physics, lift towers and buildings will use.

See `DATA_SOURCES.md` for every dataset and its license.

# Data sources

Every dataset and reference used, with license. Updated each phase.

## Elevation

- **AWS Terrain Tiles** (Mapzen "terrarium" format), `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
  - Registry page: https://registry.opendata.aws/terrain-tiles/
  - In the United States these tiles are built from USGS 3DEP elevation data (public domain). Attribution requested by the tile set is listed at https://github.com/tilezen/joerd/blob/master/docs/attribution.md
  - Used at zoom 11 to 15. Native detail over Mt Hood is about 10 m or better; zoom 15 is partly interpolated.
  - Status: confirmed working on the live site (summit reads 3,427 m against 3,429 m surveyed).

- **USGS 3DEP dynamic elevation service**, `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`
  - Public domain. Serves the best elevation data available at each spot, including 1 m lidar where it has been flown.
  - Used near the camera at zoom 15 to 17 (about 3.4 m down to 0.8 m per sample). If it does not answer, the app falls back to the tiles above and says so in the "Ground detail" readout.
  - Bare-earth data: it shows the ground, not buildings or trees.
  - Status: tested only against a stand-in server. Whether Mt Hood has 1 m coverage in this service is still to be confirmed on the live site.

## Imagery

- **USGS National Map, USGSImageryOnly**, `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer`
  - Public domain (US Geological Survey). Mostly NAIP summer aerial photography.
  - Used only to detect tree canopy versus open ground; the visible winter surface is generated.

## Reference values

- Mt Hood summit: 45.3736 N, 121.6958 W, 3,429 m (11,249 ft). Older surveys give 11,239 to 11,240 ft. To be confirmed against the USGS/NGS datasheet.
- Treeline is modeled at about 1,850 m (6,000 ft) with natural variation. To be tuned against winter photos.
- Winter sun path is approximated for mid-winter at 45.4 N (peak elevation about 22 degrees).

## Runs, lifts and buildings

- **OpenStreetMap** (c) OpenStreetMap contributors, Open Database License (ODbL). Fetched 2026-11-17 through the Overpass API (overpass.openstreetmap.fr) for the area 45.20 to 45.52 N, 121.92 to 121.48 W.
  - `public/data/osm.json`: 427 ski run segments (309 named), 36 lift lines with tower positions, 1,135 building footprints, 74 parking areas, 3 resort boundaries.
  - Rebuild it with `public/tools/fetch-data.html` (open the page on the live site and press the button).
  - Not yet cross-checked against the resorts' current trail maps.
- **Oregon DOGAMI lidar** image services at `https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/` (Oregon Department of Geology and Mineral Industries, public data).
  - Canopy height model: building heights above ground.
  - Digital surface model: roof shapes for 209 large, complex or named buildings, sampled at about 1 m.
  - On small buildings under trees the lidar reads the tree, so heights there are capped to a plausible value for the footprint.

## Resorts

- `public/data/resorts.json` lists the five ski areas confirmed operating, with the sources used.

## Software

- three.js (MIT), Vite (MIT), TypeScript (Apache 2.0)

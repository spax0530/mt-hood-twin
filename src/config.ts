// All tunable settings and data source URLs live here.

const params = new URLSearchParams(location.search);

export const SOURCES = {
  // Elevation: AWS Terrain Tiles (Mapzen "terrarium" encoding), built from USGS 3DEP in the US.
  dem: params.get('dem') ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  // Sharper elevation near the camera: USGS 3DEP dynamic service (1 m lidar where it exists).
  lidar:
    params.get('lidar') ??
    'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage',
  // Aerial imagery: USGS National Map (public domain).
  img:
    params.get('img') ??
    'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
};

/** Area streamed: the whole mountain plus surrounding valleys. */
export const BOUNDS = { south: 45.2, north: 45.52, west: -121.92, east: -121.48 };
export const ROOT_Z = 11;
/** Deepest zoom of the pre-made elevation tiles; finer levels come from the lidar service. */
export const TILE_DEM_MAX_Z = 15;
/** From this zoom on, ask the lidar service first. */
export const LIDAR_MIN_Z = 15;
/** Deepest zoom of the cached aerial imagery. */
export const IMG_MAX_Z = 16;

export const SUMMIT = { lat: 45.373611, lon: -121.695833, elevM: 3429 };

export type QualityName = 'low' | 'medium' | 'high';
export interface Quality {
  grid: number; // mesh cells per tile side
  maxZ: number; // deepest elevation tile zoom
  split: number; // refine a tile when the camera is closer than split * tile width
  imgZoomOffset: number; // imagery sharper than the terrain tile by this many zoom levels
  pixelRatio: number;
}
export const QUALITY: Record<QualityName, Quality> = {
  low: { grid: 64, maxZ: 13, split: 1.6, imgZoomOffset: 0, pixelRatio: 1 },
  medium: { grid: 128, maxZ: 15, split: 2.2, imgZoomOffset: 1, pixelRatio: 1.5 },
  high: { grid: 128, maxZ: 17, split: 2.6, imgZoomOffset: 1, pixelRatio: 2 },
};

export const initialQuality = (params.get('q') as QualityName) in QUALITY
  ? (params.get('q') as QualityName)
  : 'medium';

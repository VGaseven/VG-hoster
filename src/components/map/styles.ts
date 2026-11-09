import type { StyleSpecification } from 'maplibre-gl';

export type BaseStyle = 'dark' | 'light' | 'satellite' | 'offline';

const env = import.meta.env;
export const BASEMAP_DARK: string = env.VITE_BASEMAP_DARK || 'https://tiles.openfreemap.org/styles/dark';
export const BASEMAP_LIGHT: string = env.VITE_BASEMAP_LIGHT || 'https://tiles.openfreemap.org/styles/positron';
export const SATELLITE_TILES: string = env.VITE_SATELLITE_TILES || '';
export const SATELLITE_ATTRIBUTION: string = env.VITE_SATELLITE_ATTRIBUTION || '';
export const TERRAIN_TILES: string = env.VITE_TERRAIN_TILES || '';
export const TERRAIN_ENCODING: 'terrarium' | 'mapbox' = (env.VITE_TERRAIN_ENCODING as 'terrarium' | 'mapbox') || 'terrarium';

export const satelliteAvailable = () => !!SATELLITE_TILES;
export const terrainAvailable = () => !!TERRAIN_TILES;

/** Built-in offline "digital twin" style — no network required. */
export function offlineStyle(theme: 'dark' | 'light' = 'dark'): StyleSpecification {
  return {
    version: 8,
    name: 'RASD offline twin',
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#0b1220' : '#e8edf3' } }],
  };
}

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      sat: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, attribution: SATELLITE_ATTRIBUTION },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
      { id: 'sat', type: 'raster', source: 'sat' },
    ],
  };
}

export function styleFor(s: BaseStyle): string | StyleSpecification {
  if (s === 'offline' || BASEMAP_DARK === 'offline') return offlineStyle('dark');
  if (s === 'satellite') return SATELLITE_TILES ? satelliteStyle() : offlineStyle('dark');
  if (s === 'light') return BASEMAP_LIGHT;
  return BASEMAP_DARK;
}

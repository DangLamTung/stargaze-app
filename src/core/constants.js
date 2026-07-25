/**
 * Shared constants — single source of truth for magic values across the codebase.
 */
export const STELLARIUM_DATA_BASE = '/test-skydata/';

export const STELLARIUM_CATALOGS = [
  { type: 'stars', url: 'stars' },
  { type: 'skycultures', url: 'skycultures/western', key: 'western' },
  { type: 'dsos', url: 'dso' },
  { type: 'milkyway', url: 'surveys/milkyway' },
  { type: 'planets', url: 'surveys/sso/sun', key: 'sun' },
  { type: 'planets', url: 'surveys/sso/moon', key: 'moon' },
  { type: 'landscapes', url: 'landscapes/guereins', key: 'guereins' },
];

export const STELLARIUM_WASM = 'lib/stellarium-web-engine.wasm';
export const STELLARIUM_SCRIPT = 'lib/stellarium-web-engine.js?v=2';

export const BORTLE_DEFAULT = 7;

export const WEATHER_MODELS = [
  { value: 'best_match', label: '🤖 Best Match' },
  { value: 'ecmwf_ifs', label: '🌍 ECMWF 9km' },
  { value: 'gfs_seamless', label: '🇺🇸 GFS 22km' },
  { value: 'icon_seamless', label: '🇩🇪 ICON 13km' },
  { value: 'gem_seamless', label: '🇨🇦 GEM 15km' },
];

// Z-index scale — keep layers from fighting
export const Z = {
  BACKGROUND: 0,
  MAP_UI: 100,
  PANEL: 500,
  HEADER: 1000,
  FAB: 1001,
  MODAL: 1500,
  SEARCH_DROPDOWN: 2000,
  AR_HUD: 10,
  AR_CONTROLS: 30,
  AR_OVERLAY: 6000,
};

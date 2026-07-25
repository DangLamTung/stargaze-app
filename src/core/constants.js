/**
 * Shared constants — single source of truth for magic values across the codebase.
 */
export const STELLARIUM_DATA_BASE = 'https://data.stellarium.org/';

export const STELLARIUM_CATALOGS = [
  { type: 'stars', url: 'stars' },
  // Sky cultures — constellation lines & names for different traditions
  { type: 'skycultures', url: 'skycultures/western', key: 'western' },
  { type: 'skycultures', url: 'skycultures/chinese', key: 'chinese' },
  { type: 'skycultures', url: 'skycultures/arabic', key: 'arabic' },
  // Deep sky objects, Milky Way, planets
  { type: 'dsos', url: 'dso' },
  { type: 'milkyway', url: 'surveys/milkyway' },
  { type: 'planets', url: 'surveys/sso/sun', key: 'sun' },
  { type: 'planets', url: 'surveys/sso/moon', key: 'moon' },
  { type: 'planets', url: 'surveys/sso/mercury', key: 'mercury' },
  { type: 'planets', url: 'surveys/sso/venus', key: 'venus' },
  { type: 'planets', url: 'surveys/sso/mars', key: 'mars' },
  { type: 'planets', url: 'surveys/sso/jupiter', key: 'jupiter' },
  { type: 'planets', url: 'surveys/sso/saturn', key: 'saturn' },
  { type: 'landscapes', url: 'landscapes/guereins', key: 'guereins' },
];

export const SKY_CULTURES = [
  { key: 'western', label: '🌍 Western', icon: '⭐' },
  { key: 'chinese', label: '🇨🇳 Chinese', icon: '🐉' },
  { key: 'arabic', label: '🌙 Arabic', icon: '🌙' },
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

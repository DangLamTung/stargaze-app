/**
 * StellariumEngine — singleton loader for the Stellarium Web WASM engine.
 * Both sky-map.js and ar-mode.js import from here instead of duplicating.
 */
import { STELLARIUM_DATA_BASE, STELLARIUM_CATALOGS, STELLARIUM_WASM, STELLARIUM_SCRIPT } from './constants.js';

let _scriptLoaded = false;
let _loading = false;
let _engine = null;

/** Load the Stellarium JS bundle (idempotent) */
export function loadScript() {
  if (_scriptLoaded) return Promise.resolve();
  if (typeof StelWebEngine !== 'undefined') {
    _scriptLoaded = true;
    return Promise.resolve();
  }
  if (_loading) {
    // Wait for existing load to finish
    return new Promise(r => {
      const iv = setInterval(() => {
        if (_scriptLoaded) {
          clearInterval(iv);
          r();
        }
      }, 50);
    });
  }
  _loading = true;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = STELLARIUM_SCRIPT;
    s.onload = () => {
      _scriptLoaded = true;
      _loading = false;
      resolve();
    };
    s.onerror = () => {
      _loading = false;
      reject(new Error('Stellarium script failed'));
    };
    document.head.appendChild(s);
  });
}

/** Check if the engine object is available */
export function isAvailable() {
  return typeof StelWebEngine !== 'undefined';
}

/** Initialize the engine on a canvas. Returns the engine instance via onReady callback. */
export function initEngine(canvas, onReady, onError) {
  if (!canvas) {
    onError?.(new Error('No canvas'));
    return;
  }
  const timeout = setTimeout(() => {
    onError?.(new Error('Engine init timeout (15s)'));
  }, 15000);

  StelWebEngine({
    wasmFile: STELLARIUM_WASM,
    canvas: canvas,
    onReady(engine) {
      clearTimeout(timeout);
      _engine = engine;
      configureCatalogs(engine);
      onReady?.(engine);
    },
  });
}

/** Add all star/planet/DSO catalogs to an engine instance */
export function configureCatalogs(engine) {
  if (!engine?.core) return;
  const base = STELLARIUM_DATA_BASE;
  for (const cat of STELLARIUM_CATALOGS) {
    const target = engine.core[cat.type];
    if (target?.addDataSource) {
      target.addDataSource({ url: base + cat.url, ...(cat.key ? { key: cat.key } : {}) });
    }
  }
  // Default visual settings
  if (engine.core.constellations) {
    engine.core.constellations.lines_visible = true;
    engine.core.constellations.labels_visible = true;
  }
  if (engine.core.atmosphere) engine.core.atmosphere.visible = false;
  if (engine.core.landscapes) engine.core.landscapes.visible = true;
  if (engine.core.stars) engine.core.stars.hints_visible = true;
  if (engine.core.planets) engine.core.planets.hints_visible = true;
  if (engine.core.lines) {
    if (engine.core.lines.equatorial) engine.core.lines.equatorial.visible = false;
    if (engine.core.lines.azimuthal) engine.core.lines.azimuthal.visible = false;
    if (engine.core.lines.ecliptic) engine.core.lines.ecliptic.visible = true;
  }
}

/** Set observer position and orientation */
export function setObserver(engine, { lat, lon, pitch, yaw, fov, utc } = {}) {
  if (!engine?.core?.observer) return;
  if (lat != null) engine.core.observer.latitude = (lat * Math.PI) / 180;
  if (lon != null) engine.core.observer.longitude = (lon * Math.PI) / 180;
  if (pitch != null) engine.core.observer.pitch = (pitch * Math.PI) / 180;
  if (yaw != null) engine.core.observer.yaw = (yaw * Math.PI) / 180;
  if (fov != null) engine.core.observer.fov = (fov * Math.PI) / 180;
  if (utc != null) engine.core.observer.utc = utc;
}

/** Get the already-initialized engine instance */
export function getEngine() {
  return _engine;
}

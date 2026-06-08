/**
 * SkyMap — Local Stellarium Web Engine in the info panel.
 * Same engine as AR mode, with time/toggle controls.
 */

let panelStel = null;
let panelReady = false;
let panelLat = 0, panelLon = 0;
let panelTimeOff = 0;
let panelBearing = 0;

const PANEL_DATA = '/test-skydata/';

export function setSkyBearing(deg) {
  panelBearing = ((Number(deg) % 360) + 360) % 360;
  applyPanelYaw();
}

function applyPanelYaw() {
  if (panelReady && panelStel && panelStel.core) {
    panelStel.core.observer.yaw = (-panelBearing) * Math.PI / 180;
  }
}

function applyPanelTime() {
  if (panelReady && panelStel && typeof panelStel.date2MJD === 'function') {
    panelStel.core.observer.utc = panelStel.date2MJD(new Date()) + panelTimeOff / 24;
  }
}

function updatePanelDebug() {
  var el = document.getElementById('panel-sky-debug');
  if (el && panelReady && panelStel && panelStel.core) {
    var obs = panelStel.core.observer;
    el.textContent = 'yaw:' + ((-panelBearing%360+360)%360).toFixed(0) + '° lat:' + (obs.latitude*180/Math.PI).toFixed(2);
  }
}

export async function initSkyMap(containerId, latitude, longitude, date) {
  var numLat = parseFloat(latitude), numLon = parseFloat(longitude);
  if (isNaN(numLat) || isNaN(numLon)) return null;
  panelLat = numLat; panelLon = numLon;

  var canvas = document.getElementById('panel-sky');
  if (!canvas) return null;

  // Only init once
  if (window._panelStelInit) {
    if (panelReady && panelStel && panelStel.core) {
      panelStel.core.observer.latitude = numLat * Math.PI / 180;
      panelStel.core.observer.longitude = numLon * Math.PI / 180;
      applyPanelYaw();
      applyPanelTime();
    }
    return panelStel;
  }
  window._panelStelInit = true;

  StelWebEngine({
    wasmFile: 'lib/stellarium-web-engine.wasm',
    canvas: canvas,
    onReady: function(engine) {
      panelStel = engine;
      panelReady = true;
      var b = PANEL_DATA;
      engine.core.stars.addDataSource({ url: b + 'stars' });
      engine.core.skycultures.addDataSource({ url: b + 'skycultures/western', key: 'western' });
      engine.core.dsos.addDataSource({ url: b + 'dso' });
      engine.core.milkyway.addDataSource({ url: b + 'surveys/milkyway' });
      engine.core.planets.addDataSource({ url: b + 'surveys/sso/sun', key: 'sun' });
      engine.core.planets.addDataSource({ url: b + 'surveys/sso/moon', key: 'moon' });
      if (engine.core.landscapes) engine.core.landscapes.addDataSource({ url: b + 'landscapes/guereins', key: 'guereins' });
      if (engine.core.constellations) { engine.core.constellations.lines_visible = true; engine.core.constellations.labels_visible = true; }
      if (engine.core.atmosphere) engine.core.atmosphere.visible = false;
      if (engine.core.landscapes) engine.core.landscapes.visible = true;
      if (engine.core.stars) engine.core.stars.hints_visible = true;
      if (engine.core.planets) engine.core.planets.hints_visible = true;
      engine.core.observer.latitude = numLat * Math.PI / 180;
      engine.core.observer.longitude = numLon * Math.PI / 180;
      engine.core.observer.pitch = 35 * Math.PI / 180;
      engine.core.observer.yaw = 0;
      if (typeof engine.date2MJD === 'function') engine.core.observer.utc = engine.date2MJD(new Date());

      // Setup controls
      setupPanelControls();
      updatePanelDebug();
    }
  });

  return null;
}

function setupPanelControls() {
  // Time slider
  var tmSlider = document.getElementById('panel-time');
  var tmVal = document.getElementById('panel-time-val');
  if (tmSlider) {
    tmSlider.addEventListener('input', function() {
      panelTimeOff = parseInt(this.value);
      tmVal.textContent = panelTimeOff === 0 ? 'now' : (panelTimeOff > 0 ? '+' : '') + panelTimeOff + 'h';
      applyPanelTime();
      updatePanelDebug();
    });
  }

  // Toggle buttons
  panelToggle('panel-btn-atmo', 'atmosphere', false);
  panelToggle('panel-btn-ground', 'landscapes', true);
  panelToggle('panel-btn-grid', 'lines', {sub: 'equatorial', def: false});

  function panelToggle(id, prop, opts) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var defOn = (typeof opts === 'boolean') ? opts : (opts && opts.def);
    if (defOn) btn.classList.add('active');
    btn.addEventListener('click', function() {
      btn.classList.toggle('active');
      var on = btn.classList.contains('active');
      if (panelReady && panelStel && panelStel.core) {
        var obj = panelStel.core[prop];
        if (obj) {
          if (opts && opts.sub) {
            if (obj[opts.sub]) obj[opts.sub].visible = on;
          } else {
            obj.visible = on;
          }
        }
        if (prop === 'lines' && panelStel.core.lines && panelStel.core.lines.azimuthal) {
          panelStel.core.lines.azimuthal.visible = on;
        }
      }
      updatePanelDebug();
    });
  }
}

export function updateSkyMap(latitude, longitude, date) {
  var nLat = parseFloat(latitude), nLon = parseFloat(longitude);
  if (isNaN(nLat) || isNaN(nLon)) return;
  panelLat = nLat; panelLon = nLon;
  if (panelReady && panelStel && panelStel.core) {
    panelStel.core.observer.latitude = nLat * Math.PI / 180;
    panelStel.core.observer.longitude = nLon * Math.PI / 180;
    applyPanelTime();
    updatePanelDebug();
  }
}

export function destroySkyMap() {
  // Engine can't be recreated, just null refs
  panelStel = null;
  panelReady = false;
}


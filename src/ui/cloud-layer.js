/**
 * CloudLayer — Satellite and Radar overlay on Leaflet map
 * Radar: RainViewer API (free, no key)
 * Satellite: JMA Himawari full-disk infrared (free, no key)
 */

import { showToast } from './toast.js';
import { addWindLayer, removeWindLayer } from './wind-layer.js';

let apiData = null;
let satelliteTimes = [];
let currentMap = null;
let activeLayers = [];
let animationTimer = null;
let animationPosition = 0;
let layerType = 'none'; // 'satellite' | 'radar' | 'windy' | 'nasa' | 'none'
let currentOpacity = 0.5;

const HIMAWARI_TIMES_URL = 'https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json';
// Full-disk Himawari tiles are published only for z=3..5.
// Band/prod examples:
// - B13/TBB: Infrared
// - REP/ETC: True-color reproduction (RGB-like)
let HIMAWARI_BAND_PROD = 'REP/ETC'; // true-color by default; toggle to 'B13/TBB' for infrared
const HIMAWARI_MAX_ZOOM = 5;

export function toggleSatelliteBand() {
  HIMAWARI_BAND_PROD = HIMAWARI_BAND_PROD === 'B13/TBB' ? 'REP/ETC' : 'B13/TBB';
  return HIMAWARI_BAND_PROD === 'REP/ETC' ? 'truecolor' : 'infrared';
}

export function getSatelliteBand() {
  return HIMAWARI_BAND_PROD === 'REP/ETC' ? 'truecolor' : 'infrared';
}

function parseJmaTime(str) {
  const y = +str.slice(0, 4);
  const mo = +str.slice(4, 6) - 1;
  const d = +str.slice(6, 8);
  const h = +str.slice(8, 10);
  const min = +str.slice(10, 12);
  return new Date(Date.UTC(y, mo, d, h, min));
}

function addHimawariSatelliteLayers(map) {
  const frames = satelliteTimes.slice(-13);
  if (!frames.length) {
    showToast('Satellite imagery unavailable. Try again in a moment.', 'error');
    return;
  }

  frames.forEach((frame, i) => {
    const { basetime, validtime } = frame;
    const layer = L.tileLayer(
      `https://www.jma.go.jp/bosai/himawari/data/satimg/${basetime}/fd/${validtime}/${HIMAWARI_BAND_PROD}/{z}/{x}/{y}.jpg`,
      {
        opacity: i === frames.length - 1 ? currentOpacity : 0,
        zIndex: 400,
        minZoom: 3,
        // Allow map zoom higher than what Himawari provides.
        // Leaflet will scale the highest-available tiles (maxNativeZoom).
        maxZoom: 19,
        maxNativeZoom: HIMAWARI_MAX_ZOOM,
        attribution: '&copy; <a href="https://www.jma.go.jp/">Japan Meteorological Agency</a> Himawari',
      },
    );
    layer.time = parseJmaTime(validtime);
    layer.addTo(map);
    activeLayers.push(layer);
  });
}

export async function initCloudSatelliteLayer() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), 8000);

  try {
    const [rvRes, jmaRes] = await Promise.all([
      fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: controller.signal }),
      fetch(HIMAWARI_TIMES_URL, { signal: controller.signal }),
    ]);
    if (rvRes.ok) apiData = await rvRes.json();
    if (jmaRes.ok) satelliteTimes = await jmaRes.json();
  } catch (err) {
    console.error('Cloud layer init error:', err);
  } finally {
    clearTimeout(timeoutId);
  }

  return true;
}

export function setWeatherLayer(map, type) {
  currentMap = map;
  layerType = type;

  stopCloudAnimation();
  removeRadarRings();
  removeWindLayer(map);
  activeLayers.forEach(l => {
    if (map.hasLayer(l)) map.removeLayer(l);
  });
  activeLayers = [];

  if (type === 'none') return;

  if (type === 'windy') {
    // Windy.com wind tiles + dynamic particle streamlines
    var windyLayer = L.tileLayer('https://tiles.windy.com/tiles/v9.0/wind/{z}/{x}/{y}.png', {
      opacity: Math.max(0.4, currentOpacity),
      zIndex: 410,
      maxZoom: 19,
      maxNativeZoom: 12,
      attribution: '&copy; <a href="https://windy.com" target="_blank" rel="noopener">Windy.com</a>',
    });
    windyLayer.addTo(map);
    activeLayers.push(windyLayer);
    addWindLayer(map);
    return;
  }

  if (type === 'radar' && apiData && apiData.radar && apiData.radar.past) {
    const frames = apiData.radar.past;
    if (!frames.length) return;
    const colorScheme = 2;
    frames.forEach((frame, i) => {
      const layer = L.tileLayer(`${apiData.host}${frame.path}/256/{z}/{x}/{y}/${colorScheme}/1_1.png`, {
        opacity: i === frames.length - 1 ? currentOpacity : 0,
        zIndex: 400,
        maxZoom: 19,
        maxNativeZoom: 12,
        attribution: '&copy; <a href="https://rainviewer.com">RainViewer</a>',
      });
      layer.time = new Date(frame.time * 1000);
      layer.addTo(map);
      activeLayers.push(layer);
    });
    // Add radar range rings (zoom-resistant, in meters from map center)
    addRadarRings(map);
  } else if (type === 'satellite') {
    if (!satelliteTimes.length) {
      fetch(HIMAWARI_TIMES_URL)
        .then(r => r.json())
        .then(data => {
          satelliteTimes = data;
          setWeatherLayer(map, type);
        })
        .catch(() => showToast('Satellite imagery unavailable.', 'error'));
      return;
    }
    addHimawariSatelliteLayers(map);
  } else if (type === 'nasa') {
    let dateStr = document.getElementById('nasa-date-picker')?.value;
    if (!dateStr) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      dateStr = d.toISOString().split('T')[0];
    }
    const layer = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      {
        opacity: currentOpacity,
        zIndex: 400,
        maxZoom: 19,
        maxNativeZoom: 9,
        attribution: '&copy; <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a>',
      },
    );
    layer.time = new Date(dateStr);
    layer.addTo(map);
    activeLayers.push(layer);
  }
}

export function startCloudAnimation(onTick) {
  stopCloudAnimation();
  animationPosition = 0;

  if (activeLayers.length < 2) return;
  animationTimer = setInterval(() => {
    activeLayers.forEach(l => l.setOpacity(0));
    const layer = activeLayers[animationPosition];
    layer.setOpacity(currentOpacity);

    if (typeof onTick === 'function') onTick(layer.time, animationPosition, activeLayers.length);

    animationPosition = (animationPosition + 1) % activeLayers.length;
  }, 1000);
}

export function stopCloudAnimation() {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = null;
  activeLayers.forEach((l, i) => {
    l.setOpacity(i === activeLayers.length - 1 ? currentOpacity : 0);
  });
}

export function setCloudOpacity(opacity) {
  currentOpacity = opacity;
  activeLayers.forEach(l => l.setOpacity(opacity));
}

export function setCloudFrame(index) {
  if (!activeLayers.length) return null;
  activeLayers.forEach(l => l.setOpacity(0));

  const validIndex = Math.max(0, Math.min(index, activeLayers.length - 1));
  const layer = activeLayers[validIndex];

  if (layer) {
    layer.setOpacity(currentOpacity);
    return layer.time;
  }
  return null;
}

export function getCloudFramesCount() {
  return activeLayers.length;
}

// ─── Radar Visibility Ring (based on current weather visibility) ───
var _radarRings = [];

function addRadarRings(map) {
  removeRadarRings();
  var center = map.getCenter();

  // Get current visibility from weather data (meters)
  var visM = 20000; // default 20km
  try {
    var state = window._starGazeState;
    if (state && state.weatherData && state.weatherData.current && state.weatherData.current.visibility) {
      visM = state.weatherData.current.visibility;
    }
  } catch (_) {
    /* fallback to default */
  }

  var visKm = Math.round(visM / 1000);
  var color, fill;
  if (visKm >= 30) {
    color = 'rgba(34,197,94,0.25)';
    fill = 'rgba(34,197,94,0.05)';
  } else if (visKm >= 15) {
    color = 'rgba(234,179,8,0.25)';
    fill = 'rgba(234,179,8,0.05)';
  } else {
    color = 'rgba(239,68,68,0.25)';
    fill = 'rgba(239,68,68,0.05)';
  }

  var ring = L.circle(center, {
    radius: visM,
    color: color,
    fillColor: fill,
    fillOpacity: 1,
    weight: 2,
    dashArray: '6,10',
    interactive: false,
    zIndex: 401,
  });
  ring.addTo(map);

  var label = L.marker([center.lat, center.lng + visM / 111320], {
    icon: L.divIcon({
      className: 'radar-ring-label',
      html:
        '<span style="font-size:11px;color:' +
        color.replace(/0\.\d+/, '0.8') +
        ';background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;white-space:nowrap;font-weight:600">👁 Clear vision: ' +
        visKm +
        ' km</span>',
      iconSize: [0, 0],
    }),
    interactive: false,
    zIndex: 402,
  });
  label.addTo(map);
  _radarRings.push(ring, label);
}

function removeRadarRings() {
  _radarRings.forEach(function (r) {
    if (r._map) r._map.removeLayer(r);
  });
  _radarRings = [];
}

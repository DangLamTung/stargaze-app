/**
 * CloudLayer — Satellite and Radar overlay on Leaflet map
 * Radar: RainViewer API (free, no key)
 * Satellite: JMA Himawari full-disk infrared (free, no key)
 */

import { showToast } from './toast.js';

let apiData = null;
let satelliteTimes = [];
let currentMap = null;
let activeLayers = [];
let animationTimer = null;
let animationPosition = 0;
let layerType = 'none'; // 'satellite' | 'radar' | 'none'
let currentOpacity = 0.55;

const HIMAWARI_TIMES_URL = 'https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json';
// Full-disk Himawari tiles are published only for z=3..5.
// Band/prod examples:
// - B13/TBB: Infrared
// - REP/ETC: True-color reproduction (RGB-like)
let HIMAWARI_BAND_PROD = 'B13/TBB'; // 'B13/TBB'=infrared, 'REP/ETC'=true-color
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
  const timeoutId = setTimeout(() => controller.abort(), 8000);

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
  activeLayers.forEach(l => {
    if (map.hasLayer(l)) map.removeLayer(l);
  });
  activeLayers = [];

  if (type === 'none') return;

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
  if (!animationTimer && activeLayers.length > 0) {
    animationPosition = Math.max(0, Math.min(animationPosition, activeLayers.length - 1));
    activeLayers[animationPosition].setOpacity(opacity);
  }
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

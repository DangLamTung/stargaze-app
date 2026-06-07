/**
 * ARMode — Augmented Reality sky view using device IMU + GPS + camera.
 * Overlays Stellarium star map + Bortle/cloud data on the rear camera feed.
 */

import { setSkyContext } from './sky-map.js';

let arActive = false;
let videoEl = null;
let overlayEl = null;
let skyIframe = null;
let orientation = { alpha: 0, beta: 0, gamma: 0, heading: 0, altitude: 45 };
let animFrame = null;

function buildArStellariumUrl(lat, lon, heading, altitude) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lng: lon.toFixed(4),
    az: String(Math.round(heading)),
    alt: String(Math.round(altitude)),
    fov: '70',
  });
  return `https://stellarium-web.org/?${params.toString()}`;
}

export function isARActive() {
  return arActive;
}

export async function startARMode(latitude, longitude, onStop) {
  if (arActive) return;

  const overlay = document.getElementById('ar-overlay');
  const video = document.getElementById('ar-video');
  if (!overlay || !video) {
    console.error('AR overlay elements not found');
    return;
  }

  try {
    // Request camera (rear/environment facing)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    // Request device orientation permission (iOS 13+)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Motion permission denied');
    }

    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;

    // Save location
    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;

    // Create Stellarium iframe overlay
    const skyContainer = overlay.querySelector('#ar-sky');
    if (skyContainer) {
      const url = buildArStellariumUrl(latitude, longitude, 0, 45);
      skyIframe = document.createElement('iframe');
      skyIframe.src = url;
      skyIframe.style.width = '250%';
      skyIframe.style.height = '250%';
      skyIframe.style.border = 'none';
      skyIframe.style.position = 'absolute';
      skyIframe.style.top = '-75%';
      skyIframe.style.left = '-75%';
      skyIframe.style.opacity = '0.45';
      skyIframe.style.pointerEvents = 'none';
      skyIframe.allow = 'geolocation';
      skyContainer.appendChild(skyIframe);

      // Update sky map context
      setSkyContext({ latitude, longitude, bearing: 0, altitude: 45, fov: 70 });
    }

    // Listen for orientation
    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);

    // Start render loop
    renderLoop();
  } catch (err) {
    console.error('AR mode failed:', err);
    stopARMode();
    if (onStop) onStop(err.message);
  }
}

export function stopARMode() {
  arActive = false;

  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
  videoEl = null;

  // Remove Stellarium iframe
  if (skyIframe) {
    skyIframe.remove();
    skyIframe = null;
  }

  if (overlayEl) {
    overlayEl.classList.add('hidden');
  }
  overlayEl = null;

  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }

  window.removeEventListener('deviceorientation', handleOrientation, true);
  window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
}

function handleOrientation(event) {
  let heading = event.alpha;
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  }
  if (heading == null || isNaN(heading)) heading = 0;
  heading = ((heading % 360) + 360) % 360;

  const beta = event.beta || 0;
  // Approximate altitude: 0=flat/up, 90=vertical/forward
  const altitude = Math.max(0, Math.min(90, 90 - Math.abs(beta)));

  orientation = {
    alpha: event.alpha || 0,
    beta,
    gamma: event.gamma || 0,
    heading,
    altitude,
  };
}

let lastSkyUrl = '';
let skyUpdateCounter = 0;

function renderLoop() {
  if (!arActive) return;

  skyUpdateCounter++;
  updateOverlay();

  // Update Stellarium iframe every 15 frames (~250ms) to avoid excessive reloads
  if (skyUpdateCounter % 15 === 0 && skyIframe && overlayEl) {
    const lat = parseFloat(overlayEl.dataset.lat);
    const lon = parseFloat(overlayEl.dataset.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      const url = buildArStellariumUrl(lat, lon, orientation.heading, orientation.altitude);
      if (url !== lastSkyUrl) {
        lastSkyUrl = url;
        skyIframe.src = url;
      }
    }
  }

  animFrame = requestAnimationFrame(renderLoop);
}

function updateOverlay() {
  if (!overlayEl) return;

  const h = orientation.heading;
  const alt = orientation.altitude;

  // Compass ring
  const compassRing = overlayEl.querySelector('#ar-compass-ring');
  if (compassRing) {
    compassRing.style.transform = `rotate(${-h}deg)`;
  }

  // Heading label
  const headingLabel = overlayEl.querySelector('#ar-heading');
  if (headingLabel) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[Math.round(h / 45) % 8];
    headingLabel.textContent = `${Math.round(h)}° ${dir}`;
  }

  // Altitude
  const altLabel = overlayEl.querySelector('#ar-altitude');
  if (altLabel) {
    altLabel.textContent = `${Math.round(alt)}°`;
  }

  // Update map bearing
  const lat = parseFloat(overlayEl.dataset.lat);
  const lon = parseFloat(overlayEl.dataset.lon);
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') {
    window._arBearingCallback(h, lat, lon);
  }

  // Update Bortle info (shown from last known data)
  updateArInfo();
}

let lastBortleFetch = 0;
let cachedBortle = null;

async function updateArInfo() {
  if (!overlayEl) return;

  // Cloud info from current weather data
  const weather = window._arWeatherData;
  const cloudEl = overlayEl.querySelector('#ar-cloud-pct');
  if (cloudEl && weather) {
    const cloudPct = weather.cloudCover != null ? Math.round(weather.cloudCover) : '--';
    cloudEl.textContent = cloudPct === '--' ? '--' : `${cloudPct}%`;
    const c = weather.cloudCover;
    cloudEl.style.color = c <= 20 ? '#00ff88' : c <= 50 ? '#ffcc00' : '#ff4444';
  }

  const lat = parseFloat(overlayEl.dataset.lat);
  const lon = parseFloat(overlayEl.dataset.lon);
  if (isNaN(lat) || isNaN(lon)) return;

  // Fetch Bortle along current heading (throttled to every 30s)
  const now = Date.now();
  if (now - lastBortleFetch > 30000) {
    lastBortleFetch = now;
    try {
      // Sample point ~15km along the bearing
      const R = 6371;
      const d = 15 / R;
      const φ1 = lat * Math.PI / 180;
      const λ1 = lon * Math.PI / 180;
      const θ = orientation.heading * Math.PI / 180;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
      const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
      const sampleLat = φ2 * 180 / Math.PI;
      const sampleLon = λ2 * 180 / Math.PI;

      const res = await fetch(`/api/bortle?lat=${sampleLat.toFixed(4)}&lon=${sampleLon.toFixed(4)}`);
      if (res.ok) cachedBortle = await res.json();
    } catch (e) { /* ignore */ }
  }

  const bortleEl = overlayEl.querySelector('#ar-bortle');
  if (bortleEl && cachedBortle) {
    const b = cachedBortle.bortle || '?';
    const color = b <= 3 ? '#00ff88' : b <= 5 ? '#ffcc00' : '#ff4444';
    bortleEl.textContent = `B${b}`;
    bortleEl.style.color = color;
  }
}

export function getARHeading() {
  return orientation.heading;
}

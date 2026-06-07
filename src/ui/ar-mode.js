/**
 * ARMode — Augmented Reality sky view using device IMU + GPS + camera.
 * Overlays Stellarium star map (loaded once, rotated via CSS) + Bortle/cloud data.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let skyIframe = null;
let orientation = { heading: 0, altitude: 45 };
let animFrame = null;

function buildArStellariumUrl(lat, lon, alt) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lng: lon.toFixed(4),
    az: '0',               // center at north; CSS rotate(-heading) aligns to compass
    alt: String(Math.round(alt)),
    fov: '170',
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
  const skyContainer = document.getElementById('ar-sky');
  if (!overlay || !video || !skyContainer) {
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

    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;

    // Create Stellarium iframe ONCE — wide FOV, CSS rotates for azimuth
    skyContainer.innerHTML = '';
    skyIframe = document.createElement('iframe');
    skyIframe.src = buildArStellariumUrl(latitude, longitude, 45);
    skyIframe.style.width = '300%';
    skyIframe.style.height = '300%';
    skyIframe.style.position = 'absolute';
    skyIframe.style.top = '-100%';
    skyIframe.style.left = '-100%';
    skyIframe.style.border = 'none';
    skyIframe.style.opacity = '0.75';
    skyIframe.style.pointerEvents = 'none';
    skyIframe.style.transition = 'none';
    skyIframe.allow = 'geolocation';
    skyContainer.appendChild(skyIframe);

    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);

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

  const beta = event.beta || 0;    // pitch: -180..180 (0=flat, 90=vertical)
  const gamma = event.gamma || 0;  // roll: -90..90
  const alpha = event.alpha || 0;  // yaw/compass: 0..360

  const altitude = Math.max(0, Math.min(90, 90 - Math.abs(beta)));

  orientation = { heading, altitude, alpha, beta, gamma };

  // Debug: print raw values to AR HUD
  const debugEl = document.getElementById('ar-debug');
  if (debugEl) {
    debugEl.textContent =
      `α(yaw):${alpha.toFixed(1)}° β(pitch):${beta.toFixed(1)}° γ(roll):${gamma.toFixed(1)}° | heading:${heading.toFixed(1)}° alt:${altitude.toFixed(1)}°`;
  }
}

let lastAltUpdate = 0;
let lastAltValue = 45;

function renderLoop() {
  if (!arActive) return;

  const h = orientation.heading;
  const alt = orientation.altitude;

  // Azimuth: iframe centered on north (az=0). rotate(-heading) puts
  // compass heading H at the crosshair.
  //   heading=0 (N) → rotate 0°   → north at crosshair
  //   heading=90 (E) → rotate -90° → east at crosshair
  const skyContainer = document.getElementById('ar-sky');
  if (skyContainer) {
    skyContainer.style.transform = `rotate(${-h}deg)`;
  }

  // Altitude: reload iframe when tilt changes >10°, throttled to every 2s
  const roundedAlt = Math.round(alt / 5) * 5; // snap to 5° increments
  const now = Date.now();
  if (Math.abs(roundedAlt - lastAltValue) >= 10 && now - lastAltUpdate > 2000 && skyIframe) {
    lastAltValue = roundedAlt;
    lastAltUpdate = now;
    const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
    const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
    if (!isNaN(lat) && !isNaN(lon)) {
      skyIframe.src = buildArStellariumUrl(lat, lon, alt);
    }
  }

  // Compass ring
  const compassRing = overlayEl?.querySelector('#ar-compass-ring');
  if (compassRing) {
    compassRing.style.transform = `rotate(${-h}deg)`;
  }

  // Heading label
  const headingLabel = overlayEl?.querySelector('#ar-heading');
  if (headingLabel) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    headingLabel.textContent = `${Math.round(h)}° ${dirs[Math.round(h / 45) % 8]}`;
  }

  // Altitude
  const altLabel = overlayEl?.querySelector('#ar-altitude');
  if (altLabel) altLabel.textContent = `${Math.round(alt)}°`;

  // Cloud info
  const weather = window._arWeatherData;
  const cloudEl = overlayEl?.querySelector('#ar-cloud-pct');
  if (cloudEl && weather) {
    const pct = weather.cloudCover != null ? Math.round(weather.cloudCover) : '--';
    cloudEl.textContent = pct === '--' ? '--' : `${pct}%`;
    cloudEl.style.color = weather.cloudCover <= 20 ? '#00ff88' : weather.cloudCover <= 50 ? '#ffcc00' : '#ff4444';
  }

  // Update map bearing
  const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') {
    window._arBearingCallback(h, lat, lon);
  }

  // Bortle lookup along heading (throttled every 30s)
  bortleLookup(lat, lon, h);

  animFrame = requestAnimationFrame(renderLoop);
}

let lastBortleFetch = 0;
let cachedBortle = null;

async function bortleLookup(lat, lon, heading) {
  if (isNaN(lat) || isNaN(lon)) return;
  const now = Date.now();
  if (now - lastBortleFetch < 30000) return;
  lastBortleFetch = now;

  try {
    const R = 6371, d = 15 / R;
    const φ1 = lat * Math.PI / 180, λ1 = lon * Math.PI / 180, θ = heading * Math.PI / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    const res = await fetch(`/api/bortle?lat=${((φ2 * 180 / Math.PI)).toFixed(4)}&lon=${((λ2 * 180 / Math.PI)).toFixed(4)}`);
    if (res.ok) cachedBortle = await res.json();
  } catch (e) { /* ignore */ }

  const bortleEl = overlayEl?.querySelector('#ar-bortle');
  if (bortleEl && cachedBortle) {
    const b = cachedBortle.bortle || '?';
    bortleEl.textContent = `B${b}`;
    bortleEl.style.color = b <= 3 ? '#00ff88' : b <= 5 ? '#ffcc00' : '#ff4444';
  }
}

export function getARHeading() {
  return orientation.heading;
}

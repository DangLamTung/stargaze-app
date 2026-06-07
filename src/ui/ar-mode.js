/**
 * ARMode — Augmented Reality sky view using device IMU + GPS + camera.
 * Low-pass filtered heading, pre-cached Stellarium iframe, hybrid az reload + CSS rotation.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let skyIframe = null;
let preloadIframe = null; // hidden iframe pre-cached before entering AR
let orientation = { heading: 0, altitude: 45, alpha: 0, beta: 0, gamma: 0 };
// Low-pass filter state
let smoothHeading = 0;
let smoothAltitude = 45;
const LP = 0.12; // smoothing factor (lower = smoother, more lag)
let animFrame = null;
let hasAbsoluteHeading = false;

function buildArStellariumUrl(lat, lon, az, alt) {
  return `https://stellarium-web.org/?${new URLSearchParams({
    lat: lat.toFixed(4), lng: lon.toFixed(4),
    az: String(Math.round(az)), alt: String(Math.round(alt)),
    fov: '100',
  }).toString()}`;
}

export function isARActive() { return arActive; }

/**
 * Preload Stellarium in a hidden iframe so it's cached when AR mode opens.
 * Call this after a location is selected (e.g. from app.js).
 */
export function preloadStellarium(lat, lon) {
  // Remove old preload
  if (preloadIframe) { preloadIframe.remove(); preloadIframe = null; }

  const container = document.getElementById('ar-preload');
  if (!container) return;

  preloadIframe = document.createElement('iframe');
  preloadIframe.src = buildArStellariumUrl(lat, lon, 0, 45);
  preloadIframe.style.cssText = 'width:1px;height:1px;border:none;position:absolute;opacity:0;pointer-events:none;';
  preloadIframe.allow = 'geolocation';
  container.appendChild(preloadIframe);
}

export async function startARMode(latitude, longitude, onStop) {
  if (arActive) return;
  const overlay = document.getElementById('ar-overlay');
  const video = document.getElementById('ar-video');
  const skyContainer = document.getElementById('ar-sky');
  if (!overlay || !video || !skyContainer) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted')
        throw new Error('Motion permission denied');
    }

    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;
    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;
    hasAbsoluteHeading = false;
    smoothHeading = 0;
    smoothAltitude = 45;

    // Steal the preloaded iframe if available (instant!), otherwise create new
    skyContainer.innerHTML = '';
    if (preloadIframe) {
      skyIframe = preloadIframe;
      preloadIframe = null;
      skyIframe.style.cssText =
        'width:300%;height:300%;position:absolute;top:-100%;left:-100%;' +
        'border:none;opacity:0.85;pointer-events:none;transition:none;';
    } else {
      skyIframe = document.createElement('iframe');
      skyIframe.src = buildArStellariumUrl(latitude, longitude, 0, 45);
      skyIframe.style.cssText =
        'width:300%;height:300%;position:absolute;top:-100%;left:-100%;' +
        'border:none;opacity:0.85;pointer-events:none;transition:none;';
      skyIframe.allow = 'geolocation';
    }
    skyContainer.appendChild(skyIframe);

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    renderLoop();
  } catch (err) {
    console.error('AR mode failed:', err);
    stopARMode();
    if (onStop) onStop(err.message);
  }
}

export function stopARMode() {
  arActive = false;
  if (videoEl?.srcObject) { videoEl.srcObject.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; }
  videoEl = null;
  if (skyIframe) { skyIframe.remove(); skyIframe = null; }
  if (overlayEl) overlayEl.classList.add('hidden');
  overlayEl = null;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
  window.removeEventListener('deviceorientation', handleOrientation, true);
}

function handleOrientation(event) {
  const isAbsolute = event.type === 'deviceorientationabsolute';
  let rawHeading;

  if (event.webkitCompassHeading !== undefined) {
    rawHeading = event.webkitCompassHeading;
    hasAbsoluteHeading = true;
  } else if (isAbsolute) {
    rawHeading = event.alpha;
    hasAbsoluteHeading = true;
  } else if (!hasAbsoluteHeading) {
    rawHeading = event.alpha;
  } else {
    return; // ignore non-absolute once we have absolute
  }

  if (rawHeading == null || isNaN(rawHeading)) rawHeading = 0;

  // Low-pass filter: exponential smoothing
  const beta = event.beta || 0;
  const rawAlt = Math.max(0, Math.min(90, 90 - Math.abs(beta)));
  smoothHeading = smoothHeading + LP * angleDelta(rawHeading, smoothHeading);
  smoothAltitude = smoothAltitude + LP * (rawAlt - smoothAltitude);

  orientation = {
    heading: ((smoothHeading % 360) + 360) % 360,
    altitude: smoothAltitude,
    alpha: event.alpha || 0, beta, gamma: event.gamma || 0,
    rawHeading, rawAlt,
  };

  const debugEl = document.getElementById('ar-debug');
  if (debugEl) {
    debugEl.textContent =
      `${isAbsolute ? 'ABS' : 'rel'} ` +
      `raw:${rawHeading.toFixed(1)}→smooth:${orientation.heading.toFixed(1)}° ` +
      `alt:${orientation.altitude.toFixed(1)}° β:${beta.toFixed(1)}° γ:${(event.gamma||0).toFixed(1)}°`;
  }
}

// Shortest angular difference (-180..180)
function angleDelta(a, b) {
  let d = ((a % 360) + 360) % 360 - ((b % 360) + 360) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

let lastAzReload = 0;
let reloadedAz = 0;
let reloadedAlt = 45;

function renderLoop() {
  if (!arActive) return;

  const h = orientation.heading;
  const alt = orientation.altitude;
  const now = Date.now();

  // Reload iframe every 10s with current heading/altitude
  if (now - lastAzReload > 10000 && skyIframe) {
    reloadedAz = h;
    reloadedAlt = alt;
    lastAzReload = now;
    const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
    const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
    if (!isNaN(lat) && !isNaN(lon)) {
      skyIframe.src = buildArStellariumUrl(lat, lon, h, alt);
      const sc = document.getElementById('ar-sky');
      if (sc) sc.style.transform = 'rotate(0deg)';
    }
  }

  // CSS rotation between reloads (small delta)
  const delta = angleDelta(h, reloadedAz);
  const skyContainer = document.getElementById('ar-sky');
  if (skyContainer && Math.abs(delta) > 0.3) {
    skyContainer.style.transform = `rotate(${-delta}deg)`;
  }

  // Compass ring
  const compassRing = overlayEl?.querySelector('#ar-compass-ring');
  if (compassRing) compassRing.style.transform = `rotate(${-h}deg)`;

  const headingLabel = overlayEl?.querySelector('#ar-heading');
  if (headingLabel) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    headingLabel.textContent = `${Math.round(h)}° ${dirs[Math.round(h/45)%8]}`;
  }

  const altLabel = overlayEl?.querySelector('#ar-altitude');
  if (altLabel) altLabel.textContent = `${Math.round(alt)}°`;

  // Cloud
  const w = window._arWeatherData;
  const cloudEl = overlayEl?.querySelector('#ar-cloud-pct');
  if (cloudEl && w) {
    const pct = w.cloudCover != null ? Math.round(w.cloudCover) : '--';
    cloudEl.textContent = pct === '--' ? '--' : `${pct}%`;
    cloudEl.style.color = w.cloudCover <= 20 ? '#00ff88' : w.cloudCover <= 50 ? '#ffcc00' : '#ff4444';
  }

  // Map bearing
  const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') {
    window._arBearingCallback(h, lat, lon);
  }

  bortleLookup(lat, lon, h);
  animFrame = requestAnimationFrame(renderLoop);
}

let lastBortleFetch = 0, cachedBortle = null;

async function bortleLookup(lat, lon, heading) {
  if (isNaN(lat) || isNaN(lon)) return;
  const now = Date.now();
  if (now - lastBortleFetch < 30000) return;
  lastBortleFetch = now;
  try {
    const R=6371, d=15/R, φ1=lat*Math.PI/180, λ1=lon*Math.PI/180, θ=heading*Math.PI/180;
    const φ2=Math.asin(Math.sin(φ1)*Math.cos(d)+Math.cos(φ1)*Math.sin(d)*Math.cos(θ));
    const λ2=λ1+Math.atan2(Math.sin(θ)*Math.sin(d)*Math.cos(φ1),Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
    const res=await fetch(`/api/bortle?lat=${((φ2*180/Math.PI)).toFixed(4)}&lon=${((λ2*180/Math.PI)).toFixed(4)}`);
    if(res.ok) cachedBortle=await res.json();
  }catch(e){}
  const el=overlayEl?.querySelector('#ar-bortle');
  if(el&&cachedBortle){const b=cachedBortle.bortle||'?';el.textContent=`B${b}`;el.style.color=b<=3?'#00ff88':b<=5?'#ffcc00':'#ff4444';}
}

export function getARHeading(){return orientation.heading;}

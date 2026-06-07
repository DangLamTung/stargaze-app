/**
 * ARMode — Augmented Reality sky view using device IMU + GPS + camera.
 * Hybrid: periodic az reload + CSS rotation for smooth tracking.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let skyIframe = null;
let orientation = { heading: 0, altitude: 45, alpha: 0, beta: 0, gamma: 0 };
let animFrame = null;
let hasAbsoluteHeading = false; // true when deviceorientationabsolute fires

function buildArStellariumUrl(lat, lon, az, alt) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lng: lon.toFixed(4),
    az: String(Math.round(az)),
    alt: String(Math.round(alt)),
    fov: '100',  // narrower = more detail, CSS handles small heading changes
  });
  return `https://stellarium-web.org/?${params.toString()}`;
}

export function isARActive() { return arActive; }

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
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Motion permission denied');
    }

    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;
    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;
    hasAbsoluteHeading = false;

    // Initial load with current heading
    skyContainer.innerHTML = '';
    skyIframe = document.createElement('iframe');
    skyIframe.src = buildArStellariumUrl(latitude, longitude, 0, 45);
    skyIframe.style.cssText =
      'width:300%;height:300%;position:absolute;top:-100%;left:-100%;' +
      'border:none;opacity:0.85;pointer-events:none;transition:none;';
    skyIframe.allow = 'geolocation';
    skyContainer.appendChild(skyIframe);

    // Prefer deviceorientationabsolute (true compass heading, no tilt drift)
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
  // deviceorientationabsolute gives true compass heading (Earth frame)
  // deviceorientation.alpha drifts with tilt; only use as fallback
  const isAbsolute = event.type === 'deviceorientationabsolute';

  let heading;
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading; // iOS
    hasAbsoluteHeading = true;
  } else if (isAbsolute) {
    heading = event.alpha; // Android absolute = true compass
    hasAbsoluteHeading = true;
  } else if (!hasAbsoluteHeading) {
    heading = event.alpha; // fallback: regular alpha (may drift)
  } else {
    return; // ignore non-absolute events once we have absolute
  }

  if (heading == null || isNaN(heading)) heading = 0;
  heading = ((heading % 360) + 360) % 360;

  const beta = event.beta || 0;
  const altitude = Math.max(0, Math.min(90, 90 - Math.abs(beta)));

  orientation = { heading, altitude,
    alpha: event.alpha || 0, beta, gamma: event.gamma || 0 };

  const debugEl = document.getElementById('ar-debug');
  if (debugEl) {
    debugEl.textContent =
      `${isAbsolute ? 'ABS' : 'rel'} α:${orientation.alpha.toFixed(1)}° β:${beta.toFixed(1)}° γ:${orientation.gamma.toFixed(1)}° | az:${heading.toFixed(1)}° alt:${altitude.toFixed(1)}°`;
  }
}

let lastAzReload = 0;
let reloadedAz = 0;
let lastAltReload = 0;
let reloadedAlt = 45;

function renderLoop() {
  if (!arActive) return;

  const h = orientation.heading;
  const alt = orientation.altitude;
  const now = Date.now();

  // Hybrid: reload iframe every 3s with current az/alt, CSS rotate between reloads
  if (now - lastAzReload > 3000 && skyIframe) {
    reloadedAz = h;
    reloadedAlt = alt;
    lastAzReload = now;
    lastAltReload = now;
    const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
    const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
    if (!isNaN(lat) && !isNaN(lon)) {
      skyIframe.src = buildArStellariumUrl(lat, lon, h, alt);
      // Reset CSS rotation after reload (iframe now centered on current heading)
      const skyContainer = document.getElementById('ar-sky');
      if (skyContainer) skyContainer.style.transform = 'rotate(0deg)';
    }
  }

  // CSS rotation for smooth tracking between reloads
  // iframe center = reloadedAz. Phone heading = h. delta = h - reloadedAz.
  const delta = h - reloadedAz;
  const skyContainer = document.getElementById('ar-sky');
  if (skyContainer && Math.abs(delta) > 0.5) {
    // Small rotation to track heading between reloads
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
    const R=6371, d=15/R;
    const φ1=lat*Math.PI/180, λ1=lon*Math.PI/180, θ=heading*Math.PI/180;
    const φ2=Math.asin(Math.sin(φ1)*Math.cos(d)+Math.cos(φ1)*Math.sin(d)*Math.cos(θ));
    const λ2=λ1+Math.atan2(Math.sin(θ)*Math.sin(d)*Math.cos(φ1),Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
    const res=await fetch(`/api/bortle?lat=${((φ2*180/Math.PI)).toFixed(4)}&lon=${((λ2*180/Math.PI)).toFixed(4)}`);
    if(res.ok) cachedBortle=await res.json();
  }catch(e){}
  const el=overlayEl?.querySelector('#ar-bortle');
  if(el&&cachedBortle){const b=cachedBortle.bortle||'?';el.textContent=`B${b}`;el.style.color=b<=3?'#00ff88':b<=5?'#ffcc00':'#ff4444';}
}

export function getARHeading(){return orientation.heading;}

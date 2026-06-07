/**
 * ARMode — Augmented Reality sky view using device IMU + GPS + camera.
 * Overlays a star compass and viewing data on the rear camera feed.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let orientation = { alpha: 0, beta: 0, gamma: 0, heading: 0 };
let animFrame = null;

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

    // Set location
    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;

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
  // alpha: compass heading (0-360), 0 = north
  // beta: front-back tilt (-180 to 180), 0 = flat
  // gamma: left-right tilt (-90 to 90), 0 = flat

  let heading = event.alpha; // Default: alpha is compass heading on Android

  // On iOS, use webkitCompassHeading if available
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  }

  // Normalize
  if (heading == null || isNaN(heading)) heading = 0;
  heading = ((heading % 360) + 360) % 360;

  orientation = {
    alpha: event.alpha || 0,
    beta: event.beta || 0,
    gamma: event.gamma || 0,
    heading,
  };
}

function renderLoop() {
  if (!arActive) return;

  updateOverlay();
  animFrame = requestAnimationFrame(renderLoop);
}

function updateOverlay() {
  if (!overlayEl) return;

  const h = orientation.heading;
  const beta = orientation.beta; // pitch: -90=up, 0=flat, 90=down
  const altitude = 90 - Math.abs(beta); // approximate altitude angle

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
    altLabel.textContent = `${Math.round(altitude)}°`;
  }

  // Update viewing bearing in main map (if window._arBearingCallback is set)
  const lat = parseFloat(overlayEl.dataset.lat);
  const lon = parseFloat(overlayEl.dataset.lon);
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') {
    window._arBearingCallback(h, lat, lon);
  }
}

// Export bearing for the bearing slider
export function getARHeading() {
  return orientation.heading;
}

/**
 * ARMode - Canvas-based AR using Stellarium Web Engine directly.
 * Heading -> engine observer.yaw, no iframes, no reloads, instant updates.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let stel = null;
let canvasEl = null;
let smoothHeading = 0;
let smoothAltitude = 45;
const LP = 0.10;
let animFrame = null;
let sensor = null;
let sensorReady = false;
let engineReady = false;
let initLat = 0, initLon = 0;
let skyOpacity = 0.92;
let timeOffsetHours = 0;

export function isARActive() { return arActive; }

export function preloadStellarium(lat, lon) {
  // Just store location - engine will be initialized on the AR canvas when opened
  initLat = lat; initLon = lon;
}

function quatToHdg(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  // Raw +Y heading from quaternion (sensor frame)
  return ((Math.atan2(2*(x*y + w*z), 1 - 2*(y*y + z*z)) * 180/Math.PI) + 360) % 360;
}

function quatToAlt(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  // Elevation of +Z from quaternion: asin(1 - 2*(x² + y²))
  // Flat=90° zenith, vertical=0° horizon
  var pitch = Math.asin(Math.max(-1, Math.min(1, 1 - 2*(x*x + y*y))));
  return Math.abs(pitch * 180 / Math.PI);
}

function angleDelta(a, b) {
  var d = ((a % 360) + 360) % 360 - ((b % 360) + 360) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

async function startSensor() {
  if (typeof AbsoluteOrientationSensor !== 'undefined') {
    try {
      sensor = new AbsoluteOrientationSensor({ frequency: 60 });
      sensor.addEventListener('reading', function() {
        var q = sensor.quaternion;
        if (q) { sensorReady = true; smoothHeading += LP * angleDelta(quatToHdg(q), smoothHeading); smoothAltitude += LP * (quatToAlt(q) - smoothAltitude); }
      });
      sensor.addEventListener('error', function() { sensorReady = false; sensor = null; });
      sensor.start();
      return;
    } catch (e) { sensor = null; }
  }
  window.addEventListener('deviceorientationabsolute', handleEvent, true);
  window.addEventListener('deviceorientation', handleEvent, true);
}

function handleEvent(event) {
  if (sensorReady) return;
  var isAbs = event.type === 'deviceorientationabsolute';
  // Detect orientation: screen.orientation API or window.orientation fallback
  var isLandscape = false;
  try {
    if (screen.orientation && screen.orientation.type) {
      isLandscape = String(screen.orientation.type).startsWith('landscape');
    } else if (typeof window.orientation !== 'undefined') {
      isLandscape = Math.abs(window.orientation || 0) === 90;
    }
  } catch(e) { isLandscape = false; }
  var raw;
  if (event.webkitCompassHeading !== undefined) raw = event.webkitCompassHeading;
  else if (isAbs && event.alpha != null) raw = event.alpha;
  else if (!isAbs && event.alpha != null) {
    raw = event.alpha;
    var sa = 0;
    try { sa = (screen.orientation && screen.orientation.angle != null) ? screen.orientation.angle : (window.orientation || 0); } catch(e) {}
    raw = (raw - sa + 360) % 360;
  } else return;
  if (raw == null || isNaN(raw)) raw = 0;
  smoothHeading += LP * angleDelta(raw, smoothHeading);
  // Pitch: Android uses alpha, iOS uses beta
  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var pitchAngle;
  if (isIOS) {
    pitchAngle = 90 - Math.abs(event.beta || 0);
  } else {
    pitchAngle = Math.abs(event.alpha || 0);
  }
  var rawAlt = Math.max(0, Math.min(90, pitchAngle));
  smoothAltitude += LP * (rawAlt - smoothAltitude);
}

function stopSensor() {
  if (sensor) { sensor.stop(); sensor = null; }
  sensorReady = false;
  window.removeEventListener('deviceorientationabsolute', handleEvent, true);
  window.removeEventListener('deviceorientation', handleEvent, true);
}

export async function startARMode(latitude, longitude, onStop) {
  if (arActive) return;
  var overlay = document.getElementById('ar-overlay');
  var video = document.getElementById('ar-video');
  canvasEl = document.getElementById('ar-sky');
  if (!overlay || !video || !canvasEl) return;
  try {
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.style.filter = 'brightness(0.55)';
    await video.play();
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted')
        throw new Error('Motion permission denied');
    }
    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;
    overlayEl.dataset.lat = latitude;
    overlayEl.dataset.lon = longitude;
    smoothHeading = 0;
    smoothAltitude = 45;

    // Init engine directly on AR canvas (like test-engine.html)
    if (typeof StelWebEngine === 'undefined') {
      console.log('[AR] StelWebEngine not loaded');
      return;
    }
    if (!window._stelEngineInit) {
      window._stelEngineInit = true;
      console.log('[AR] Initializing engine on AR canvas...');
      StelWebEngine({
        wasmFile: 'lib/stellarium-web-engine.wasm',
        canvas: canvasEl,
        onReady: function(engine) {
          console.log('[AR] Engine READY');
          stel = engine;
          engineReady = true;
          var base = '/test-skydata/';
          stel.core.stars.addDataSource({ url: base + 'stars' });
          stel.core.skycultures.addDataSource({ url: base + 'skycultures/western', key: 'western' });
          stel.core.dsos.addDataSource({ url: base + 'dso' });
          stel.core.milkyway.addDataSource({ url: base + 'surveys/milkyway' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/sun', key: 'sun' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/moon', key: 'moon' });
          if (stel.core.landscapes) stel.core.landscapes.addDataSource({ url: base + 'landscapes/guereins', key: 'guereins' });
          // Show constellation lines & art
          if (stel.core.constellations) {
            stel.core.constellations.lines_visible = true;
            stel.core.constellations.labels_visible = true;
          }
          if (stel.core.atmosphere) stel.core.atmosphere.visible = false;
          if (stel.core.landscapes) stel.core.landscapes.visible = true;
          // Time: set to now (MJD)
          if (stel.core.observer && typeof stel.date2MJD === 'function') {
            stel.core.observer.utc = stel.date2MJD(new Date());
          }
          // Labels
          if (stel.core.stars) stel.core.stars.hints_visible = true;
          if (stel.core.planets) stel.core.planets.hints_visible = true;
          stel.core.observer.latitude = latitude * Math.PI / 180;
          stel.core.observer.longitude = longitude * Math.PI / 180;
          stel.core.observer.pitch = 45 * Math.PI / 180;
          stel.core.observer.yaw = 0;
          console.log('[AR] Catalogs & observer set');
          setupSliders();
        }
      });
    } else if (engineReady && stel) {
      // Already initialized from a previous AR session
      stel.core.observer.latitude = latitude * Math.PI / 180;
      stel.core.observer.longitude = longitude * Math.PI / 180;
      stel.core.observer.pitch = 45 * Math.PI / 180;
      stel.core.observer.yaw = 0;
      if (typeof stel.date2MJD === 'function') stel.core.observer.utc = stel.date2MJD(new Date());
    }
    startSensor();
    setupSliders();
    renderLoop();
  } catch (err) {
    console.error('AR failed:', err);
    stopARMode();
    if (onStop) onStop(err.message);
  }
}

export function stopARMode() {
  arActive = false;
  if (videoEl && videoEl.srcObject) { videoEl.srcObject.getTracks().forEach(function(t){t.stop()}); videoEl.srcObject = null; }
  if (videoEl) videoEl.style.filter = '';
  videoEl = null;
  canvasEl = null;
  if (overlayEl) overlayEl.classList.add('hidden');
  overlayEl = null;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  skyOpacity = 0.92;
  timeOffsetHours = 0;
  stopSensor();
}

function setupSliders() {
  var opSlider = document.getElementById('ar-opacity');
  var opVal = document.getElementById('ar-opacity-val');
  if (opSlider && opVal) {
    opSlider.value = Math.round(skyOpacity * 100);
    opVal.textContent = Math.round(skyOpacity * 100) + '%';
    opSlider.addEventListener('input', function() {
      skyOpacity = parseInt(this.value) / 100;
      opVal.textContent = this.value + '%';
      if (canvasEl) canvasEl.style.opacity = skyOpacity;
    });
  }
  var tmSlider = document.getElementById('ar-time');
  var tmVal = document.getElementById('ar-time-val');
  if (tmSlider && tmVal) {
    tmSlider.value = timeOffsetHours;
    tmVal.textContent = formatTimeOffset(timeOffsetHours);
    tmSlider.addEventListener('input', function() {
      timeOffsetHours = parseInt(this.value);
      tmVal.textContent = formatTimeOffset(timeOffsetHours);
    });
  }

  // Toggle buttons — match engine state
  setupToggle('ar-btn-atmo', 'atmosphere', false);
  setupToggle('ar-btn-ground', 'landscapes', true);
  setupToggle('ar-btn-grid', 'lines', {sub: 'equatorial', def: false});

  function setupToggle(id, prop, opts) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var defOn = (typeof opts === 'boolean') ? opts : (opts && opts.def);
    if (defOn) btn.classList.add('active');
    btn.addEventListener('click', function() {
      btn.classList.toggle('active');
      var on = btn.classList.contains('active');
      if (engineReady && stel && stel.core) {
        var obj = stel.core[prop];
        if (obj) {
          if (opts && opts.sub) {
            if (obj[opts.sub]) obj[opts.sub].visible = on;
          } else {
            obj.visible = on;
          }
        }
        if (prop === 'lines' && stel.core.lines && stel.core.lines.azimuthal) {
          stel.core.lines.azimuthal.visible = on;
        }
      }
    });
  }

}

function formatTimeOffset(hours) {
  if (hours === 0) return 'now';
  var sign = hours > 0 ? '+' : '';
  var d = Math.floor(Math.abs(hours) / 24);
  var h = Math.abs(hours) % 24;
  if (d > 0 && h === 0) return sign + d + 'd';
  if (d > 0) return sign + d + 'd' + h + 'h';
  return sign + h + 'h';
}

function renderLoop() {
  if (!arActive) return;
  var h = ((smoothHeading % 360) + 360) % 360;
  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.yaw = (-h) * Math.PI / 180;
    stel.core.observer.pitch = smoothAltitude * Math.PI / 180;
    if (typeof stel.date2MJD === 'function') {
      stel.core.observer.utc = stel.date2MJD(new Date()) + timeOffsetHours / 24;
    }
  }
  if (canvasEl) canvasEl.style.opacity = skyOpacity;
  var ring = overlayEl && overlayEl.querySelector('.ar-compass-face');
  if (ring) ring.style.transform = 'rotate(' + h + 'deg)';
  var lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  var lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') window._arBearingCallback(h, lat, lon);
  var dbg = document.getElementById('ar-debug');
  var engLat = (engineReady && stel && stel.core && stel.core.observer) ? stel.core.observer.latitude * 180 / Math.PI : NaN;
  var engLon = (engineReady && stel && stel.core && stel.core.observer) ? stel.core.observer.longitude * 180 / Math.PI : NaN;
  if (dbg) dbg.textContent = (sensorReady?'SENSOR':'EVENT') + ' | hdg:' + h.toFixed(1) + '\xB0 alt:' + smoothAltitude.toFixed(1) + '\xB0 | loc:' + (isNaN(engLat)?'--':engLat.toFixed(2)+','+engLon.toFixed(2)) + ' | ' + formatTimeOffset(timeOffsetHours);
  animFrame = requestAnimationFrame(renderLoop);
}

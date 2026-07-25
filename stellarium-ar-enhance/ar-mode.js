/**
 * ARMode - Canvas-based AR using Stellarium Web Engine directly.
 * Heading -> engine observer.yaw, no iframes, no reloads, instant updates.
 */

import { analyzeFrame, estimateBortleFromCamera, resetCameraBortle } from './core/sky-sense.js';
import { getBortlePreset } from './core/bortle-presets.js';

let arActive = false;
let videoEl = null;
let overlayEl = null;
let stel = null;
let canvasEl = null;
let smoothHeading = 0;
let smoothAltitude = 45;
const LP = 0.1;
let animFrame = null;
let sensor = null;
let sensorReady = false;
let engineReady = false;
let initLat = 0,
  initLon = 0;
let skyOpacity = 0.65; // 65% sky — balance between seeing stars & camera view
let timeOffsetHours = 0;
let engineScriptLoaded = false;
let cameraBortle = null;
let bortleFrameCounter = 0;
let guideDismissed = false;
let guideOverlayVisible = false;
let slidersSetupDone = false;
let arFov = 60; // Field of view for AR sky
let baseArFov = 60; // Original FOV at AR start, for digital zoom calc
let pinchDist0 = 0;
let cameraLensMm = null;   // actual camera focal length from hardware
let cameraLensMatched = false;

// ─── Read camera lens focal length from hardware ───
// Note: MediaTrackSettings.focalLength is the PHYSICAL focal length (e.g. 4.25mm).
// The browser does not expose sensor size, so we cannot convert to 35mm-equivalent
// or compute the true FOV without knowing the sensor dimensions.
// Common phone sensors: 1/3" (~4.8mm wide) to 1/1.3" (~9.8mm wide).
// We estimate crop factor from reported pixel dimensions as a rough heuristic.
function readCameraLens(videoTrack) {
  if (!videoTrack) return;
  try {
    var settings = videoTrack.getSettings();
    var capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;

    if (settings && settings.focalLength) {
      var physFocalMm = settings.focalLength;
      var sensorWidthMm = estimateSensorWidthMm(settings);
      cameraLensMm = physFocalMm;

      if (sensorWidthMm) {
        // We have an estimated sensor width — compute real FOV
        var realFov = (2 * Math.atan(sensorWidthMm / (2 * physFocalMm)) * 180) / Math.PI;
        arFov = Math.round(realFov);
        baseArFov = arFov; // set base for digital zoom
        // Also compute 35mm-equivalent for display
        var equiv35mm = (36 / sensorWidthMm) * physFocalMm;
        cameraLens35mmEq = Math.round(equiv35mm);
        console.log('[AR] Camera lens:', physFocalMm.toFixed(1) + 'mm phys',
          '| sensor ~' + sensorWidthMm.toFixed(1) + 'mm',
          '| ' + cameraLens35mmEq + 'mm equiv',
          '| FOV ' + arFov + '°');
      } else {
        // Can't estimate sensor size — don't change FOV, just record physical
        console.log('[AR] Camera lens:', physFocalMm.toFixed(1) + 'mm phys (sensor unknown, keeping default FOV)');
      }
      cameraLensMatched = true;

      if (capabilities && capabilities.focalLength) {
        console.log('[AR] Lens range:', capabilities.focalLength.min.toFixed(1) +
          '–' + capabilities.focalLength.max.toFixed(1) + 'mm phys');
      }
    } else {
      console.log('[AR] Camera focalLength not exposed, using default 60°');
      cameraLensMatched = false;
      cameraLensMm = null;
      cameraLens35mmEq = null;
    }
  } catch (e) {
    console.log('[AR] Camera lens read failed:', e.message);
    cameraLensMatched = false;
    cameraLensMm = null;
    cameraLens35mmEq = null;
  }
}

// ─── Estimate sensor width from video track settings ───
// Uses reported pixel width + common phone sensor pixel pitches (~1.0–1.4µm).
// This is a rough estimate (±20%) but better than nothing.
function estimateSensorWidthMm(settings) {
  // Prefer explicit sensor size if ever exposed
  if (settings.sensorWidth) return settings.sensorWidth;
  if (settings.sensorSize) return settings.sensorSize.width || settings.sensorSize;

  // Estimate from pixel dimensions + typical pixel pitch
  var pxW = settings.width;
  if (!pxW) return null;

  // Common phone sensor pixel pitches (µm) by resolution width
  var pitchUm;
  if (pxW >= 3840) pitchUm = 1.0;      // 4K sensor ~1.0µm
  else if (pxW >= 1920) pitchUm = 1.2; // 1080p sensor ~1.2µm
  else if (pxW >= 1280) pitchUm = 1.4; // 720p sensor ~1.4µm
  else pitchUm = 1.4;

  return (pxW * pitchUm) / 1000; // mm
}

let cameraLens35mmEq = null; // 35mm-equivalent focal length when hardware matched
let headingOffset = 0;       // sensor calibration offset (degrees)

// ─── AR Photo Capture ───
function captureARPhoto() {
  if (!videoEl || !canvasEl) return;
  var cw = canvasEl.width, ch = canvasEl.height;
  if (!cw) { cw = window.innerWidth; ch = window.innerHeight; }

  // Direct pixel read from WebGL — the ONLY reliable way without preserveDrawingBuffer
  var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
  var skyCanvas = document.createElement('canvas');
  skyCanvas.width = cw; skyCanvas.height = ch;
  var skyCtx = skyCanvas.getContext('2d');

  if (gl) {
    // Read the current WebGL framebuffer
    var pixels = new Uint8Array(cw * ch * 4);
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // WebGL origin is bottom-left, flip to top-left for canvas
    var imgData = skyCtx.createImageData(cw, ch);
    for (var y = 0; y < ch; y++) {
      var srcRow = (ch - 1 - y) * cw * 4;
      var dstRow = y * cw * 4;
      for (var x = 0; x < cw * 4; x++) imgData.data[dstRow + x] = pixels[srcRow + x];
    }
    skyCtx.putImageData(imgData, 0, 0);
  }

  // Composite: camera + sky (full opacity for capture)
  var oc = document.createElement('canvas'); oc.width = cw; oc.height = ch;
  var ctx = oc.getContext('2d');
  var vw = videoEl.videoWidth || 1280, vh = videoEl.videoHeight || 720;
  var scale = Math.max(cw / vw, ch / vh);
  ctx.drawImage(videoEl, (cw - vw * scale) / 2, (ch - vh * scale) / 2, vw * scale, vh * scale);
  ctx.globalAlpha = 1; // always full opacity for captured photo
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(skyCanvas, 0, 0, cw, ch);
  ctx.globalAlpha = 1;

  oc.toBlob(function(blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'stargaze-ar-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.png';
    a.click(); URL.revokeObjectURL(url);
    showCaptureToast();
  }, 'image/png');
}

function showCaptureToast() {
  var toast = document.getElementById('ar-capture-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ar-capture-toast';
    toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:rgba(0,0,0,0.8);color:#0f0;padding:12px 24px;border-radius:8px;' +
      'font-family:monospace;z-index:6000;pointer-events:none;transition:opacity 0.5s;';
    document.body.appendChild(toast);
  }
  toast.textContent = '📸 Captured!';
  toast.style.opacity = '1';
  setTimeout(function() { toast.style.opacity = '0'; }, 1500);
}

// ─── Camera Lens Focus Simulation ───
// Full-frame 35mm sensor horizontal width (36mm) for focal length conversion.
const SENSOR_W = 36;

function fovToFocalLength(fovDeg) {
  // f = sensor_width / (2 * tan(FOV/2))
  return SENSOR_W / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

function focalLengthToFov(fl) {
  // FOV = 2 * arctan(sensor_width / (2 * focal_length))
  return (2 * Math.atan(SENSOR_W / (2 * fl)) * 180) / Math.PI;
}

function getLensClass(fl) {
  if (fl <= 18) return 'wide';
  if (fl <= 35) return 'normal';
  if (fl <= 85) return 'tele';
  return 'super';
}

function getLensLabel(fl) {
  if (fl <= 14) return 'FISHEYE';
  if (fl <= 18) return 'ULTRA WIDE';
  if (fl <= 24) return 'WIDE';
  if (fl <= 35) return 'STANDARD';
  if (fl <= 60) return 'NORMAL';
  if (fl <= 85) return 'PORTRAIT';
  if (fl <= 135) return 'TELE';
  if (fl <= 200) return 'SUPER TELE';
  return 'EXTREME';
}

// ─── Digital zoom: scale the camera video to match sky FOV ───
function applyDigitalZoom() {
  var video = document.getElementById('ar-video');
  if (!video) return;
  // Ratio of angular sizes: how much to scale video so its FOV matches sky FOV
  var baseHalf = (baseArFov / 2) * Math.PI / 180;
  var currHalf = (arFov / 2) * Math.PI / 180;
  var scale = Math.tan(baseHalf) / Math.tan(currHalf);
  video.style.transform = 'scale(' + scale + ')';
  video.style.transformOrigin = 'center center';
  video.style.willChange = 'transform';
}

function updateLensIndicator() {
  var ring = document.getElementById('ar-lens-ring');
  var mm = document.getElementById('ar-lens-mm');
  var label = document.getElementById('ar-lens-label');
  var fovEl = document.getElementById('ar-lens-fov');
  if (!ring || !mm || !label || !fovEl) return;

  applyDigitalZoom();

  var fl = Math.round(fovToFocalLength(arFov));
  var fovRounded = Math.round(arFov);

  mm.textContent = fl + 'mm';
  label.textContent = getLensLabel(fl);
  fovEl.textContent = 'f/' + fovRounded + '°';

  // Show matched badge when reading from actual camera hardware
  if (cameraLensMatched && cameraLensMm) {
    if (cameraLens35mmEq) {
      mm.textContent = cameraLens35mmEq + 'mm';
      label.textContent = '📷 EQUIV';
      fovEl.textContent = cameraLensMm.toFixed(1) + 'mm phys';
    } else {
      mm.textContent = cameraLensMm.toFixed(1) + 'mm';
      label.textContent = '📷 PHYS';
      fovEl.textContent = 'f/' + fovRounded + '°';
    }
  }

  // Apply lens class for ring size + color
  ring.className = 'ar-lens-ring ' + getLensClass(fl);
}

function loadEngineScript() {
  if (engineScriptLoaded) return Promise.resolve();
  if (typeof StelWebEngine !== 'undefined') {
    engineScriptLoaded = true;
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'lib/stellarium-web-engine.js?v=2';
    s.onload = function () {
      engineScriptLoaded = true;
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function isARActive() {
  return arActive;
}

export function preloadStellarium(lat, lon) {
  // Just store location - engine will be initialized on the AR canvas when opened
  initLat = lat;
  initLon = lon;
}

function quatToHdg(q) {
  var x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  // Raw +Y heading from quaternion (sensor frame)
  return ((Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z)) * 180) / Math.PI + 360) % 360;
}

function quatToAlt(q) {
  var x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  // Elevation of +Z. Up=positive, engine wants up=negative.
  return (Math.asin(Math.max(-1, Math.min(1, 1 - 2 * (x * x + y * y)))) * 180) / Math.PI;
}

function angleDelta(a, b) {
  var d = (((a % 360) + 360) % 360) - (((b % 360) + 360) % 360);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

async function startSensor() {
  if (typeof AbsoluteOrientationSensor !== 'undefined') {
    try {
      sensor = new AbsoluteOrientationSensor({ frequency: 60 });
      sensor.addEventListener('reading', function () {
        var q = sensor.quaternion;
        if (q) {
          sensorReady = true;
          smoothHeading += LP * angleDelta(quatToHdg(q), smoothHeading);
          smoothAltitude += LP * (quatToAlt(q) - smoothAltitude);
        }
      });
      sensor.addEventListener('error', function () {
        sensorReady = false;
        sensor = null;
      });
      sensor.start();
      return;
    } catch (e) {
      sensor = null;
    }
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
  } catch (e) {
    isLandscape = false;
  }
  var raw;
  if (event.webkitCompassHeading !== undefined) raw = event.webkitCompassHeading;
  else if (isAbs && event.alpha != null) raw = event.alpha;
  else if (!isAbs && event.alpha != null) {
    raw = event.alpha;
    var sa = 0;
    try {
      sa = screen.orientation && screen.orientation.angle != null ? screen.orientation.angle : window.orientation || 0;
    } catch (e) {}
    raw = (raw - sa + 360) % 360;
  } else return;
  if (raw == null || isNaN(raw)) raw = 0;
  smoothHeading += LP * angleDelta(raw, smoothHeading);
  // Pitch from deviceorientation: use 90 - beta in portrait, 90 - |gamma| in landscape
  var pitchAngle = 0;
  if (isLandscape) {
    pitchAngle = 90 - Math.abs(event.gamma || 0);
  } else {
    pitchAngle = 90 - (event.beta || 0);
  }
  var rawAlt = Math.max(-90, Math.min(90, pitchAngle));
  smoothAltitude += LP * (rawAlt - smoothAltitude);
}

function stopSensor() {
  if (sensor) {
    sensor.stop();
    sensor = null;
  }
  sensorReady = false;
  window.removeEventListener('deviceorientationabsolute', handleEvent, true);
  window.removeEventListener('deviceorientation', handleEvent, true);
}

export async function startARMode(latitude, longitude, onStop, _motionAlreadyGranted) {
  if (arActive) return;
  var overlay = document.getElementById('ar-overlay');
  var video = document.getElementById('ar-video');
  canvasEl = document.getElementById('ar-sky');
  if (!overlay || !video || !canvasEl) return;
  try {
    // Camera also needs a user gesture on iOS — this is still within the
    // gesture chain since the caller already did the sync permission check.
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    // Read actual camera lens focal length from hardware
    var videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) readCameraLens(videoTrack);

    // Motion permission: if not already granted by the caller (app.js),
    // try requesting it here as a fallback.
    if (
      !_motionAlreadyGranted &&
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('Motion permission denied');
    }

    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;
    overlayEl.dataset.lat = latitude;
    overlayEl.dataset.lon = longitude;
    smoothHeading = 0;
    smoothAltitude = 45;
    baseArFov = arFov;

    // Load engine script dynamically
    await loadEngineScript();

    // CRITICAL: engine must be available before showing HUD
    if (typeof StelWebEngine === 'undefined') {
      console.error('[AR] Stellarium engine script FAILED to load');
      stopARMode();
      if (onStop) onStop('Engine script failed to load');
      return;
    }

    if (!window._stelEngineInit) {
      window._stelEngineInit = true;
      var engineTimeout = setTimeout(function () {
        console.error('[AR] Engine init TIMEOUT - WASM may have failed');
        stopARMode();
        if (onStop) onStop('Engine timeout');
      }, 15000);

      // Pre-create WebGL context with preserveDrawingBuffer so capture works.
      // The engine will reuse this context instead of creating a new one.
      canvasEl.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: true, stencil: true });

      StelWebEngine({
        wasmFile: 'lib/stellarium-web-engine.wasm',
        canvas: canvasEl,
        onReady: function (engine) {
          clearTimeout(engineTimeout);
          stel = engine;
          engineReady = true;
          var base = '/test-skydata/';
          stel.core.stars.addDataSource({ url: base + 'stars' });
          stel.core.skycultures.addDataSource({ url: base + 'skycultures/western', key: 'western' });
          stel.core.dsos.addDataSource({ url: base + 'dso' });
          stel.core.milkyway.addDataSource({ url: base + 'surveys/milkyway' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/sun', key: 'sun' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/moon', key: 'moon' });
          if (stel.core.landscapes)
            stel.core.landscapes.addDataSource({ url: base + 'landscapes/guereins', key: 'guereins' });
          if (stel.core.constellations) { stel.core.constellations.lines_visible = true; stel.core.constellations.labels_visible = true; }
          if (stel.core.atmosphere) stel.core.atmosphere.visible = false;
          if (stel.core.landscapes) stel.core.landscapes.visible = true;
          if (stel.core.stars) stel.core.stars.hints_visible = true;
          if (stel.core.planets) stel.core.planets.hints_visible = true;
          stel.core.observer.fov = (arFov * Math.PI) / 180;
          setupARZoom(canvasEl);
          updateLensIndicator();
          if (stel.core.landscapes)
            stel.core.landscapes.addDataSource({ url: base + 'landscapes/guereins', key: 'guereins' });
          // Show constellation lines & art
          if (stel.core.constellations) {
            stel.core.constellations.lines_visible = true;
            stel.core.constellations.labels_visible = true;
          }
          if (stel.core.atmosphere) stel.core.atmosphere.visible = false;
          if (stel.core.landscapes) stel.core.landscapes.visible = true;
          // Initialize grid lines (both equatorial and azimuthal, but hidden by default)
          if (stel.core.lines) {
            if (stel.core.lines.equatorial) stel.core.lines.equatorial.visible = false;
            if (stel.core.lines.azimuthal) stel.core.lines.azimuthal.visible = false;
            if (stel.core.lines.ecliptic) stel.core.lines.ecliptic.visible = true;
          }
          // Time: set to now (MJD)
          if (stel.core.observer && typeof stel.date2MJD === 'function') {
            stel.core.observer.utc = stel.date2MJD(new Date());
          }
          // Labels
          if (stel.core.stars) stel.core.stars.hints_visible = true;
          if (stel.core.planets) stel.core.planets.hints_visible = true;
          stel.core.observer.latitude = (latitude * Math.PI) / 180;
          stel.core.observer.longitude = (longitude * Math.PI) / 180;
          stel.core.observer.pitch = (45 * Math.PI) / 180;
          stel.core.observer.yaw = 0;
          console.log('[AR] Catalogs & observer set');
          setupSliders();
        },
      });
    } else if (engineReady && stel) {
      // Already initialized from a previous AR session
      stel.core.observer.latitude = (latitude * Math.PI) / 180;
      stel.core.observer.longitude = (longitude * Math.PI) / 180;
      stel.core.observer.pitch = (45 * Math.PI) / 180;
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
  // Do NOT reset slidersSetupDone — DOM elements persist, listeners stay attached once
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(function (t) {
      t.stop();
    });
    videoEl.srcObject = null;
  }
  videoEl = null;
  canvasEl = null;
  arFov = 60;
  baseArFov = 60;
  cameraLensMm = null;
  cameraLens35mmEq = null;
  cameraLensMatched = false;
  updateLensIndicator();
  applyDigitalZoom();
  // Reset sky/ground mask
  arSkyMaskEnabled = false;
  if (canvasEl) {
    canvasEl.style.webkitMaskImage = '';
    canvasEl.style.maskImage = '';
  }
  headingOffset = 0;
  if (overlayEl) overlayEl.classList.add('hidden');
  overlayEl = null;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  skyOpacity = 0.65;
  timeOffsetHours = 0;
  arTimeAnimSpeed = 0;
  if (arTimeAnimId) {
    cancelAnimationFrame(arTimeAnimId);
    arTimeAnimId = null;
  }
  cameraBortle = null;
  bortleFrameCounter = 0;
  guideOverlayVisible = false;
  // Clear stale guide auto-dismiss timer so it doesn't fire after AR is closed
  if (guideAutoDismissTimer) {
    clearTimeout(guideAutoDismissTimer);
    guideAutoDismissTimer = null;
  }
  resetCameraBortle();
  stopSensor();
  // Allow engine to reinitialize on next AR session (was permanently locked)
  window._stelEngineInit = false;
  // Reset slider flag so listeners are re-attached on next AR open
  slidersSetupDone = false;
}

function setupSliders() {
  // Attach listeners once per page lifetime (DOM elements persist across AR sessions)
  if (slidersSetupDone) return;
  slidersSetupDone = true;

  // Controls collapse toggle
  var ctrlToggle = document.getElementById('ar-controls-toggle');
  var ctrlPanel = document.getElementById('ar-controls');
  if (ctrlToggle && ctrlPanel) {
    ctrlToggle.addEventListener('click', function () {
      ctrlPanel.classList.toggle('collapsed');
      ctrlToggle.textContent = ctrlPanel.classList.contains('collapsed') ? '\u25BC' : '\u25B2';
    });
  }

  var opSlider = document.getElementById('ar-opacity');
  var opVal = document.getElementById('ar-opacity-val');
  if (opSlider && opVal) {
    opSlider.value = Math.round(skyOpacity * 100);
    opVal.textContent = Math.round(skyOpacity * 100) + '%';
    if (canvasEl) { canvasEl.style.opacity = skyOpacity; canvasEl.style.mixBlendMode = skyOpacity >= 0.98 ? 'normal' : 'screen'; }
    opSlider.addEventListener('input', function () {
      skyOpacity = parseInt(this.value) / 100;
      opVal.textContent = this.value + '%';
      if (canvasEl) {
        canvasEl.style.opacity = skyOpacity;
        // At 100%: normal blend (fully opaque sky). Below: screen blend (stars on camera)
        canvasEl.style.mixBlendMode = skyOpacity >= 0.98 ? 'normal' : 'screen';
      }
    });
  }
  // Brightness slider + Camera exp/iso controls
  var arBrSlider = document.getElementById('ar-brightness');
  var arBrVal = document.getElementById('ar-brightness-val');
  var skyBrightness = 150;
  if (arBrSlider && arBrVal && canvasEl) {
    arBrSlider.value = skyBrightness;
    arBrVal.textContent = (skyBrightness / 100).toFixed(1) + String.fromCharCode(215);
    canvasEl.style.filter = 'brightness(' + (skyBrightness / 100) + ')';
    arBrSlider.addEventListener('input', function () {
      skyBrightness = parseInt(this.value);
      arBrVal.textContent = (skyBrightness / 100).toFixed(1) + String.fromCharCode(215);
      if (canvasEl) canvasEl.style.filter = 'brightness(' + (skyBrightness / 100) + ')';
    });
  }
  var arExpMode = document.getElementById('ar-exp-mode');
  var arExpValEl = document.getElementById('ar-exp-val');
  var arShutterSlider = document.getElementById('ar-shutter');
  var arShutterValEl = document.getElementById('ar-shutter-val');
  var arIsoSlider = document.getElementById('ar-iso');
  var arIsoValEl = document.getElementById('ar-iso-val');
  function arExpToSlider(us) { return Math.round(Math.min(100, Math.max(1, (Math.log2(us) - Math.log2(1000)) * 10))); }
  function arSliderToExp(v) { return Math.round(Math.pow(2, v / 10) * 1000); }
  function arIsoToSlider(iso) { return Math.round(Math.min(100, Math.max(1, (Math.log2(iso) - Math.log2(100)) * 20))); }
  function arSliderToIso(v) { return Math.round(Math.pow(2, v / 20) * 100); }
  function arGetVideoTrack() { return videoEl && videoEl.srcObject ? videoEl.srcObject.getVideoTracks()[0] : null; }
  function arApplyExp() {
    var t = arGetVideoTrack();
    if (!t || !t.applyConstraints) return;
    t.applyConstraints({ advanced: [{ exposureTime: arSliderToExp(parseInt(arShutterSlider.value)), iso: arSliderToIso(parseInt(arIsoSlider.value)) }] }).catch(function () { });
  }
  if (arExpMode) {
    arExpMode.addEventListener('change', function () {
      var man = this.value === 'manual';
      arShutterSlider.disabled = !man;
      arIsoSlider.disabled = !man;
      var t = arGetVideoTrack();
      if (t && t.applyConstraints) {
        t.applyConstraints({ advanced: [{ exposureMode: man ? 'manual' : 'continuous' }] })
          .then(function () {
            arExpValEl.textContent = man ? 'manual' : 'auto';
            if (man) { var s = t.getSettings(); arShutterSlider.value = arExpToSlider(s.exposureTime || 33333); arIsoSlider.value = arIsoToSlider(s.iso || 800); arUpdateShutterLabel(); arUpdateIsoLabel(); }
          }).catch(function (e) { console.warn('[AR] Exposure:', e); });
      }
    });
  }
  function arUpdateShutterLabel() { var us = arSliderToExp(parseInt(arShutterSlider.value)); arShutterValEl.textContent = us >= 1000000 ? (us / 1000000).toFixed(1) + 's' : '1/' + Math.round(1000000 / us) + 's'; }
  function arUpdateIsoLabel() { arIsoValEl.textContent = arSliderToIso(parseInt(arIsoSlider.value)); }
  if (arShutterSlider) arShutterSlider.addEventListener('input', function () { arUpdateShutterLabel(); arApplyExp(); });
  if (arIsoSlider) arIsoSlider.addEventListener('input', function () { arUpdateIsoLabel(); arApplyExp(); });
  var tmSlider = document.getElementById('ar-time');
  var tmVal = document.getElementById('ar-time-val');
  if (tmSlider && tmVal) {
    tmSlider.value = timeOffsetHours;
    tmVal.textContent = formatTimeOffset(timeOffsetHours);
    tmSlider.addEventListener('input', function () {
      timeOffsetHours = parseInt(this.value);
      tmVal.textContent = formatTimeOffset(timeOffsetHours);
    });
  }

  // --- Toggle buttons ---
  setupToggle('ar-btn-atmo', 'atmosphere', false);
  setupToggle('ar-btn-ground', 'landscapes', true);
  setupToggle('ar-btn-grid', 'gridlines', { dual: true, def: false });

  // Sky/Ground mask toggle — uses custom handler since it's not a core property
  var maskBtn = document.getElementById('ar-btn-mask');
  if (maskBtn) {
    if (arSkyMaskEnabled) maskBtn.classList.add('active');
    maskBtn.addEventListener('click', function () {
      arSkyMaskEnabled = !arSkyMaskEnabled;
      maskBtn.classList.toggle('active', arSkyMaskEnabled);
      updateSkyGroundMask();
    });
  }

  // Calibrate heading button
  var calBtn = document.getElementById('ar-calibrate-btn');
  if (calBtn) {
    calBtn.addEventListener('click', function () {
      headingOffset = smoothHeading;
      calBtn.classList.add('calibrated');
      setTimeout(function () { calBtn.classList.remove('calibrated'); }, 2000);
    });
  }

  // Capture photo button
  var capBtn = document.getElementById('ar-capture-btn');
  if (capBtn) {
    capBtn.addEventListener('click', function () {
      captureARPhoto();
    });
  }

  // Bortle guided capture
  var bortleBtn = document.getElementById('ar-bortle-btn');
  var bortleOverlay = document.getElementById('ar-bortle-overlay');
  var bortleMeasure = document.getElementById('ar-bortle-measure');
  var bortleClose = document.getElementById('ar-bortle-close');
  var bortleResult = document.getElementById('ar-bortle-result');
  var bortleClass = document.getElementById('ar-bortle-class');
  var bortleLabel = document.getElementById('ar-bortle-label');
  var bortleHint = document.getElementById('ar-bortle-hint');
  var bortleSample = document.getElementById('ar-bortle-sample');

  if (bortleBtn && bortleOverlay) {
    bortleBtn.addEventListener('click', function () {
      bortleOverlay.classList.remove('hidden');
      bortleResult.style.display = 'none';
      bortleHint.textContent = 'Point camera at a clear patch of sky (no clouds, no lights). Then tap Measure.';
      bortleSample.style.background = '';
    });
  }
  if (bortleClose && bortleOverlay) {
    bortleClose.addEventListener('click', function () {
      bortleOverlay.classList.add('hidden');
    });
  }
  if (bortleMeasure && bortleOverlay) {
    bortleMeasure.addEventListener('click', function () {
      if (!videoEl) return;
      var raw = analyzeFrame(videoEl);
      if (!raw) return;

      // Map to Bortle (same thresholds as sky-sense.js)
      var b;
      if (raw.avgLum < 20) b = 1;
      else if (raw.avgLum < 42) b = 2;
      else if (raw.avgLum < 68) b = 3;
      else if (raw.avgLum < 95) b = 4;
      else if (raw.avgLum < 120) b = 5;
      else if (raw.avgLum < 148) b = 6;
      else if (raw.avgLum < 180) b = 7;
      else if (raw.avgLum < 215) b = 8;
      else b = 9;

      var labels = ['', 'Excellent dark-sky', 'Truly dark site', 'Rural sky', 'Brighter rural', 'Suburban', 'Bright suburban', 'Suburban/urban', 'City sky', 'Inner-city'];
      bortleClass.textContent = 'B' + b;
      bortleLabel.textContent = labels[b] || '';
      bortleResult.style.display = 'flex';
      bortleHint.textContent = raw.avgLum.toFixed(1) + ' avg luminance | ' + raw.darkPct.toFixed(0) + '% dark pixels';

      // Show a gradient matching the sky sample
      var hue = Math.max(0, 240 - b * 20);
      bortleSample.style.background = 'linear-gradient(to bottom, hsl(' + hue + ',60%,' + Math.max(2, 20 - b * 2) + '%), hsl(' + hue + ',40%,' + Math.min(80, 30 + b * 8) + '%))';
    });
  }

  // --- AR Time/Date panel ---
  setupARTimePanel();

  function setupToggle(id, prop, opts) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var defOn = typeof opts === 'boolean' ? opts : opts && opts.def;
    if (defOn) btn.classList.add('active');
    btn.addEventListener('click', function () {
      btn.classList.toggle('active');
      var on = btn.classList.contains('active');
      if (!engineReady || !stel || !stel.core) return;

      if (opts && opts.dual) {
        // Dual toggle: grid toggles both equatorial AND azimuthal lines
        var obj = stel.core.lines;
        if (obj) {
          if (obj.equatorial) obj.equatorial.visible = on;
          if (obj.azimuthal) obj.azimuthal.visible = on;
        }
      } else {
        var obj = stel.core[prop];
        if (obj && 'visible' in obj) {
          obj.visible = on;
        }
      }
    });
  }

  // --- AR Time Transport Buttons ---
  setupTimeTransport();

  // --- Auto-Match button ---
  var autoBtn = document.getElementById('ar-auto-match');
  if (autoBtn)
    autoBtn.addEventListener('click', function () {
      autoMatchSky();
    });

  // --- Phone guide button ---
  var guideBtn = document.getElementById('ar-guide-btn');
  var guideDismiss = document.getElementById('ar-guide-dismiss');
  var guideOverlay = document.getElementById('ar-guide');
  if (guideBtn)
    guideBtn.addEventListener('click', function () {
      showPhoneGuide();
    });
  if (guideDismiss)
    guideDismiss.addEventListener('click', function () {
      dismissPhoneGuide(true);
    });
  // Tap overlay background to dismiss (without saving preference)
  if (guideOverlay)
    guideOverlay.addEventListener('click', function (e) {
      if (e.target === guideOverlay) dismissPhoneGuide(false);
    });

  // --- Show guide on first AR open ---
  try {
    guideDismissed = localStorage.getItem('arguide_dismissed') === '1';
  } catch (e) {
    guideDismissed = false;
  }
  if (!guideDismissed) {
    guideAutoDismissTimer = setTimeout(function () {
      showPhoneGuide();
    }, 2000);
  }
}

// --- Time animation state ---
var arTimeAnimId = null;
var arTimeAnimSpeed = 0;
var arTimeAnimLastTs = 0;

var _timeTransportSetupDone = false;

function setupTimeTransport() {
  if (_timeTransportSetupDone) return;
  _timeTransportSetupDone = true;
  var playBtn = document.getElementById('ar-time-play');
  var rewBtn = document.getElementById('ar-time-rew');
  var bwdBtn = document.getElementById('ar-time-bwd');
  var fwdBtn = document.getElementById('ar-time-fwd');
  var stopBtn = document.getElementById('ar-time-stop');
  var slider = document.getElementById('ar-time');
  var valEl = document.getElementById('ar-time-val');

  // Hold-to-run with pointer capture — no premature stops from finger wiggle
  if (playBtn) {
    playBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      this.setPointerCapture(e.pointerId);
      arTimeStart(1);
    });
    playBtn.addEventListener('pointerup', function (e) {
      e.preventDefault();
      arTimePause();
    });
    playBtn.addEventListener('pointercancel', function (e) {
      arTimePause();
    });
  }
  if (rewBtn) {
    rewBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      this.setPointerCapture(e.pointerId);
      arTimeStart(-3);
    });
    rewBtn.addEventListener('pointerup', function (e) {
      e.preventDefault();
      arTimePause();
    });
    rewBtn.addEventListener('pointercancel', function (e) {
      arTimePause();
    });
  }
  if (bwdBtn)
    bwdBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      arTimeStep(-0.25);
    });
  if (fwdBtn)
    fwdBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      arTimeStep(1);
    });
  if (stopBtn)
    stopBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      arTimeStop();
    });

  if (slider) {
    slider.addEventListener('input', function () {
      timeOffsetHours = parseInt(this.value) || 0;
      if (valEl) valEl.textContent = formatTimeOffset(timeOffsetHours);
      updateRealtimeLabel();
    });
  }
}

function arTimeStep(hours) {
  timeOffsetHours += hours;
  timeOffsetHours = Math.round(timeOffsetHours * 4) / 4; // round to 15min
  timeOffsetHours = Math.max(-168, Math.min(168, timeOffsetHours));
  var slider = document.getElementById('ar-time');
  var valEl = document.getElementById('ar-time-val');
  if (slider) slider.value = timeOffsetHours;
  if (valEl) valEl.textContent = formatTimeOffset(timeOffsetHours);
  updateRealtimeLabel();
}

function arTimeStart(speedHoursPerSec) {
  arTimeAnimSpeed = speedHoursPerSec;
  arTimeAnimLastTs = performance.now();
  _arUpdateTransportUI(speedHoursPerSec);
  if (arTimeAnimId) cancelAnimationFrame(arTimeAnimId);
  arTimeAnimTick();
}

function arTimePause() {
  arTimeAnimSpeed = 0;
  if (arTimeAnimId) {
    cancelAnimationFrame(arTimeAnimId);
    arTimeAnimId = null;
  }
  _arUpdateTransportUI(0);
  updateRealtimeLabel();
}

function arTimeStop() {
  arTimeAnimSpeed = 0;
  if (arTimeAnimId) {
    cancelAnimationFrame(arTimeAnimId);
    arTimeAnimId = null;
  }
  timeOffsetHours = 0;
  _arUpdateTransportUI(0);
  var slider = document.getElementById('ar-time');
  var valEl = document.getElementById('ar-time-val');
  if (slider) slider.value = 0;
  if (valEl) valEl.textContent = 'now';
  updateRealtimeLabel();
}

function arTimeAnimTick(ts) {
  if (arTimeAnimSpeed === 0) return;
  if (ts === undefined) ts = performance.now();
  var dt = (ts - arTimeAnimLastTs) / 1000;
  arTimeAnimLastTs = ts;
  var dh = arTimeAnimSpeed * dt;
  if (dh !== 0) arTimeStep(dh);
  if (arTimeAnimSpeed !== 0) {
    arTimeAnimId = requestAnimationFrame(arTimeAnimTick);
  }
}

function _arUpdateTransportUI(speed) {
  var playBtn = document.getElementById('ar-time-play');
  var rewBtn = document.getElementById('ar-time-rew');

  if (playBtn) {
    playBtn.style.background = 'rgba(255,255,255,0.1)';
    playBtn.style.borderColor = 'rgba(255,255,255,0.25)';
  }
  if (rewBtn) {
    rewBtn.style.background = 'rgba(255,255,255,0.1)';
    rewBtn.style.borderColor = 'rgba(255,255,255,0.25)';
  }

  if (speed > 0.5 && playBtn) {
    playBtn.style.background = 'rgba(0,255,136,0.3)';
    playBtn.style.borderColor = '#00ff88';
  } else if (speed < -0.5 && rewBtn) {
    rewBtn.style.background = 'rgba(0,255,136,0.3)';
    rewBtn.style.borderColor = '#00ff88';
  }
  updateRealtimeLabel();
}

function updateRealtimeLabel() {
  var el = document.getElementById('ar-time-realtime');
  if (!el) return;
  var now = new Date(Date.now() + timeOffsetHours * 3600000);
  var dd = String(now.getDate()).padStart(2, '0');
  var mm = String(now.getMonth() + 1).padStart(2, '0');
  var hh = String(now.getHours()).padStart(2, '0');
  var mi = String(now.getMinutes()).padStart(2, '0');
  var ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = dd + '/' + mm + ' ' + hh + ':' + mi + ':' + ss;
  if (arTimeAnimSpeed !== 0) {
    el.textContent += ' ' + (arTimeAnimSpeed > 0 ? '▶' : '◀');
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

// ─── AR Time/Date panel (same as sky map) ───
var _arTimePanelSetup = false;

function setupARTimePanel() {
  if (_arTimePanelSetup) return;
  _arTimePanelSetup = true;

  function getARSimDate() {
    return new Date(Date.now() + timeOffsetHours * 3600000);
  }

  function _toMinutes(sliderVal) { return (parseInt(sliderVal) + 720) % 1440; }
  function _toSlider(minutes) { return (minutes + 720) % 1440; }

  function _moonPhase(date) {
    var lp = 2551443;
    var ne = new Date(2000,0,6,18,14).getTime()/1000;
    var p = ((date.getTime()/1000 - ne) / lp) % 1;
    if (p<0) p+=1;
    var ill = ((1-Math.cos(p*2*Math.PI))/2*100).toFixed(0);
    return { ill: ill, phase: p };
  }

  function _moonRiseSet(date, moon) {
    var phase = moon.phase;
    var riseMin = (phase * 24 * 60 + 360) % (24*60);
    var setMin = (riseMin + 12*60 + 30) % (24*60);
    return { rise: riseMin, set: setMin };
  }

  function updateARClock() {
    var d = getARSimDate();
    var yr = document.getElementById('ar-yr');
    var mo = document.getElementById('ar-mo');
    var dy = document.getElementById('ar-dy');
    var h = document.getElementById('ar-h');
    var m = document.getElementById('ar-m');
    var s = document.getElementById('ar-s');
    var offsetEl = document.getElementById('ar-time-offset');
    if (yr) yr.textContent = d.getFullYear();
    if (mo) mo.textContent = String(d.getMonth() + 1).padStart(2, '0');
    if (dy) dy.textContent = String(d.getDate()).padStart(2, '0');
    if (h) h.textContent = String(d.getHours()).padStart(2, '0');
    if (m) m.textContent = String(d.getMinutes()).padStart(2, '0');
    if (s) s.textContent = String(d.getSeconds()).padStart(2, '0');
    if (offsetEl) offsetEl.textContent = formatTimeOffset(timeOffsetHours);

    // Update daylight slider + moon markers + gradient
    var dl = document.getElementById('ar-daylight');
    var moon = _moonPhase(d);
    var rs = _moonRiseSet(d, moon);
    var risePct = (_toSlider(rs.rise) / 1439 * 100);
    var setPct = (_toSlider(rs.set) / 1439 * 100);
    var rClamp = Math.max(24, Math.min(76, risePct));
    var sClamp = Math.max(24, Math.min(76, setPct));

    // Update markers
    var rm = document.getElementById('ar-moon-rise-marker');
    var sm = document.getElementById('ar-moon-set-marker');
    if (rm) { rm.style.left = risePct + '%'; rm.title = 'Moon rise ' + String(Math.floor(rs.rise/60)).padStart(2,'0') + ':' + String(rs.rise%60).padStart(2,'0'); }
    if (sm) { sm.style.left = setPct + '%'; sm.title = 'Moon set ' + String(Math.floor(rs.set/60)).padStart(2,'0') + ':' + String(rs.set%60).padStart(2,'0'); }

    if (dl && !arDaylightDragging) {
      dl.value = _toSlider(d.getHours() * 60 + d.getMinutes());
      // Update gradient with moonlight
      var t = parseInt(moon.ill) / 100; t = 0.2 + t * 0.8;
      var mcR = Math.round(30 + t * 110), mcG = Math.round(40 + t * 140), mcB = Math.round(60 + t * 140);
      var moonColor = '#' + mcR.toString(16).padStart(2,'0') + mcG.toString(16).padStart(2,'0') + mcB.toString(16).padStart(2,'0');
      var duskDawn = '#87CEEB 0%,#87CEEB 12%,#7ba8c8 12%,#7ba8c8 16%,#4a7090 16%,#4a7090 20%,#2a4460 20%,#2a4460 24%,';
      var dawnDusk = '#2a4460 76%,#2a4460 80%,#4a7090 80%,#4a7090 84%,#7ba8c8 84%,#7ba8c8 88%,#87CEEB 88%,#87CEEB 100%';
      var dn = '#0d1428';
      var grad;
      if (Math.abs(rClamp - sClamp) < 0.5) {
        grad = 'linear-gradient(90deg,' + duskDawn + dn + ' 24%,' + dn + ' 76%,' + dawnDusk + ')';
      } else if (rClamp < sClamp) {
        grad = 'linear-gradient(90deg,' + duskDawn + dn + ' 24%,' + dn + ' ' + rClamp.toFixed(1) + '%,' + moonColor + ' ' + rClamp.toFixed(1) + '%,' + moonColor + ' ' + sClamp.toFixed(1) + '%,' + dn + ' ' + sClamp.toFixed(1) + '%,' + dn + ' 76%,' + dawnDusk + ')';
      } else {
        grad = 'linear-gradient(90deg,' + duskDawn + moonColor + ' 24%,' + moonColor + ' ' + sClamp.toFixed(1) + '%,' + dn + ' ' + sClamp.toFixed(1) + '%,' + dn + ' ' + rClamp.toFixed(1) + '%,' + moonColor + ' ' + rClamp.toFixed(1) + '%,' + moonColor + ' 76%,' + dawnDusk + ')';
      }
      dl.style.background = grad;
    }

    // Update moon subtitle
    var sub = document.getElementById('ar-moon-subtitle');
    if (sub) {
      var totalMin = d.getHours() * 60 + d.getMinutes();
      var moonUp = rs.rise < rs.set ? (totalMin >= rs.rise && totalMin < rs.set) : (totalMin >= rs.rise || totalMin < rs.set);
      if (totalMin >= 480 && totalMin < 960) sub.textContent = '☀️ Daylight';
      else if (totalMin >= 420 && totalMin < 480 || totalMin >= 960 && totalMin < 1020) sub.textContent = '🌅 Dusk / Dawn';
      else if (moonUp && moon.ill > 10) sub.textContent = '🌕 Moonlight ' + moon.ill + '%';
      else if (moon.ill > 10) sub.textContent = '🌑 Moon below · ' + moon.ill + '%';
      else sub.textContent = '🌑 Dark Night';
    }
  }

  function syncTimeOffset() {
    // Update the daylight slider to match current time
    var d = getARSimDate();
    var dl = document.getElementById('ar-daylight');
    if (dl) dl.value = (d.getHours() * 60 + d.getMinutes() + 720) % 1440;
  }

  function applyTimeToAREngine() {
    if (!engineReady || !stel || !stel.core || !stel.core.observer || typeof stel.date2MJD !== 'function') return;
    var d = getARSimDate();
    stel.core.observer.utc = stel.date2MJD(d);
  }

  function adjustARField(field, delta) {
    var d = getARSimDate();
    if (field === 'yr') d.setFullYear(d.getFullYear() + delta);
    else if (field === 'mo') d.setMonth(d.getMonth() + delta);
    else if (field === 'dy') d.setDate(d.getDate() + delta);
    else if (field === 'h') d.setHours(d.getHours() + delta);
    else if (field === 'm') d.setMinutes(d.getMinutes() + delta);
    else if (field === 's') d.setSeconds(d.getSeconds() + delta);
    var now = new Date();
    timeOffsetHours = (d - now) / 3600000;
    syncTimeOffset();
    updateARClock();
    applyTimeToAREngine();
  }

  // Wire up date/time arrow buttons
  ['yr','mo','dy','h','m','s'].forEach(function(f) {
    var up = document.getElementById('ar-' + f + '-up');
    var dn = document.getElementById('ar-' + f + '-down');
    if (up) up.addEventListener('click', function() { adjustARField(f, 1); });
    if (dn) dn.addEventListener('click', function() { adjustARField(f, -1); });
  });

  // Reset button
  var reset = document.getElementById('ar-btn-reset');
  if (reset) reset.addEventListener('click', function() {
    timeOffsetHours = 0;
    arTimePause();
    syncTimeOffset();
    updateARClock();
  });

  // Play/pause
  var pause = document.getElementById('ar-btn-pause');
  if (pause) pause.addEventListener('click', function() {
    if (arTimeAnimSpeed === 0) arTimeStart(1);
    else arTimePause();
  });

  // Daylight slider
  var dl = document.getElementById('ar-daylight');
  var arDaylightDragging = false;
  if (dl) {
    dl.addEventListener('input', function() {
      arDaylightDragging = true;
      var mins = (parseInt(this.value) + 720) % 1440;
      var d = getARSimDate();
      d.setHours(0, mins, 0, 0);
      var now = new Date();
      timeOffsetHours = (d - now) / 3600000;
      updateARClock();
      applyTimeToAREngine();
    });
    dl.addEventListener('change', function() {
      arDaylightDragging = false;
    });
  }

  // Initial update
  updateARClock();
  setInterval(updateARClock, 1000);
}

// ─── Sky/Ground Mash Mask ───
// Uses device pitch to create a horizon-aware gradient mask on the sky canvas.
// Stars overlay on sky portion, camera-only on ground portion.
var arSkyMaskEnabled = false; // OFF by default

function updateSkyGroundMask() {
  if (!canvasEl) return;
  if (!arSkyMaskEnabled) {
    canvasEl.style.webkitMaskImage = '';
    canvasEl.style.maskImage = '';
    return;
  }

  // Vertical FOV = horizontal FOV / aspect ratio
  var ar = window.innerWidth / Math.max(1, window.innerHeight);
  var vFov = arFov / ar;

  // Horizon y-position in viewport (0=top, 1=bottom)
  // When pitch=0 (looking at horizon), horizon is at center (0.5)
  // When pitch>0 (looking up), horizon moves down (>0.5)
  // When pitch<0 (looking down), horizon moves up (<0.5)
  var horizonNorm = 0.5 + smoothAltitude / vFov;

  // If horizon is mostly outside the viewport, fill screen accordingly
  var blendPct = 15; // transition zone as % of viewport height

  if (horizonNorm <= 0.15) {
    // Looking down: horizon near/above top → all ground, no stars
    canvasEl.style.webkitMaskImage = 'linear-gradient(to bottom, transparent 0%, transparent 100%)';
    canvasEl.style.maskImage = 'linear-gradient(to bottom, transparent 0%, transparent 100%)';
    return;
  }
  if (horizonNorm >= 0.85) {
    // Looking up: horizon near/below bottom → all sky, all stars visible
    canvasEl.style.webkitMaskImage = 'linear-gradient(to bottom, black 0%, black 100%)';
    canvasEl.style.maskImage = 'linear-gradient(to bottom, black 0%, black 100%)';
    return;
  }

  // Horizon is within or near the viewport — create a blend zone
  var fadeStart = Math.max(0, (horizonNorm * 100) - blendPct);
  var fadeEnd = Math.min(100, (horizonNorm * 100) + blendPct);

  var grad = 'linear-gradient(to bottom,' +
    'black 0%,' +
    'black ' + fadeStart.toFixed(1) + '%,' +
    'transparent ' + fadeEnd.toFixed(1) + '%,' +
    'transparent 100%)';

  canvasEl.style.webkitMaskImage = grad;
  canvasEl.style.maskImage = grad;
}

// --- AR Zoom (pinch + mouse wheel) ---
function setupARZoom(canvas) {
  if (!canvas) return;
  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      pinchDist0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && pinchDist0 > 0) {
      var dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      var scale = pinchDist0 / dist;
      arFov = Math.max(10, Math.min(120, arFov * scale));
      pinchDist0 = dist;
      if (engineReady && stel && stel.core && stel.core.observer) {
        stel.core.observer.fov = (arFov * Math.PI) / 180;
      }
      updateLensIndicator();
      updateSkyGroundMask();
    }
  }, { passive: true });
  canvas.addEventListener('touchend', function() {
    pinchDist0 = 0;
  });
  // Mouse wheel zoom for desktop testing
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var zoomStep = 1 + Math.abs(e.deltaY) * 0.002;
    if (e.deltaY < 0) arFov = Math.max(10, arFov / zoomStep);
    else arFov = Math.min(120, arFov * zoomStep);
    if (engineReady && stel && stel.core && stel.core.observer) {
      stel.core.observer.fov = (arFov * Math.PI) / 180;
    }
    updateLensIndicator();
    updateSkyGroundMask();
  }, { passive: false });
}

function renderLoop() {
  if (!arActive) return;
  var h = ((smoothHeading % 360) + 360) % 360;
  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.yaw = (-(h - headingOffset) * Math.PI) / 180;
    stel.core.observer.pitch = (-smoothAltitude * Math.PI) / 180;
    if (typeof stel.date2MJD === 'function') {
      stel.core.observer.utc = stel.date2MJD(new Date()) + timeOffsetHours / 24;
    }
  }
  if (canvasEl) { canvasEl.style.opacity = skyOpacity; canvasEl.style.mixBlendMode = skyOpacity >= 0.98 ? 'normal' : 'screen'; }
  var ring = overlayEl && overlayEl.querySelector('.ar-compass-face');
  if (ring) ring.style.transform = 'rotate(' + (h - headingOffset) + 'deg)';
  var lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  var lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function')
    window._arBearingCallback(h, lat, lon);
  var dbg = document.getElementById('ar-debug');
  var engLat =
    engineReady && stel && stel.core && stel.core.observer ? (stel.core.observer.latitude * 180) / Math.PI : NaN;
  var engLon =
    engineReady && stel && stel.core && stel.core.observer ? (stel.core.observer.longitude * 180) / Math.PI : NaN;
  if (dbg)
    dbg.textContent =
      (sensorReady ? 'SENSOR' : 'EVENT') +
      ' | hdg:' +
      h.toFixed(1) +
      '\xB0 alt:' +
      smoothAltitude.toFixed(1) +
      '\xB0 | loc:' +
      (isNaN(engLat) ? '--' : engLat.toFixed(2) + ',' + engLon.toFixed(2)) +
      ' | ' +
      formatTimeOffset(timeOffsetHours) +
      (cameraBortle ? ' | B' + cameraBortle.bortle : '') +
      ' | ' + Math.round(fovToFocalLength(arFov)) + 'mm';
  // Update realtime clock every frame
  updateRealtimeLabel();
  // Update sky/ground horizon mask
  updateSkyGroundMask();
  // Update phone guide angle
  updatePhoneGuide();
  // Camera Bortle estimation (throttled to ~2fps)
  bortleFrameCounter++;
  if (bortleFrameCounter >= 30 && videoEl) {
    bortleFrameCounter = 0;
    cameraBortle = estimateBortleFromCamera(videoEl, smoothAltitude);
    updateBortleDisplay();
  }
  animFrame = requestAnimationFrame(renderLoop);
}

// --- Bortle auto-match engine ---
function updateBortleDisplay() {
  var badge = document.getElementById('ar-bortle-badge');
  if (!badge) return;
  if (cameraBortle && cameraBortle.bortle >= 1) {
    badge.textContent = '🌃 B' + cameraBortle.bortle + ' ' + cameraBortle.label;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function applyBortlePreset(preset) {
  if (!engineReady || !stel || !stel.core) return;
  var c = stel.core;

  // Star magnitude limit
  if (c.stars && typeof c.stars.magnitude_limit !== 'undefined') {
    c.stars.magnitude_limit = preset.starMagLimit;
  }

  // Milky Way
  if (c.milkyway) {
    c.milkyway.visible = preset.milkywayVisible;
    if (typeof c.milkyway.alpha !== 'undefined') c.milkyway.alpha = preset.milkywayAlpha;
  }

  // Constellations
  if (c.constellations) {
    c.constellations.lines_visible = preset.constellationsLines;
    c.constellations.labels_visible = preset.constellationsLabels;
  }

  // Star/planet/nebula labels
  if (c.stars) c.stars.hints_visible = preset.starLabels;
  if (c.planets) c.planets.hints_visible = preset.planetLabels;
  if (c.dsos) {
    c.dsos.hints_visible = preset.nebulaLabels;
    c.dsos.visible = preset.nebulaLabels || preset.constellationsLines;
  }

  // Atmosphere & landscape
  if (c.atmosphere) c.atmosphere.visible = preset.atmosphere;
  if (c.landscapes) c.landscapes.visible = preset.landscape;

  // Sky opacity
  skyOpacity = preset.skyOpacity;
  if (canvasEl) { canvasEl.style.opacity = skyOpacity; canvasEl.style.mixBlendMode = skyOpacity >= 0.98 ? 'normal' : 'screen'; }
  var opSlider = document.getElementById('ar-opacity');
  var opVal = document.getElementById('ar-opacity-val');
  if (opSlider) opSlider.value = Math.round(skyOpacity * 100);
  if (opVal) opVal.textContent = Math.round(skyOpacity * 100) + '%';

  // Sync toggle buttons UI
  syncToggleUI('ar-btn-atmo', preset.atmosphere);
  syncToggleUI('ar-btn-ground', preset.landscape);
  syncToggleUI('ar-btn-grid', preset.constellationsLines);
}

function syncToggleUI(btnId, state) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  if (state) btn.classList.add('active');
  else btn.classList.remove('active');
}

function autoMatchSky() {
  var bortle = cameraBortle ? cameraBortle.bortle : 5;
  var preset = getBortlePreset(bortle);
  applyBortlePreset(preset);
  // Flash the badge
  var badge = document.getElementById('ar-bortle-badge');
  if (badge) {
    badge.style.background = 'rgba(0,255,136,0.4)';
    badge.textContent = '✅ B' + bortle + ' ' + preset.label;
    setTimeout(function () {
      badge.style.background = 'rgba(0,255,136,0.15)';
    }, 800);
  }
  console.log('[AR] Auto-matched to Bortle', bortle, preset.label);
}

// --- Phone holding guide ---
var guideAutoDismissTimer = null;

function showPhoneGuide() {
  var guide = document.getElementById('ar-guide');
  if (!guide) return;
  guide.classList.add('show');
  guideOverlayVisible = true;
  // Auto-dismiss after 8 seconds if user doesn't interact
  if (guideAutoDismissTimer) clearTimeout(guideAutoDismissTimer);
  guideAutoDismissTimer = setTimeout(function () {
    dismissPhoneGuide(false);
  }, 1500);
}

function dismissPhoneGuide(savePreference) {
  var guide = document.getElementById('ar-guide');
  if (!guide) return;
  guide.classList.remove('show');
  guideOverlayVisible = false;
  if (guideAutoDismissTimer) {
    clearTimeout(guideAutoDismissTimer);
    guideAutoDismissTimer = null;
  }
  // Only save "don't show again" if user explicitly tapped "Got it"
  if (savePreference !== false) {
    guideDismissed = true;
    try {
      localStorage.setItem('arguide_dismissed', '1');
    } catch (e) {}
  }
}

function updatePhoneGuide() {
  if (!guideOverlayVisible) return;
  var fill = document.getElementById('ar-guide-fill');
  var text = document.getElementById('ar-guide-angle-text');
  if (!fill || !text) return;
  var alt = Math.max(0, Math.min(90, smoothAltitude));
  var pct = (alt / 90) * 100;
  fill.style.width = pct + '%';
  if (alt < 10) {
    text.textContent = 'Too low 🔽';
    fill.style.background = '#f44';
  } else if (alt > 80) {
    text.textContent = 'Too high 🔼';
    fill.style.background = '#f44';
  } else if (alt >= 30 && alt <= 60) {
    text.textContent = Math.round(alt) + '° Perfect ✨';
    fill.style.background = '#0f0';
  } else {
    text.textContent = Math.round(alt) + '°';
    fill.style.background = '#fc0';
  }
}

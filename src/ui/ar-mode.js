/**
 * ARMode — Canvas-based AR using Stellarium Web Engine directly.
 * Lean orchestrator delegating domain tasks to modular sub-controllers.
 */

import { estimateBortleFromCamera, resetCameraBortle } from '../core/sky-sense.js';
import { loadScript, initEngine, setObserver } from '../core/stellarium-engine.js';
import { emit } from '../core/events.js';
import { orientationAdapter } from '../core/sensors/DeviceOrientationAdapter.js';
import { cameraManager } from '../core/camera/CameraManager.js';
import { arBortleBadge } from './ar/ARBortleBadge.js';
import { arLensController } from './ar/ARLensController.js';
import { arTimeTransport } from './ar/ARTimeTransport.js';
import { arSkyMaskController } from './ar/ARSkyMaskController.js';
import { arCameraSettings } from './ar/ARCameraSettings.js';

let arActive = false;
let videoEl = null;
let overlayEl = null;
let stel = null;
let canvasEl = null;
let smoothHeading = 0;
let smoothAltitude = 45;
let animFrame = null;
let engineReady = false;
let cameraBortle = null;
let bortleFrameCounter = 0;

export function isARActive() {
  return arActive;
}

export function preloadStellarium(_lat, _lon) {
  // Store preload lat/lon if needed before open
}

export async function startARMode(latitude, longitude, onStop, _motionAlreadyGranted) {
  if (arActive) return;

  const overlay = document.getElementById('ar-overlay');
  const video = document.getElementById('ar-video');
  canvasEl = document.getElementById('ar-sky');
  if (!overlay || !video || !canvasEl) return;

  videoEl = video;
  overlayEl = overlay;

  try {
    await cameraManager.startCamera(video);

    overlay.classList.remove('hidden');
    arActive = true;
    overlayEl.dataset.lat = latitude;
    overlayEl.dataset.lon = longitude;

    // Load Stellarium script & init engine

    await loadScript();

    if (typeof StelWebEngine === 'undefined') {
      stopARMode();
      if (onStop) onStop('Engine load failed');
      return;
    }

    if (!window._stelEngineInit) {
      window._stelEngineInit = true;
      canvasEl.getContext('webgl', {
        preserveDrawingBuffer: true,
        alpha: false,
        premultipliedAlpha: true,
        antialias: true,
        stencil: true,
      });

      initEngine(
        canvasEl,
        engine => {
          stel = engine;
          engineReady = true;

          stel.core.observer.fov = (arLensController.arFov * Math.PI) / 180;
          arLensController.setupARZoom(canvasEl, fov => {
            if (stel && stel.core && stel.core.observer) {
              stel.core.observer.fov = (fov * Math.PI) / 180;
            }
            arLensController.updateLensIndicator(videoEl, cameraManager.getLensInfo());
            arSkyMaskController.updateSkyGroundMask(smoothAltitude, fov);
          });

          arLensController.updateLensIndicator(videoEl, cameraManager.getLensInfo());
          setObserver(stel, { lat: latitude, lon: longitude, pitch: 45, yaw: 0 });

          // Init UI Controllers
          arSkyMaskController.init(canvasEl, stel);
          arCameraSettings.init(videoEl);
          arTimeTransport.init(stel, hoursOffset => {
            if (stel && stel.core && stel.core.observer && typeof stel.date2MJD === 'function') {
              stel.core.observer.utc = stel.date2MJD(new Date()) + hoursOffset / 24;
            }
          });
        },
        err => {
          console.error('[AR] Engine timeout:', err);
          stopARMode();
          if (onStop) onStop('Engine timeout');
        },
      );
    }

    await orientationAdapter.start();

    // Init AR Components
    arBortleBadge.init(preset => applyBortlePreset(preset));

    // Close & Capture button bindings
    setupActionButtons();

    renderLoop();
  } catch (err) {
    console.error('[AR] Failed:', err);
    stopARMode();
    if (onStop) onStop(err.message);
  }
}

function setupActionButtons() {
  const closeBtn = document.getElementById('ar-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => stopARMode();
  }

  const captureBtn = document.getElementById('ar-capture-btn');
  if (captureBtn) {
    captureBtn.onclick = () => arLensController.captureARPhoto(videoEl, canvasEl);
  }

  const calibrateBtn = document.getElementById('ar-calibrate-btn');
  if (calibrateBtn) {
    calibrateBtn.onclick = () => orientationAdapter.resetHeadingOffset();
  }

  const bortleBtn = document.getElementById('ar-bortle-btn');
  if (bortleBtn) {
    bortleBtn.onclick = () => {
      const overlay = document.getElementById('ar-bortle-overlay');
      if (overlay) overlay.classList.remove('hidden');
    };
  }

  const bortleClose = document.getElementById('ar-bortle-close');
  if (bortleClose) {
    bortleClose.onclick = () => {
      const overlay = document.getElementById('ar-bortle-overlay');
      if (overlay) overlay.classList.add('hidden');
    };
  }
}

export function stopARMode() {
  arActive = false;
  cameraManager.stopCamera(videoEl);
  orientationAdapter.stop();
  arTimeTransport.stopAnim();

  if (overlayEl) overlayEl.classList.add('hidden');
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }

  resetCameraBortle();
  window._stelEngineInit = false;
}

function applyBortlePreset(preset) {
  if (!engineReady || !stel || !stel.core) return;
  const c = stel.core;
  if (c.stars && typeof c.stars.magnitude_limit !== 'undefined') {
    c.stars.magnitude_limit = preset.starMagLimit;
  }
}

function renderLoop() {
  if (!arActive) return;

  smoothHeading = orientationAdapter.getHeading();
  smoothAltitude = orientationAdapter.getAltitude();
  const h = ((smoothHeading % 360) + 360) % 360;

  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.yaw = (-h * Math.PI) / 180;
    stel.core.observer.pitch = (-smoothAltitude * Math.PI) / 180;
  }

  // Compass ring update
  const ring = overlayEl && overlayEl.querySelector('.ar-compass-face');
  if (ring) ring.style.transform = `rotate(${h}deg)`;

  const lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  const lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon)) {
    emit('bearing:update', { heading: h, lat, lon });
  }

  // Camera Bortle estimation (~2fps)
  bortleFrameCounter++;
  if (bortleFrameCounter >= 30 && videoEl) {
    bortleFrameCounter = 0;
    cameraBortle = estimateBortleFromCamera(videoEl, smoothAltitude);
    if (cameraBortle && cameraBortle.bortle >= 1) {
      arBortleBadge.updateBortle(cameraBortle);
    }
  }

  animFrame = requestAnimationFrame(renderLoop);
}

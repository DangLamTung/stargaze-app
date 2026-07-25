/**
 * ARSkyMaskController.js
 * Manages sky opacity blend modes, sky glow brightness, horizon masking gradients,
 * and Stellarium toggle buttons (atmosphere, ground, grid lines, horizon mask).
 */

export class ARSkyMaskController {
  constructor() {
    this.skyOpacity = 0.65;
    this.skyBrightness = 150;
    this.isMaskEnabled = false;
  }

  init(canvasEl, stelEngine) {
    this.canvasEl = canvasEl;
    this.stelEngine = stelEngine;
    this.setupOpacitySliders();
    this.setupToggleButtons();
  }

  setupOpacitySliders() {
    const opSlider = document.getElementById('ar-opacity');
    const opVal = document.getElementById('ar-opacity-val');

    if (opSlider && opVal) {
      opSlider.value = Math.round(this.skyOpacity * 100);
      opVal.textContent = `${Math.round(this.skyOpacity * 100)}%`;
      this.updateCanvasBlend();

      opSlider.addEventListener('input', e => {
        this.skyOpacity = parseInt(e.target.value, 10) / 100;
        opVal.textContent = `${e.target.value}%`;
        this.updateCanvasBlend();
      });
    }

    const brSlider = document.getElementById('ar-brightness');
    const brVal = document.getElementById('ar-brightness-val');
    if (brSlider && brVal) {
      brSlider.value = this.skyBrightness;
      brVal.textContent = `${(this.skyBrightness / 100).toFixed(1)}×`;

      brSlider.addEventListener('input', e => {
        this.skyBrightness = parseInt(e.target.value, 10);
        brVal.textContent = `${(this.skyBrightness / 100).toFixed(1)}×`;
        if (this.canvasEl) {
          this.canvasEl.style.filter = `brightness(${this.skyBrightness / 100})`;
        }
      });
    }
  }

  updateCanvasBlend() {
    if (!this.canvasEl) return;
    const videoEl = document.getElementById('ar-video');
    const op = this.skyOpacity; // 0.05 to 1.00

    if (op >= 0.99) {
      // 100%: Turn off camera video and show pure Stellarium planetarium view
      if (videoEl) videoEl.style.opacity = '0';
      this.canvasEl.style.opacity = '1.0';
      this.canvasEl.style.mixBlendMode = 'normal';
    } else {
      // < 100%: Scale Stellarium opacity directly over active camera video feed
      if (videoEl) videoEl.style.opacity = '1.0';
      this.canvasEl.style.opacity = op.toFixed(2);
      this.canvasEl.style.mixBlendMode = 'screen';
    }
  }

  setupToggleButtons() {
    const bindToggle = (id, prop, opts = {}) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const isActive = btn.classList.contains('active');

        if (id === 'ar-btn-mask') {
          this.isMaskEnabled = isActive;
          this.updateSkyGroundMask(45, 60);
          return;
        }

        if (!this.stelEngine || !this.stelEngine.core) return;
        const c = this.stelEngine.core;

        if (opts.dual && c.lines) {
          if (c.lines.equatorial) c.lines.equatorial.visible = isActive;
          if (c.lines.azimuthal) c.lines.azimuthal.visible = isActive;
        } else if (c[prop] && 'visible' in c[prop]) {
          c[prop].visible = isActive;
        }
      });
    };

    bindToggle('ar-btn-atmo', 'atmosphere');
    bindToggle('ar-btn-ground', 'landscape');
    bindToggle('ar-btn-grid', null, { dual: true });
    bindToggle('ar-btn-mask', null);
  }

  updateSkyGroundMask(pitchDeg, arFov = 60) {
    if (!this.canvasEl) return;
    if (!this.isMaskEnabled) {
      this.canvasEl.style.webkitMaskImage = '';
      this.canvasEl.style.maskImage = '';
      return;
    }

    const halfFov = arFov / 2;
    const horizonNorm = (halfFov - pitchDeg) / arFov;

    if (horizonNorm <= 0.15) {
      this.canvasEl.style.webkitMaskImage = 'linear-gradient(to bottom, transparent 0%, transparent 100%)';
      this.canvasEl.style.maskImage = 'linear-gradient(to bottom, transparent 0%, transparent 100%)';
      return;
    }

    if (horizonNorm >= 0.85) {
      this.canvasEl.style.webkitMaskImage = 'linear-gradient(to bottom, black 0%, black 100%)';
      this.canvasEl.style.maskImage = 'linear-gradient(to bottom, black 0%, black 100%)';
      return;
    }

    const fadeStart = Math.max(0, horizonNorm * 100 - 15);
    const fadeEnd = Math.min(100, horizonNorm * 100 + 15);
    const grad = `linear-gradient(to bottom, black 0%, black ${fadeStart.toFixed(1)}%, transparent ${fadeEnd.toFixed(1)}%, transparent 100%)`;

    this.canvasEl.style.webkitMaskImage = grad;
    this.canvasEl.style.maskImage = grad;
  }
}

export const arSkyMaskController = new ARSkyMaskController();

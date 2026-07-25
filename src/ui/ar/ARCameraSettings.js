/**
 * ARCameraSettings.js
 * Controls advanced camera parameters: ISO, exposure compensation, white balance,
 * optical/digital zoom sliders, camera flip, and camera modal settings panel.
 */

export class ARCameraSettings {
  constructor() {
    this.videoEl = null;
    this.panelEl = null;
    this.isSetupDone = false;
  }

  init(videoEl) {
    this.videoEl = videoEl;
    this.panelEl = document.getElementById('ar-cam-panel');
    this.setupPanel();
  }

  setupPanel() {
    if (this.isSetupDone) return;
    this.isSetupDone = true;

    const openBtn = document.getElementById('ar-cam-settings-btn');
    const closeBtn = document.getElementById('ar-cam-close');

    if (openBtn && this.panelEl) {
      openBtn.addEventListener('click', () => {
        this.panelEl.classList.remove('hidden');
      });
    }

    if (closeBtn && this.panelEl) {
      closeBtn.addEventListener('click', () => {
        this.panelEl.classList.add('hidden');
      });
    }

    const bindConstraint = (sliderId, valId, key, formatter) => {
      const slider = document.getElementById(sliderId);
      if (!slider) return;

      slider.addEventListener('input', async e => {
        const track = this.videoEl?.srcObject?.getVideoTracks()[0];
        if (!track) return;

        const rawVal = parseFloat(e.target.value);
        try {
          await track.applyConstraints({ advanced: [{ [key]: rawVal }] });
          const valEl = document.getElementById(valId);
          if (valEl) valEl.textContent = formatter ? formatter(rawVal) : rawVal;
        } catch (err) {
          console.warn(`[ARCameraSettings] Failed to set ${key}:`, err);
        }
      });
    };

    bindConstraint('ar-exp', 'ar-exp-val', 'exposureCompensation');
    bindConstraint('ar-iso', 'ar-iso-val', 'iso', v => (v === 0 ? 'Auto' : v));
    bindConstraint('ar-wb', 'ar-wb-val', 'colorTemperature', v => (v === 0 ? 'Auto' : `${v}K`));
    bindConstraint('ar-zoom', 'ar-zoom-val', 'zoom', v => `${v.toFixed(1)}×`);
  }
}

export const arCameraSettings = new ARCameraSettings();

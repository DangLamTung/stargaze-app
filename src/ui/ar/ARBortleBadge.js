/**
 * ARBortleBadge.js
 * Manages the live Bortle estimate badge and "Auto-Match" sky presets action.
 */

import { getBortlePreset } from '../../core/bortle-presets.js';
import { showToast } from '../toast.js';

export class ARBortleBadge {
  constructor() {
    this.badgeEl = null;
    this.autoBtnEl = null;
    this.currentBortle = null;
    this.onApplyPresetCallback = null;
  }

  init(onApplyPreset) {
    this.onApplyPresetCallback = onApplyPreset;
    this.badgeEl = document.getElementById('ar-bortle-display');
    this.autoBtnEl = document.getElementById('ar-auto-match-btn');

    if (this.autoBtnEl) {
      this.autoBtnEl.addEventListener('click', () => this.handleAutoMatch());
    }
  }

  updateBortle(estimate) {
    if (!estimate) return;
    this.currentBortle = estimate.bortle;

    if (this.badgeEl) {
      this.badgeEl.textContent = `Bortle: ${estimate.bortle} (${estimate.label})`;
    }
  }

  handleAutoMatch() {
    if (!this.currentBortle) {
      showToast('Analyzing sky brightness...');
      return;
    }

    const preset = getBortlePreset(this.currentBortle);
    if (preset && typeof this.onApplyPresetCallback === 'function') {
      this.onApplyPresetCallback(preset);
      showToast(`🎯 Auto-matched sky to Bortle ${preset.bortle} (${preset.label})`);
    }
  }
}

export const arBortleBadge = new ARBortleBadge();

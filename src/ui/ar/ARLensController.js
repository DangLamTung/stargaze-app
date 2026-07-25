/**
 * ARLensController.js
 * Handles AR photo capture, WebGL pixel composition, 35mm focal length calculations,
 * lens HUD indicators, and digital zoom gesture interactions.
 */

const SENSOR_W = 36; // Full-frame 35mm sensor horizontal width in mm

export class ARLensController {
  constructor() {
    this.baseArFov = 60;
    this.arFov = 60;
    this.pinchDist0 = 0;
  }

  fovToFocalLength(fovDeg) {
    return SENSOR_W / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  focalLengthToFov(fl) {
    return (2 * Math.atan(SENSOR_W / (2 * fl)) * 180) / Math.PI;
  }

  getLensClass(fl) {
    if (fl <= 18) return 'wide';
    if (fl <= 35) return 'normal';
    if (fl <= 85) return 'tele';
    return 'super';
  }

  getLensLabel(fl) {
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

  applyDigitalZoom(videoEl) {
    if (!videoEl) return;
    const baseHalf = ((this.baseArFov / 2) * Math.PI) / 180;
    const currHalf = ((this.arFov / 2) * Math.PI) / 180;
    const scale = Math.tan(baseHalf) / Math.tan(currHalf);
    videoEl.style.transform = `scale(${scale})`;
    videoEl.style.transformOrigin = 'center center';
    videoEl.style.willChange = 'transform';
  }

  updateLensIndicator(videoEl, cameraLensInfo = {}) {
    const ring = document.getElementById('ar-lens-ring');
    const mm = document.getElementById('ar-lens-mm');
    const label = document.getElementById('ar-lens-label');
    const fovEl = document.getElementById('ar-lens-fov');
    if (!ring || !mm || !label || !fovEl) return;

    this.applyDigitalZoom(videoEl);

    const fl = Math.round(this.fovToFocalLength(this.arFov));
    const fovRounded = Math.round(this.arFov);

    mm.textContent = `${fl}mm`;
    label.textContent = this.getLensLabel(fl);
    fovEl.textContent = `f/${fovRounded}°`;

    if (cameraLensInfo.matched && cameraLensInfo.physicalMm) {
      if (cameraLensInfo.equiv35mm) {
        mm.textContent = `${cameraLensInfo.equiv35mm}mm`;
        label.textContent = '📷 EQUIV';
        fovEl.textContent = `${cameraLensInfo.physicalMm.toFixed(1)}mm phys`;
      } else {
        mm.textContent = `${cameraLensInfo.physicalMm.toFixed(1)}mm`;
        label.textContent = '📷 PHYS';
        fovEl.textContent = `f/${fovRounded}°`;
      }
    }

    ring.className = `ar-lens-ring ${this.getLensClass(fl)}`;
  }

  captureARPhoto(videoEl, canvasEl) {
    if (!videoEl || !canvasEl) return;
    const cw = canvasEl.width || window.innerWidth;
    const ch = canvasEl.height || window.innerHeight;

    const gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = cw;
    skyCanvas.height = ch;
    const skyCtx = skyCanvas.getContext('2d');

    if (gl) {
      const pixels = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const imgData = skyCtx.createImageData(cw, ch);
      for (let y = 0; y < ch; y++) {
        const srcRow = (ch - 1 - y) * cw * 4;
        const dstRow = y * cw * 4;
        for (let x = 0; x < cw * 4; x++) {
          imgData.data[dstRow + x] = pixels[srcRow + x];
        }
      }
      skyCtx.putImageData(imgData, 0, 0);
    }

    const oc = document.createElement('canvas');
    oc.width = cw;
    oc.height = ch;
    const ctx = oc.getContext('2d');
    const vw = videoEl.videoWidth || 1280;
    const vh = videoEl.videoHeight || 720;
    const scale = Math.max(cw / vw, ch / vh);

    ctx.drawImage(videoEl, (cw - vw * scale) / 2, (ch - vh * scale) / 2, vw * scale, vh * scale);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(skyCanvas, 0, 0, cw, ch);
    ctx.globalAlpha = 1;

    oc.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stargaze-ar-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
      this.showCaptureToast();
    }, 'image/png');
  }

  showCaptureToast() {
    let toast = document.getElementById('ar-capture-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ar-capture-toast';
      toast.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:rgba(0,0,0,0.8);color:#0f0;padding:12px 24px;border-radius:8px;' +
        'font-family:monospace;z-index:6000;pointer-events:none;transition:opacity 0.5s;';
      document.body.appendChild(toast);
    }
    toast.textContent = '📸 Captured!';
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
    }, 1500);
  }

  setupARZoom(canvas, onFovChange) {
    if (!canvas) return;

    canvas.addEventListener(
      'touchstart',
      e => {
        if (e.touches.length === 2) {
          this.pinchDist0 = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          );
        }
      },
      { passive: true },
    );

    canvas.addEventListener(
      'touchmove',
      e => {
        if (e.touches.length === 2 && this.pinchDist0 > 0) {
          const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          );
          const scale = this.pinchDist0 / dist;
          this.arFov = Math.max(10, Math.min(120, this.arFov * scale));
          this.pinchDist0 = dist;
          if (typeof onFovChange === 'function') onFovChange(this.arFov);
        }
      },
      { passive: true },
    );

    canvas.addEventListener('touchend', () => {
      this.pinchDist0 = 0;
    });

    canvas.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        const zoomStep = 1 + Math.abs(e.deltaY) * 0.002;
        if (e.deltaY < 0) this.arFov = Math.max(10, this.arFov / zoomStep);
        else this.arFov = Math.min(120, this.arFov * zoomStep);
        if (typeof onFovChange === 'function') onFovChange(this.arFov);
      },
      { passive: false },
    );
  }
}

export const arLensController = new ARLensController();

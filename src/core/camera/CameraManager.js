/**
 * CameraManager.js
 * Handles camera media stream lifecycle, lens focal length detection from hardware,
 * digital zoom scaling, and canvas capture.
 */

export class CameraManager {
  constructor() {
    this.stream = null;
    this.videoTrack = null;
    this.cameraLensMm = null;
    this.cameraLens35mmEq = null;
    this.cameraLensMatched = false;
    this.baseArFov = 60;
    this.currentFov = 60;
  }

  /**
   * Request back camera video stream
   */
  async startCamera(videoElement) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported on this browser');
    }

    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    try {
      // 8-second timeout so AR doesn't hang forever on permission dialog
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Camera access timeout (8s)')), 8000),
      );
      this.stream = await Promise.race([navigator.mediaDevices.getUserMedia(constraints), timeout]);
      if (videoElement) {
        videoElement.srcObject = this.stream;
        await videoElement.play();
      }

      this.videoTrack = this.stream.getVideoTracks()[0];
      if (this.videoTrack) {
        this.readCameraLens(this.videoTrack);
      }
      return this.stream;
    } catch (err) {
      console.warn('[CameraManager] Camera access failed:', err.message);
      if (new URLSearchParams(window.location.search).get('mockAR') === 'true') {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '18px sans-serif';
        ctx.fillText('Simulated AR Camera Feed', 200, 240);
        this.stream = canvas.captureStream(30);
        if (videoElement) {
          videoElement.srcObject = this.stream;
          videoElement.play().catch(() => {});
        }
        return this.stream;
      }
      throw err;
    }
  }

  /**
   * Stop camera tracks and release camera stream
   */
  stopCamera(videoElement) {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.videoTrack = null;
    if (videoElement) {
      videoElement.srcObject = null;
    }
  }

  /**
   * Inspect video track for focal length settings (hardware camera lens read)
   */
  readCameraLens(videoTrack) {
    if (!videoTrack) return;
    try {
      const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};

      if (settings && settings.focalLength) {
        const physFocalMm = settings.focalLength;
        const sensorWidthMm = this.estimateSensorWidthMm(settings);
        this.cameraLensMm = physFocalMm;

        if (sensorWidthMm) {
          const realFov = (2 * Math.atan(sensorWidthMm / (2 * physFocalMm)) * 180) / Math.PI;
          this.currentFov = Math.round(realFov);
          this.baseArFov = this.currentFov;
          this.cameraLens35mmEq = Math.round((36 / sensorWidthMm) * physFocalMm);
        }
        this.cameraLensMatched = true;
      } else {
        this.cameraLensMatched = false;
        this.cameraLensMm = null;
        this.cameraLens35mmEq = null;
      }
    } catch (e) {
      console.warn('[CameraManager] Failed to read camera lens capabilities:', e);
      this.cameraLensMatched = false;
    }
  }

  /**
   * Heuristic estimate of camera sensor physical width from reported resolution
   */
  estimateSensorWidthMm(settings) {
    if (settings.sensorWidth) return settings.sensorWidth;
    if (settings.sensorSize) return settings.sensorSize.width || settings.sensorSize;

    const pxW = settings.width;
    if (!pxW) return null;

    let pitchUm = 1.2;
    if (pxW >= 3840) pitchUm = 1.0;
    else if (pxW >= 1920) pitchUm = 1.2;
    else if (pxW >= 1280) pitchUm = 1.4;

    return (pxW * pitchUm) / 1000; // in mm
  }

  /**
   * Compute digital zoom transform scale for video element matching sky FOV
   */
  getDigitalZoomScale(skyFov) {
    const baseHalf = (this.baseArFov / 2) * (Math.PI / 180);
    const currHalf = (skyFov / 2) * (Math.PI / 180);
    return Math.tan(baseHalf) / Math.tan(currHalf);
  }

  getLensInfo() {
    return {
      matched: this.cameraLensMatched,
      physicalMm: this.cameraLensMm,
      equiv35mm: this.cameraLens35mmEq,
      baseFov: this.baseArFov,
      currentFov: this.currentFov,
    };
  }
}

export const cameraManager = new CameraManager();

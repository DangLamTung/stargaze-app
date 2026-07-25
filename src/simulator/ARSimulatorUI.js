import { orientationAdapter } from '../core/sensors/DeviceOrientationAdapter.js';

export const arSimulator = {
  init() {
    console.log('🌌 AR Simulator UI initialized');
    orientationAdapter.setMockMode(true);
    orientationAdapter.setMockValues(180, 45, 0);

    // Mock video element stream if camera is unavailable in headless test environment
    const video = document.getElementById('ar-video');
    if (video && !video.srcObject) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '20px sans-serif';
        ctx.fillText('Simulated AR Camera Feed', 200, 240);
        video.srcObject = canvas.captureStream(30);
      } catch (e) {
        console.warn('Mock video stream creation notice:', e);
      }
    }
  },
};

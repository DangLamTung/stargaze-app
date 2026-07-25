/**
 * StarGaze AR — Standalone entry point.
 * Imports the AR module, handles geolocation, starts AR mode.
 */
import { startARMode, stopARMode, isARActive } from '../ar-mode.js';

document.getElementById('start-btn').addEventListener('click', async () => {
  if (isARActive()) {
    stopARMode();
    document.getElementById('start-screen').style.display = 'flex';
    return;
  }

  // Get location
  let lat, lon;
  try {
    const pos = await new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, enableHighAccuracy: true });
    });
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch (e) {
    alert('Could not get location. Please enable GPS.');
    return;
  }

  document.getElementById('start-screen').style.display = 'none';

  // Request motion permission on iOS
  let motionGranted = false;
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      motionGranted = perm === 'granted';
    } catch (e) {
      motionGranted = false;
    }
  }

  startARMode(lat, lon, (err) => {
    if (err) alert('AR error: ' + err);
    document.getElementById('start-screen').style.display = 'flex';
  }, motionGranted);
});

// Close button
document.getElementById('ar-close-btn').addEventListener('click', () => {
  stopARMode();
  document.getElementById('start-screen').style.display = 'flex';
});

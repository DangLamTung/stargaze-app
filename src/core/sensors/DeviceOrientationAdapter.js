/**
 * DeviceOrientationAdapter.js
 * Standardized orientation adapter handling:
 * - W3C DeviceOrientation API (alpha, beta, gamma)
 * - iOS Safari specific webkitCompassHeading (true north)
 * - AbsoluteOrientationSensor API (Sensor API spec)
 * - Mock/Simulated orientation events for testing on non-mobile devices
 */

import { emit } from '../events.js';

let adapterInstance = null;

export class DeviceOrientationAdapter {
  constructor() {
    this.smoothHeading = 0;
    this.smoothAltitude = 45;
    this.smoothRoll = 0;
    this.headingOffset = 0;
    this.lpFactor = 0.1;
    this.isSensorReady = false;
    this.sensorType = 'none';
    this.listeners = new Set();
    this.absSensor = null;

    // Simulation / Mock state
    this.isMocking = false;
    this.mockHeading = 0;
    this.mockAltitude = 45;
    this.mockRoll = 0;

    this.boundHandleDeviceOrientation = this.handleDeviceOrientation.bind(this);
  }

  static getInstance() {
    if (!adapterInstance) {
      adapterInstance = new DeviceOrientationAdapter();
    }
    return adapterInstance;
  }

  // --- Helper Math ---
  static angleDelta(a, b) {
    let d = (((a % 360) + 360) % 360) - (((b % 360) + 360) % 360);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  static quatToHdg(q) {
    const x = q[0],
      y = q[1],
      z = q[2],
      w = q[3];
    return ((Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z)) * 180) / Math.PI + 360) % 360;
  }

  static quatToAlt(q) {
    const x = q[0],
      y = q[1];
    return (Math.asin(Math.max(-1, Math.min(1, 1 - 2 * (x * x + y * y)))) * 180) / Math.PI;
  }

  /**
   * Request iOS orientation permissions if required by Safari
   */
  async requestPermission() {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        return response === 'granted';
      } catch (err) {
        console.warn('[DeviceOrientationAdapter] iOS permission request failed:', err);
        return false;
      }
    }
    return true; // No permission required (Android / Desktop / Chrome)
  }

  /**
   * Start listening to orientation sensors (or simulation)
   */
  async start() {
    if (this.isMocking) {
      this.isSensorReady = true;
      this.sensorType = 'mock';
      return 'mock';
    }

    // 1. Try W3C AbsoluteOrientationSensor
    if (typeof window.AbsoluteOrientationSensor !== 'undefined') {
      try {
        this.absSensor = new window.AbsoluteOrientationSensor({ frequency: 60 });
        this.absSensor.addEventListener('reading', () => {
          if (this.isMocking) return;
          const q = this.absSensor.quaternion;
          if (q) {
            this.isSensorReady = true;
            this.sensorType = 'absolute-sensor';
            const rawHdg = DeviceOrientationAdapter.quatToHdg(q);
            const rawAlt = DeviceOrientationAdapter.quatToAlt(q);

            this.smoothHeading += this.lpFactor * DeviceOrientationAdapter.angleDelta(rawHdg, this.smoothHeading);
            this.smoothAltitude += this.lpFactor * (rawAlt - this.smoothAltitude);
            this.notifyListeners();
          }
        });
        this.absSensor.addEventListener('error', () => {
          this.absSensor = null;
          this.fallbackToDeviceEvents();
        });
        this.absSensor.start();
        this.isSensorReady = true;
        this.sensorType = 'absolute-sensor';
        return 'absolute-sensor';
      } catch (e) {
        this.absSensor = null;
      }
    }

    // 2. Fall back to window deviceorientation / deviceorientationabsolute
    return this.fallbackToDeviceEvents();
  }

  fallbackToDeviceEvents() {
    window.addEventListener('deviceorientationabsolute', this.boundHandleDeviceOrientation, true);
    window.addEventListener('deviceorientation', this.boundHandleDeviceOrientation, true);
    this.sensorType = 'device-events';
    return 'device-events';
  }

  /**
   * Primary event handler processing W3C and iOS webkitCompassHeading events
   */
  handleDeviceOrientation(event) {
    if (this.isMocking) return;

    let rawHeading = null;
    let isLandscape = false;

    try {
      if (screen.orientation?.type) {
        isLandscape = String(screen.orientation.type).startsWith('landscape');
      }
    } catch (e) {
      // Ignored: screen orientation fallback
    }

    // Check iOS specific webkitCompassHeading first (True North)
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      rawHeading = event.webkitCompassHeading;
      this.sensorType = 'ios-webkit-compass';
    } else if (event.alpha !== null && event.alpha !== undefined) {
      rawHeading = event.alpha;
      let screenAngle = 0;
      try {
        screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
      } catch (e) {
        // Ignored: fallback angle
      }
      rawHeading = (rawHeading - screenAngle + 360) % 360;
    }

    if (rawHeading !== null && !isNaN(rawHeading)) {
      this.isSensorReady = true;
      this.smoothHeading += this.lpFactor * DeviceOrientationAdapter.angleDelta(rawHeading, this.smoothHeading);
    }

    // Pitch angle computation
    const pitchAngle = isLandscape ? 90 - Math.abs(event.gamma || 0) : 90 - (event.beta || 0);
    const clampedAlt = Math.max(-90, Math.min(90, pitchAngle));
    this.smoothAltitude += this.lpFactor * (clampedAlt - this.smoothAltitude);

    if (event.gamma !== null && event.gamma !== undefined) {
      this.smoothRoll += this.lpFactor * ((event.gamma || 0) - this.smoothRoll);
    }

    this.notifyListeners();
  }

  /**
   * Enable/disable simulator mode
   */
  setMockMode(enabled) {
    this.isMocking = enabled;
    if (enabled) {
      this.isSensorReady = true;
      this.sensorType = 'mock';
      this.smoothHeading = this.mockHeading;
      this.smoothAltitude = this.mockAltitude;
      this.smoothRoll = this.mockRoll;
      this.notifyListeners();
    }
  }

  /**
   * Set simulated orientation values
   */
  setMockValues(heading, altitude, roll = 0) {
    this.mockHeading = ((heading % 360) + 360) % 360;
    this.mockAltitude = Math.max(-90, Math.min(90, altitude));
    this.mockRoll = roll;

    if (this.isMocking) {
      this.smoothHeading = this.mockHeading;
      this.smoothAltitude = this.mockAltitude;
      this.smoothRoll = this.mockRoll;
      this.notifyListeners();
    }
  }

  stop() {
    if (this.absSensor) {
      this.absSensor.stop();
      this.absSensor = null;
    }
    window.removeEventListener('deviceorientationabsolute', this.boundHandleDeviceOrientation, true);
    window.removeEventListener('deviceorientation', this.boundHandleDeviceOrientation, true);
    this.isSensorReady = false;
    this.sensorType = 'none';
  }

  getHeading() {
    return (this.smoothHeading - this.headingOffset + 360) % 360;
  }

  getAltitude() {
    return this.smoothAltitude;
  }

  getRoll() {
    return this.smoothRoll;
  }

  resetHeadingOffset() {
    this.headingOffset = this.smoothHeading;
  }

  addListener(callback) {
    this.listeners.add(callback);
  }

  removeListener(callback) {
    this.listeners.delete(callback);
  }

  notifyListeners() {
    const data = {
      heading: this.getHeading(),
      altitude: this.getAltitude(),
      roll: this.getRoll(),
      sensorType: this.sensorType,
      isMock: this.isMocking,
    };
    this.listeners.forEach(fn => fn(data));
    emit('sensor:orientation', data);
  }
}

export const orientationAdapter = DeviceOrientationAdapter.getInstance();

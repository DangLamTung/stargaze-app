/**
 * ARMode - Canvas-based AR using Stellarium Web Engine directly.
 * Heading -> engine observer.yaw, no iframes, no reloads, instant updates.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let stel = null;
let canvasEl = null;
let smoothHeading = 0;
let smoothAltitude = 45;
const LP = 0.10;
let animFrame = null;
let sensor = null;
let sensorReady = false;
let engineReady = false;
let initLat = 0, initLon = 0;
let skyOpacity = 0.92;
let timeOffsetMinutes = 0;

export function isARActive() { return arActive; }

export function preloadStellarium(lat, lon) {
  // Just store location - engine will be initialized on the AR canvas when opened
  initLat = lat; initLon = lon;
}

function quatToHdg(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  // Raw +Y heading from quaternion (sensor frame)
  return ((Math.atan2(2*(x*y + w*z), 1 - 2*(y*y + z*z)) * 180/Math.PI) + 360) % 360;
}

function quatToAlt(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  // Pitch from quaternion: asin(2*(w*y - z*x))
  // +Z pitch: 0=horizon, 90=zenith (flat). -Z (camera) same pitch.
  var pitch = Math.asin(Math.max(-1, Math.min(1, 2*(w*y - z*x))));
  return Math.abs(pitch * 180 / Math.PI);
}

function angleDelta(a, b) {
  var d = ((a % 360) + 360) % 360 - ((b % 360) + 360) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

async function startSensor() {
  if (typeof AbsoluteOrientationSensor !== 'undefined') {
    try {
      sensor = new AbsoluteOrientationSensor({ frequency: 60 });
      sensor.addEventListener('reading', function() {
        var q = sensor.quaternion;
        if (q) { sensorReady = true; smoothHeading += LP * angleDelta(quatToHdg(q), smoothHeading); smoothAltitude += LP * (quatToAlt(q) - smoothAltitude); }
      });
      sensor.addEventListener('error', function() { sensorReady = false; sensor = null; });
      sensor.start();
      return;
    } catch (e) { sensor = null; }
  }
  window.addEventListener('deviceorientationabsolute', handleEvent, true);
  window.addEventListener('deviceorientation', handleEvent, true);
}

function handleEvent(event) {
  if (sensorReady) return;
  var isAbs = event.type === 'deviceorientationabsolute';
  var isLandscape = screen.orientation ? screen.orientation.type.startsWith('landscape') : (Math.abs(window.orientation || 0) === 90);
  var raw;
  if (event.webkitCompassHeading !== undefined) raw = event.webkitCompassHeading;
  else if (isAbs && event.alpha != null) raw = event.alpha;
  else if (!isAbs && event.alpha != null) {
    raw = event.alpha;
    var sa = (screen.orientation && screen.orientation.angle != null) ? screen.orientation.angle : (window.orientation || 0);
    raw = (raw - sa + 360) % 360;
  } else return;
  if (raw == null || isNaN(raw)) raw = 0;
  // Vanilla heading, no remapping
  smoothHeading += LP * angleDelta(raw, smoothHeading);
  // Pitch from deviceorientation
  var pitchAngle;
  if (isLandscape) {
    pitchAngle = Math.abs(event.beta || 0);
  } else {
    pitchAngle = 90 - Math.abs(event.beta || 0);
  }
  var rawAlt = Math.max(0, Math.min(90, pitchAngle));
  smoothAltitude += LP * (rawAlt - smoothAltitude);
}

function stopSensor() {
  if (sensor) { sensor.stop(); sensor = null; }
  sensorReady = false;
  window.removeEventListener('deviceorientationabsolute', handleEvent, true);
  window.removeEventListener('deviceorientation', handleEvent, true);
}

export async function startARMode(latitude, longitude, onStop) {
  if (arActive) return;
  var overlay = document.getElementById('ar-overlay');
  var video = document.getElementById('ar-video');
  canvasEl = document.getElementById('ar-sky');
  if (!overlay || !video || !canvasEl) return;
  try {
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.style.filter = 'brightness(0.55)';
    await video.play();
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted')
        throw new Error('Motion permission denied');
    }
    overlay.classList.remove('hidden');
    arActive = true;
    videoEl = video;
    overlayEl = overlay;
    overlayEl.dataset.lat = latitude;
    overlayEl.dataset.lon = longitude;
    smoothHeading = 0;
    smoothAltitude = 45;

    // Init engine directly on AR canvas (like test-engine.html)
    if (typeof StelWebEngine === 'undefined') {
      console.log('[AR] StelWebEngine not loaded');
      return;
    }
    if (!window._stelEngineInit) {
      window._stelEngineInit = true;
      console.log('[AR] Initializing engine on AR canvas...');
      StelWebEngine({
        wasmFile: 'lib/stellarium-web-engine.wasm',
        canvas: canvasEl,
        onReady: function(engine) {
          console.log('[AR] Engine READY');
          stel = engine;
          engineReady = true;
          var base = '/test-skydata/';
          stel.core.stars.addDataSource({ url: base + 'stars' });
          stel.core.skycultures.addDataSource({ url: base + 'skycultures/western', key: 'western' });
          stel.core.dsos.addDataSource({ url: base + 'dso' });
          stel.core.milkyway.addDataSource({ url: base + 'surveys/milkyway' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/sun', key: 'sun' });
          stel.core.planets.addDataSource({ url: base + 'surveys/sso/moon', key: 'moon' });
          if (stel.core.landscapes) stel.core.landscapes.addDataSource({ url: base + 'landscapes/guereins', key: 'guereins' });
          // Show constellation lines & art
          if (stel.core.constellations) {
            stel.core.constellations.lines_visible = true;
            stel.core.constellations.labels_visible = true;
          }
          if (stel.core.atmosphere) stel.core.atmosphere.visible = false;
          if (stel.core.landscapes) stel.core.landscapes.visible = true;
          // Time: set to now (MJD)
          if (stel.core.observer && typeof stel.date2MJD === 'function') {
            stel.core.observer.utc = stel.date2MJD(new Date());
          }
          // Labels
          if (stel.core.stars) stel.core.stars.hints_visible = true;
          if (stel.core.planets) stel.core.planets.hints_visible = true;
          stel.core.observer.latitude = latitude * Math.PI / 180;
          stel.core.observer.longitude = longitude * Math.PI / 180;
          stel.core.observer.pitch = 45 * Math.PI / 180;
          stel.core.observer.yaw = 0;
          console.log('[AR] Catalogs & observer set');
          setupSliders();
        }
      });
    } else if (engineReady && stel) {
      // Already initialized from a previous AR session
      stel.core.observer.latitude = latitude * Math.PI / 180;
      stel.core.observer.longitude = longitude * Math.PI / 180;
      stel.core.observer.pitch = 45 * Math.PI / 180;
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
  if (videoEl && videoEl.srcObject) { videoEl.srcObject.getTracks().forEach(function(t){t.stop()}); videoEl.srcObject = null; }
  if (videoEl) videoEl.style.filter = '';
  videoEl = null;
  canvasEl = null;
  if (overlayEl) overlayEl.classList.add('hidden');
  overlayEl = null;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  skyOpacity = 0.92;
  timeOffsetMinutes = 0;
  stopSensor();
}

function setupSliders() {
  var opSlider = document.getElementById('ar-opacity');
  var opVal = document.getElementById('ar-opacity-val');
  if (opSlider && opVal) {
    opSlider.value = Math.round(skyOpacity * 100);
    opVal.textContent = Math.round(skyOpacity * 100) + '%';
    opSlider.addEventListener('input', function() {
      skyOpacity = parseInt(this.value) / 100;
      opVal.textContent = this.value + '%';
      if (canvasEl) canvasEl.style.opacity = skyOpacity;
    });
  }
  var tmSlider = document.getElementById('ar-time');
  var tmVal = document.getElementById('ar-time-val');
  if (tmSlider && tmVal) {
    tmSlider.value = timeOffsetMinutes;
    tmVal.textContent = formatTimeOffset(timeOffsetMinutes);
    tmSlider.addEventListener('input', function() {
      timeOffsetMinutes = parseInt(this.value);
      tmVal.textContent = formatTimeOffset(timeOffsetMinutes);
    });
  }
}

function formatTimeOffset(minutes) {
  if (minutes === 0) return 'now';
  var sign = minutes > 0 ? '+' : '';
  var h = Math.floor(Math.abs(minutes) / 60);
  var m = Math.abs(minutes) % 60;
  if (h === 0) return sign + m + 'm';
  if (m === 0) return sign + h + 'h';
  return sign + h + 'h' + m + 'm';
}

function renderLoop() {
  if (!arActive) return;
  var h = ((smoothHeading % 360) + 360) % 360;
  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.yaw = h * Math.PI / 180;
    stel.core.observer.pitch = -smoothAltitude * Math.PI / 180;
    // Apply time offset from current real time (not frozen base)
    if (typeof stel.date2MJD === 'function') {
      stel.core.observer.utc = stel.date2MJD(new Date()) + timeOffsetMinutes / (24 * 60);
    }
  }
  // Apply opacity
  if (canvasEl) canvasEl.style.opacity = skyOpacity;
  var ring = overlayEl && overlayEl.querySelector('#ar-compass-ring');
  if (ring) ring.style.transform = 'rotate(' + (-h) + 'deg)';
  var hl = overlayEl && overlayEl.querySelector('#ar-heading');
  if (hl) { var dirs=['N','NE','E','SE','S','SW','W','NW']; hl.textContent=Math.round(h)+'\xB0 '+dirs[Math.round(h/45)%8]+' / '+Math.round(smoothAltitude)+'\xB0'; }
  var al = overlayEl && overlayEl.querySelector('#ar-altitude');
  if (al) al.textContent = Math.round(smoothAltitude)+'\xB0';
  var w = window._arWeatherData;
  var ce = overlayEl && overlayEl.querySelector('#ar-cloud-pct');
  if (ce && w) { var p=w.cloudCover!=null?Math.round(w.cloudCover):'--'; ce.textContent=p==='--'?'--':p+'%'; ce.style.color=w.cloudCover<=20?'#00ff88':w.cloudCover<=50?'#ffcc00':'#ff4444'; }
  var lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  var lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  var coords = document.getElementById('ar-coords');
  if (coords && !isNaN(lat) && !isNaN(lon)) {
    coords.textContent = lat.toFixed(4) + ', ' + lon.toFixed(4);
  } else if (coords && engineReady && stel && stel.core && stel.core.observer) {
    coords.textContent = ((stel.core.observer.latitude||0)*180/Math.PI).toFixed(4) + ', ' + ((stel.core.observer.longitude||0)*180/Math.PI).toFixed(4);
  }
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') window._arBearingCallback(h, lat, lon);
  var dbg = document.getElementById('ar-debug');
  var engLat = (engineReady && stel && stel.core && stel.core.observer) ? stel.core.observer.latitude * 180 / Math.PI : NaN;
  var engLon = (engineReady && stel && stel.core && stel.core.observer) ? stel.core.observer.longitude * 180 / Math.PI : NaN;
  if (dbg) dbg.textContent = (sensorReady?'SENSOR':'EVENT') + ' | hdg:' + h.toFixed(1) + '\xB0 alt:' + smoothAltitude.toFixed(1) + '\xB0 | loc:' + (isNaN(engLat)?'--':engLat.toFixed(2)+','+engLon.toFixed(2)) + ' | eng:' + (engineReady?'OK':'loading');
  bortleLookup(lat, lon, h);
  animFrame = requestAnimationFrame(renderLoop);
}

var lastBortle = 0, cachedBortle = null;
async function bortleLookup(lat, lon, hdg) {
  if (isNaN(lat) || isNaN(lon)) return;
  if (Date.now() - lastBortle < 30000) return;
  lastBortle = Date.now();
  try {
    var R=6371,d=15/R,p1=lat*Math.PI/180,l1=lon*Math.PI/180,t=hdg*Math.PI/180;
    var p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(t));
    var l2=l1+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
    var r=await fetch('/api/bortle?lat='+((p2*180/Math.PI)).toFixed(4)+'&lon='+((l2*180/Math.PI)).toFixed(4));
    if(r.ok) cachedBortle=await r.json();
  }catch(e){}
  var el=overlayEl && overlayEl.querySelector('#ar-bortle');
  if(el&&cachedBortle){var b=cachedBortle.bortle||'?';el.textContent='B'+b;el.style.color=b<=3?'#00ff88':b<=5?'#ffcc00':'#ff4444';}
}

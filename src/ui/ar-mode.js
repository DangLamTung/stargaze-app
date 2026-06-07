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
const LP = 0.10;
let animFrame = null;
let sensor = null;
let sensorReady = false;
let engineReady = false;
let initLat = 0, initLon = 0;

export function isARActive() { return arActive; }

export function preloadStellarium(lat, lon) {
  initLat = lat; initLon = lon;
  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.latitude = lat;
    stel.core.observer.longitude = lon;
    return;
  }
  if (typeof StelWebEngine === 'undefined') {
    console.log('[AR] StelWebEngine not loaded yet, waiting for script');
    return;
  }
  // Only init ONCE
  if (window._stelEngineInit) return;
  window._stelEngineInit = true;
  console.log('[AR] Initializing Stellarium engine...');

  var c = document.getElementById('ar-preload-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'ar-preload-canvas';
    c.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(c);
  }
  StelWebEngine({
    wasmFile: 'lib/stellarium-web-engine.wasm',
    canvas: c,
    onReady: function(engine) {
      console.log('[AR] Engine READY');
      stel = engine;
      engineReady = true;
      var base = '/test-skydata/';
      stel.core.stars.addDataSource({ url: base + 'stars' });
      stel.core.skycultures.addDataSource({ url: base + 'skycultures/western', key: 'western' });
      stel.core.dsos.addDataSource({ url: base + 'dso' });
      stel.core.observer.latitude = initLat;
      stel.core.observer.longitude = initLon;
      stel.core.observer.pitch = 45 * Math.PI / 180;
      stel.core.observer.yaw = 0;
      console.log('[AR] Observer & catalogs set');
    }
  });
    }
  });
}

function quatToHdg(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  return ((Math.atan2(2*(x*y + w*z), 1 - 2*(y*y + z*z)) * 180/Math.PI) + 360) % 360;
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
        if (q) { sensorReady = true; smoothHeading += LP * angleDelta(quatToHdg(q), smoothHeading); }
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
  var raw;
  if (event.webkitCompassHeading !== undefined) raw = event.webkitCompassHeading;
  else if (isAbs && event.alpha != null) raw = event.alpha;
  else if (!isAbs && event.alpha != null) {
    raw = event.alpha;
    var sa = (screen.orientation && screen.orientation.angle != null) ? screen.orientation.angle : (window.orientation || 0);
    raw = (raw - sa + 360) % 360;
  } else return;
  if (raw == null || isNaN(raw)) raw = 0;
  smoothHeading += LP * angleDelta(raw, smoothHeading);
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
    smoothHeading = 0;

    // Engine is initialized ONCE by preloadStellarium. Just update observer.
    if (engineReady && stel) {
      console.log('[AR] Reusing preloaded engine');
      stel.core.observer.latitude = latitude;
      stel.core.observer.longitude = longitude;
      stel.core.observer.pitch = 45 * Math.PI / 180;
      stel.core.observer.yaw = 0;
    } else {
      // Engine not ready yet — preload was called earlier, give it time
      console.log('[AR] Engine not ready, will poll...');
      // Keep checking every 500ms until ready
      var checkReady = setInterval(function() {
        if (engineReady && stel && arActive) {
          clearInterval(checkReady);
          console.log('[AR] Engine became ready');
          stel.core.observer.latitude = latitude;
          stel.core.observer.longitude = longitude;
          stel.core.observer.pitch = 45 * Math.PI / 180;
          stel.core.observer.yaw = 0;
        }
      }, 500);
      // Stop polling after 15s
      setTimeout(function() { clearInterval(checkReady); }, 15000);
    }
    startSensor();
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
  stopSensor();
}

function renderLoop() {
  if (!arActive) return;
  var h = ((smoothHeading % 360) + 360) % 360;
  if (engineReady && stel && stel.core && stel.core.observer) {
    stel.core.observer.yaw = h * Math.PI / 180;
  }
  var ring = overlayEl && overlayEl.querySelector('#ar-compass-ring');
  if (ring) ring.style.transform = 'rotate(' + (-h) + 'deg)';
  var hl = overlayEl && overlayEl.querySelector('#ar-heading');
  if (hl) { var dirs=['N','NE','E','SE','S','SW','W','NW']; hl.textContent=Math.round(h)+'\xB0 '+dirs[Math.round(h/45)%8]; }
  var w = window._arWeatherData;
  var ce = overlayEl && overlayEl.querySelector('#ar-cloud-pct');
  if (ce && w) { var p=w.cloudCover!=null?Math.round(w.cloudCover):'--'; ce.textContent=p==='--'?'--':p+'%'; ce.style.color=w.cloudCover<=20?'#00ff88':w.cloudCover<=50?'#ffcc00':'#ff4444'; }
  var lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
  var lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
  if (!isNaN(lat) && !isNaN(lon) && typeof window._arBearingCallback === 'function') window._arBearingCallback(h, lat, lon);
  var dbg = document.getElementById('ar-debug');
  if (dbg) dbg.textContent = (sensorReady?'SENSOR':'EVENT') + ' | hdg:' + h.toFixed(1) + '\xB0 | engine:' + (engineReady?'OK':'loading');
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

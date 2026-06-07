/**
 * ARMode - Heading-only AR sky view.
 * Uses AbsoluteOrientationSensor (Android) then Stellarium az parameter.
 * Altitude locked at 45deg. No CSS rotation — az updates directly every 2s.
 */

let arActive = false;
let videoEl = null;
let overlayEl = null;
let skyIframe = null;
let preloadIframe = null;
let smoothHeading = 0;
const LP = 0.10;
let animFrame = null;
let sensor = null;
let sensorReady = false;

function buildUrl(lat, lon, az) {
  return 'https://stellarium-web.org/?' + new URLSearchParams({
    lat: lat.toFixed(4), lng: lon.toFixed(4),
    az: String(Math.round(az)), alt: '45', fov: '100',
  }).toString();
}

export function isARActive() { return arActive; }

export function preloadStellarium(lat, lon) {
  if (preloadIframe) { preloadIframe.remove(); preloadIframe = null; }
  var c = document.getElementById('ar-preload');
  if (!c) return;
  preloadIframe = document.createElement('iframe');
  preloadIframe.src = buildUrl(lat, lon, 0);
  preloadIframe.style.cssText = 'width:1px;height:1px;border:none;position:absolute;opacity:0;pointer-events:none;';
  preloadIframe.allow = 'geolocation';
  c.appendChild(preloadIframe);
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
      sensor = new AbsoluteOrientationSensor({ frequency: 30 });
      sensor.addEventListener('reading', function() {
        var q = sensor.quaternion;
        if (q) {
          sensorReady = true;
          smoothHeading += LP * angleDelta(quatToHdg(q), smoothHeading);
        }
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
  var skyCont = document.getElementById('ar-sky');
  if (!overlay || !video || !skyCont) return;
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
    overlay.dataset.lat = latitude;
    overlay.dataset.lon = longitude;
    smoothHeading = 0;
    skyCont.innerHTML = '';
    if (preloadIframe) { skyIframe = preloadIframe; preloadIframe = null; }
    else { skyIframe = document.createElement('iframe'); skyIframe.allow = 'geolocation'; }
    skyIframe.src = buildUrl(latitude, longitude, 0);
    skyIframe.style.cssText =
      'width:300%;height:300%;position:absolute;top:-100%;left:-100%;' +
      'border:none;opacity:0.85;pointer-events:none;transition:none;';
    skyCont.appendChild(skyIframe);
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
  if (skyIframe) { skyIframe.remove(); skyIframe = null; }
  if (pendingIframe) { pendingIframe.remove(); pendingIframe = null; }
  if (overlayEl) overlayEl.classList.add('hidden');
  overlayEl = null;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  stopSensor();
}

var lastReload = 0;
var pendingIframe = null;

function renderLoop() {
  if (!arActive) return;
  var h = ((smoothHeading % 360) + 360) % 360;
  var now = Date.now();

  // Double-buffer: load new iframe hidden, swap when ready (no white flash)
  if (now - lastReload > 2000 && skyIframe && !pendingIframe) {
    lastReload = now;
    var lat = overlayEl ? parseFloat(overlayEl.dataset.lat) : NaN;
    var lon = overlayEl ? parseFloat(overlayEl.dataset.lon) : NaN;
    if (!isNaN(lat) && !isNaN(lon)) {
      // Create offscreen iframe
      pendingIframe = document.createElement('iframe');
      pendingIframe.src = buildUrl(lat, lon, h);
      pendingIframe.style.cssText =
        'width:300%;height:300%;position:absolute;top:-100%;left:-100%;' +
        'border:none;opacity:0;pointer-events:none;transition:opacity 0.3s;';
      pendingIframe.allow = 'geolocation';
      var sc = document.getElementById('ar-sky');
      if (sc) sc.appendChild(pendingIframe);

      // When loaded, fade out old, fade in new, remove old
      pendingIframe.addEventListener('load', function swap() {
        pendingIframe.removeEventListener('load', swap);
        if (skyIframe) {
          skyIframe.style.opacity = '0';
          setTimeout(function() {
            if (skyIframe) skyIframe.remove();
            skyIframe = pendingIframe;
            skyIframe.style.opacity = '0.85';
            pendingIframe = null;
          }, 300);
        }
      });
    }
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
  if (dbg) dbg.textContent = (sensorReady?'SENSOR':'EVENT') + ' | hdg:' + h.toFixed(1) + '\xB0 | az->Stellarium every 2s';
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

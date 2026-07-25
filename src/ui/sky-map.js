/**
 * SkyMap — Local Stellarium Web Engine (WASM) rendering.
 * Uses shared stellarium-engine singleton for catalog setup.
 */
import { loadScript, isAvailable, initEngine, setObserver } from '../core/stellarium-engine.js';

let _stel = null;
let _canvas = null;

const ctx = { lat: null, lon: null, date: null, bearing: 0, alt: 35, fov: 60, sunrise: null, sunset: null };

function _fallback(el) {
  var url = ctx.lat
    ? `https://stellarium-web.org/?lat=${ctx.lat.toFixed(4)}&lng=${ctx.lon.toFixed(4)}`
    : 'https://stellarium-web.org/';
  el.innerHTML =
    '<div class="sky-fallback"><div class="sky-fallback-icon">🔭</div><h3>Sky Map</h3><p>Open Stellarium for interactive sky</p><a href="' +
    url +
    '" target="_blank" rel="noopener" class="btn-stellarium">🌌 Open Stellarium Web</a></div>';
}

function _apply() {
  if (!_stel || !_stel.core || !_stel.core.observer) return;
  var o = _stel.core.observer;
  if (ctx.lat != null) o.latitude = (ctx.lat * Math.PI) / 180;
  if (ctx.lon != null) o.longitude = (ctx.lon * Math.PI) / 180;
  o.pitch = (ctx.alt * Math.PI) / 180;
  o.yaw = (ctx.bearing * Math.PI) / 180;
}

export async function initSkyMap(containerId, latitude, longitude, date) {
  var el = document.getElementById(containerId);
  if (!el) return null;
  ctx.lat = parseFloat(latitude);
  ctx.lon = parseFloat(longitude);
  ctx.date = date || null;

  el.innerHTML = '';
  _canvas = document.createElement('canvas');
  var rect = el.getBoundingClientRect();
  _canvas.width = Math.floor(rect.width * (window.devicePixelRatio || 1)) || 640;
  _canvas.height = Math.floor(rect.height * (window.devicePixelRatio || 1)) || 360;
  _canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:12px;';
  el.appendChild(_canvas);

  try {
    _canvas.getContext('webgl', {
      alpha: false,
      depth: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
  } catch (e) {}

  try {
    await loadScript();
    if (!isAvailable()) {
      _fallback(el);
      return null;
    }

    initEngine(
      _canvas,
      function (e) {
        _stel = e;
        _apply();
        _initControls();
        var fb = document.getElementById('sky-fallback');
        if (fb) fb.style.display = 'none';
      },
      function () {
        _fallback(el);
      },
    );
    return _stel;
  } catch (e) {
    _fallback(el);
    return null;
  }
}

export function setSkyContext(o) {
  if (!o) return;
  if (o.latitude != null) ctx.lat = parseFloat(o.latitude);
  if (o.longitude != null) ctx.lon = parseFloat(o.longitude);
  if (o.date !== undefined) ctx.date = o.date;
  if (o.bearing != null) ctx.bearing = ((Number(o.bearing) % 360) + 360) % 360;
  if (o.altitude != null) ctx.alt = o.altitude;
  if (o.fov != null) ctx.fov = o.fov;
  if (o.sunrise != null) ctx.sunrise = o.sunrise;
  if (o.sunset != null) ctx.sunset = o.sunset;
}

export function setSkyBearing(deg) {
  ctx.bearing = ((Number(deg) % 360) + 360) % 360;
  _apply();
}

export function updateSkyMap(latitude, longitude, date) {
  ctx.lat = parseFloat(latitude);
  ctx.lon = parseFloat(longitude);
  if (date !== undefined) ctx.date = date;
  _apply();
  var l = document.getElementById('stellarium-link');
  if (l) l.href = getStellariumUrl(latitude, longitude);
}

export function getStellariumUrl(lat, lon, bearing) {
  return `https://stellarium-web.org/?lat=${parseFloat(lat).toFixed(4)}&lng=${parseFloat(lon).toFixed(4)}&az=${Math.round(bearing || ctx.bearing)}&fov=60`;
}

export function destroySkyMap() {
  if (_clockTimer) clearInterval(_clockTimer);
  _stel = null;
  if (_canvas) {
    _canvas.remove();
    _canvas = null;
  }
}

// ─── Global azimuth & toggle handlers ───
window._skyAz = function (d) {
  ctx.bearing = ((d % 360) + 360) % 360;
  _apply();
  var s = document.getElementById('sky-azimuth'),
    v = document.getElementById('sky-az-val');
  if (s) s.value = ctx.bearing;
  if (v) v.textContent = ctx.bearing + '°';
  if (ctx.lat != null && ctx.lon != null) {
    import('./map-service.js').then(m => m.updateViewingBearing(ctx.lat, ctx.lon, ctx.bearing));
  }
};
window._skyTg = function (w) {
  var b = document.getElementById('sky-btn-' + w);
  if (!b || !_stel || !_stel.core) return;
  b.classList.toggle('active');
  var on = b.classList.contains('active');
  if (w === 'ground' && _stel.core.landscapes) _stel.core.landscapes.visible = on;
  if (w === 'atmo' && _stel.core.atmosphere) _stel.core.atmosphere.visible = on;
  if (w === 'labels') {
    if (_stel.core.stars) _stel.core.stars.hints_visible = on;
    if (_stel.core.constellations) _stel.core.constellations.labels_visible = on;
    if (_stel.core.planets) _stel.core.planets.hints_visible = on;
  }
  if (w === 'grid' && _stel.core.lines) {
    if (_stel.core.lines.equatorial) _stel.core.lines.equatorial.visible = on;
    if (_stel.core.lines.azimuthal) _stel.core.lines.azimuthal.visible = on;
  }
  if (w === 'ecliptic' && _stel.core.lines && _stel.core.lines.ecliptic) _stel.core.lines.ecliptic.visible = on;
};

// ─── Controls ───
let _timeOffset = 0;
let _clockTimer = null;
let _simMinutes = 0;
let _simDayOffset = 0;
let _sliderDragging = false;
let _playSpeed = 0;
let _playAnimId = null;
let _playLastTs = 0;

function _getSimDate() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + _simDayOffset, 0, _simMinutes);
}
function _simDateToOffset() {
  _timeOffset = (_getSimDate() - new Date()) / 3600000;
}
function _offsetToSimDate() {
  var d = new Date(Date.now() + _timeOffset * 3600000);
  _simMinutes = d.getHours() * 60 + d.getMinutes();
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var simDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  _simDayOffset = Math.round((simDay - today) / 86400000);
}
function _sliderToMinutes(sliderVal) {
  return (parseInt(sliderVal) + 720) % 1440;
}
function _minutesToSlider(minutes) {
  return (minutes + 720) % 1440;
}

function _getSunriseMinutes() {
  if (!ctx.sunrise) return null;
  try {
    var d = new Date(ctx.sunrise);
    return d.getHours() * 60 + d.getMinutes();
  } catch (_) {
    return null;
  }
}
function _getSunsetMinutes() {
  if (!ctx.sunset) return null;
  try {
    var d = new Date(ctx.sunset);
    return d.getHours() * 60 + d.getMinutes();
  } catch (_) {
    return null;
  }
}

function _moonPhase(date) {
  var d = new Date(date);
  var lp = 2551443;
  var ne = new Date(2000, 0, 6, 18, 14).getTime() / 1000;
  var p = ((d.getTime() / 1000 - ne) / lp) % 1;
  if (p < 0) p += 1;
  var ill = (((1 - Math.cos(p * 2 * Math.PI)) / 2) * 100).toFixed(0);
  var icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  var names = [
    'New',
    'Waxing Crescent',
    'First Quarter',
    'Waxing Gibbous',
    'Full',
    'Waning Gibbous',
    'Last Quarter',
    'Waning Crescent',
  ];
  var idx = Math.round(p * 8) % 8;
  return { icon: icons[idx], name: names[idx], ill: ill, phase: p };
}

function _moonRiseSet(date, moon) {
  var phase = moon.phase;
  var riseMin = (phase * 24 * 60 + 360) % (24 * 60);
  var setMin = (riseMin + 12 * 60 + 30) % (24 * 60);
  var fmt = function (m) {
    var hh = Math.floor(m / 60) % 24,
      mm2 = Math.floor(m % 60);
    return String(hh).padStart(2, '0') + ':' + String(mm2).padStart(2, '0');
  };
  return { rise: fmt(riseMin), set: fmt(setMin) };
}

function _updateClock() {
  var d = _getSimDate();
  var hh = String(d.getHours()).padStart(2, '0'),
    mm = String(d.getMinutes()).padStart(2, '0'),
    ss = String(d.getSeconds()).padStart(2, '0');
  var el = document.getElementById('sky-realtime');
  if (el)
    el.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + hh + ':' + mm + ':' + ss;

  var yr = document.getElementById('sky-yr'),
    mo = document.getElementById('sky-mo'),
    dy = document.getElementById('sky-dy');
  if (yr) yr.textContent = d.getFullYear();
  if (mo) mo.textContent = String(d.getMonth() + 1).padStart(2, '0');
  if (dy) dy.textContent = String(d.getDate()).padStart(2, '0');

  var h = document.getElementById('sky-h'),
    m = document.getElementById('sky-m'),
    s = document.getElementById('sky-s');
  if (h) h.textContent = hh;
  if (m) m.textContent = mm;
  if (s) s.textContent = ss;

  if (!_sliderDragging) {
    var tm = document.getElementById('sky-time');
    if (tm) tm.value = _minutesToSlider(_simMinutes);
  }

  var moon = _moonPhase(d);
  var ml = document.getElementById('sky-moon');
  if (ml) ml.textContent = moon.icon + ' ' + moon.ill + '% ' + moon.name;

  var rs = _moonRiseSet(d, moon);
  var riseMin = parseInt(rs.rise.split(':')[0]) * 60 + parseInt(rs.rise.split(':')[1]);
  var setMin = parseInt(rs.set.split(':')[0]) * 60 + parseInt(rs.set.split(':')[1]);
  var riseMarker = document.getElementById('sky-moon-rise-marker'),
    setMarker = document.getElementById('sky-moon-set-marker');
  if (riseMarker) {
    riseMarker.style.left = (_minutesToSlider(riseMin) / 1439) * 100 + '%';
    riseMarker.title = 'Moon rise ' + rs.rise;
  }
  if (setMarker) {
    setMarker.style.left = (_minutesToSlider(setMin) / 1439) * 100 + '%';
    setMarker.title = 'Moon set ' + rs.set;
  }

  _updateSliderMoonlight(moon, riseMin, setMin);
  _updateMoonlightSubtitle(d, moon);
  _simDateToOffset();
  if (_stel && _stel.date2MJD) _stel.core.observer.utc = _stel.date2MJD(d);
}

function _updateSliderMoonlight(moon, riseMin, setMin) {
  var slider = document.getElementById('sky-time');
  if (!slider) return;
  var ill = parseInt(moon.ill) || 0;
  var t = 0.2 + (ill / 100) * 0.8;
  var r = Math.round(30 + t * 110),
    g = Math.round(40 + t * 140),
    b = Math.round(60 + t * 140);
  var moonColor =
    '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');

  var risePct = (_minutesToSlider(riseMin) / 1439) * 100;
  var setPct = (_minutesToSlider(setMin) / 1439) * 100;
  var srMin = _getSunriseMinutes(),
    ssMin = _getSunsetMinutes();
  var duskEnd = Math.max(18, Math.min(30, ssMin != null ? (_minutesToSlider(ssMin) / 1439) * 100 : 24));
  var dawnStart = Math.min(82, Math.max(70, srMin != null ? (_minutesToSlider(srMin) / 1439) * 100 : 76));
  var twSpan = Math.min(6, (duskEnd - 12) / 3);

  var duskDawn =
    '#87CEEB 0%,#87CEEB ' +
    (duskEnd - twSpan * 3).toFixed(1) +
    '%,#7ba8c8 ' +
    (duskEnd - twSpan * 3).toFixed(1) +
    '%,#7ba8c8 ' +
    (duskEnd - twSpan * 2).toFixed(1) +
    '%,#4a7090 ' +
    (duskEnd - twSpan * 2).toFixed(1) +
    '%,#4a7090 ' +
    (duskEnd - twSpan).toFixed(1) +
    '%,#2a4460 ' +
    (duskEnd - twSpan).toFixed(1) +
    '%,#2a4460 ' +
    duskEnd.toFixed(1) +
    '%,';
  var dawnDusk =
    '#2a4460 ' +
    dawnStart.toFixed(1) +
    '%,#2a4460 ' +
    (dawnStart + twSpan).toFixed(1) +
    '%,#4a7090 ' +
    (dawnStart + twSpan).toFixed(1) +
    '%,#4a7090 ' +
    (dawnStart + twSpan * 2).toFixed(1) +
    '%,#7ba8c8 ' +
    (dawnStart + twSpan * 2).toFixed(1) +
    '%,#7ba8c8 ' +
    (dawnStart + twSpan * 3).toFixed(1) +
    '%,#87CEEB ' +
    (dawnStart + twSpan * 3).toFixed(1) +
    '%,#87CEEB 100%';

  var nightStart = duskEnd,
    nightEnd = dawnStart;
  var rClamp = Math.max(nightStart, Math.min(nightEnd, risePct));
  var sClamp = Math.max(nightStart, Math.min(nightEnd, setPct));
  var darkNight = '#0d1428';

  var grad;
  if (Math.abs(rClamp - sClamp) < 0.5) {
    grad =
      'linear-gradient(90deg,' +
      duskDawn +
      darkNight +
      ' ' +
      duskEnd.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      dawnStart.toFixed(1) +
      '%,' +
      dawnDusk +
      ')';
  } else if (rClamp < sClamp) {
    grad =
      'linear-gradient(90deg,' +
      duskDawn +
      darkNight +
      ' ' +
      duskEnd.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      rClamp.toFixed(1) +
      '%,' +
      moonColor +
      ' ' +
      rClamp.toFixed(1) +
      '%,' +
      moonColor +
      ' ' +
      sClamp.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      sClamp.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      dawnStart.toFixed(1) +
      '%,' +
      dawnDusk +
      ')';
  } else {
    grad =
      'linear-gradient(90deg,' +
      duskDawn +
      moonColor +
      ' ' +
      duskEnd.toFixed(1) +
      '%,' +
      moonColor +
      ' ' +
      sClamp.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      sClamp.toFixed(1) +
      '%,' +
      darkNight +
      ' ' +
      rClamp.toFixed(1) +
      '%,' +
      moonColor +
      ' ' +
      rClamp.toFixed(1) +
      '%,' +
      moonColor +
      ' ' +
      dawnStart.toFixed(1) +
      '%,' +
      dawnDusk +
      ')';
  }
  slider.style.background = grad;
}

function _updateMoonlightSubtitle(d, moon) {
  var sub = document.getElementById('sky-daylight-subtitle');
  if (!sub) return;
  var totalMin = d.getHours() * 60 + d.getMinutes();
  var srMin = _getSunriseMinutes(),
    ssMin = _getSunsetMinutes();
  var dawnMin = srMin != null ? srMin : 360,
    duskMin = ssMin != null ? ssMin : 1080;
  var dawnStart = dawnMin - 40,
    dawnEnd = dawnMin + 40,
    duskStart = duskMin - 40,
    duskEnd = duskMin + 40;

  var rs = _moonRiseSet(d, moon);
  var riseMin = parseInt(rs.rise.split(':')[0]) * 60 + parseInt(rs.rise.split(':')[1]);
  var setMin = parseInt(rs.set.split(':')[0]) * 60 + parseInt(rs.set.split(':')[1]);
  var moonUp = riseMin < setMin ? totalMin >= riseMin && totalMin < setMin : totalMin >= riseMin || totalMin < setMin;

  var txt, color;
  if (totalMin >= dawnEnd && totalMin < duskStart) {
    txt = '☀️ Daylight';
    color = '#87CEEB';
  } else if ((totalMin >= dawnStart && totalMin < dawnEnd) || (totalMin >= duskStart && totalMin < duskEnd)) {
    txt = '🌅 Twilight';
    color = '#8fbc8f';
  } else {
    var moonIll = parseInt(moon.ill) || 0;
    if (moonUp && moonIll >= 1) {
      txt = moon.icon + ' Moonlight ' + moonIll + '% · ' + moon.name;
      color = '#aabbcc';
    } else if (moonIll >= 1) {
      txt = moon.icon + ' Moon below · ' + moonIll + '%';
      color = '#667788';
    } else {
      txt = '🌑 Dark Night (New Moon)';
      color = '#556688';
    }
  }
  sub.textContent = txt;
  sub.style.color = color;
}

function _applyTimeToEngine() {
  if (!_stel || !_stel.core || !_stel.core.observer || typeof _stel.date2MJD !== 'function') return;
  _stel.core.observer.utc = _stel.date2MJD(_getSimDate());
}

function _startPlayback(speed) {
  _playSpeed = speed;
  _playLastTs = performance.now();
  if (_playAnimId) cancelAnimationFrame(_playAnimId);
  var pauseBtn = document.getElementById('sky-btn-pause');
  if (pauseBtn) pauseBtn.textContent = '⏸';
  _playbackTick();
}
function _pausePlayback() {
  _playSpeed = 0;
  if (_playAnimId) {
    cancelAnimationFrame(_playAnimId);
    _playAnimId = null;
  }
  var pauseBtn = document.getElementById('sky-btn-pause');
  if (pauseBtn) pauseBtn.textContent = '▶';
}
function _playbackTick(ts) {
  if (_playSpeed === 0) return;
  if (ts === undefined) ts = performance.now();
  var dt = (ts - _playLastTs) / 1000;
  _playLastTs = ts;
  _simMinutes += (_playSpeed * dt * 3600) / 60;
  while (_simMinutes < 0) {
    _simMinutes += 1440;
    _simDayOffset--;
  }
  while (_simMinutes >= 1440) {
    _simMinutes -= 1440;
    _simDayOffset++;
  }
  var tm = document.getElementById('sky-time');
  if (tm && !_sliderDragging) tm.value = _minutesToSlider(_simMinutes);
  _updateClock();
  _applyTimeToEngine();
  if (_playSpeed !== 0) _playAnimId = requestAnimationFrame(_playbackTick);
}

function _initControls() {
  _offsetToSimDate();

  var az = document.getElementById('sky-azimuth'),
    av = document.getElementById('sky-az-val');
  if (az) {
    az.addEventListener('input', function () {
      window._skyAz(parseInt(this.value));
    });
    az.value = ctx.bearing;
    if (av) av.textContent = ctx.bearing + '°';
  }

  var tm = document.getElementById('sky-time');
  var _prevSlider = _minutesToSlider(_simMinutes);
  if (tm) {
    tm.min = 0;
    tm.max = 1439;
    tm.step = 1;
    tm.value = _prevSlider;
    tm.addEventListener('input', function () {
      _sliderDragging = true;
      var sv = parseInt(this.value);
      if (sv <= 0 && _prevSlider <= 1) {
        _simDayOffset--;
        this.value = 1439;
        _prevSlider = 1439;
        _simMinutes = _sliderToMinutes(1439);
        _updateClock();
        _applyTimeToEngine();
        return;
      }
      if (sv >= 1439 && _prevSlider >= 1438) {
        _simDayOffset++;
        this.value = 0;
        _prevSlider = 0;
        _simMinutes = _sliderToMinutes(0);
        _updateClock();
        _applyTimeToEngine();
        return;
      }
      _prevSlider = sv;
      _simMinutes = _sliderToMinutes(sv);
      _updateClock();
      _applyTimeToEngine();
    });
    tm.addEventListener('change', function () {
      _sliderDragging = false;
      _prevSlider = parseInt(this.value);
      _simMinutes = _sliderToMinutes(_prevSlider);
      _updateClock();
      _applyTimeToEngine();
    });
  }

  var dateFields = {
    yr: function (d, delta) {
      d.setFullYear(d.getFullYear() + delta);
    },
    mo: function (d, delta) {
      d.setMonth(d.getMonth() + delta);
    },
    dy: function (d, delta) {
      d.setDate(d.getDate() + delta);
    },
  };
  Object.keys(dateFields).forEach(function (f) {
    var up = document.getElementById('sky-' + f + '-up'),
      dn = document.getElementById('sky-' + f + '-down'),
      fn = dateFields[f];
    if (up)
      up.addEventListener('click', function () {
        var d = _getSimDate();
        fn(d, 1);
        _syncSimFromDate(d);
      });
    if (dn)
      dn.addEventListener('click', function () {
        var d = _getSimDate();
        fn(d, -1);
        _syncSimFromDate(d);
      });
  });

  var timeFields = {
    h: function (d, delta) {
      d.setHours(d.getHours() + delta);
    },
    m: function (d, delta) {
      d.setMinutes(d.getMinutes() + delta);
    },
    s: function (d, delta) {
      d.setSeconds(d.getSeconds() + delta);
    },
  };
  Object.keys(timeFields).forEach(function (f) {
    var up = document.getElementById('sky-' + f + '-up'),
      dn = document.getElementById('sky-' + f + '-down'),
      fn = timeFields[f];
    if (up)
      up.addEventListener('click', function () {
        var d = _getSimDate();
        fn(d, 1);
        _syncSimFromDate(d);
      });
    if (dn)
      dn.addEventListener('click', function () {
        var d = _getSimDate();
        fn(d, -1);
        _syncSimFromDate(d);
      });
  });

  var btnReset = document.getElementById('sky-btn-reset');
  if (btnReset) btnReset.addEventListener('click', _resetToNow);

  var btnPause = document.getElementById('sky-btn-pause');
  if (btnPause)
    btnPause.addEventListener('click', function () {
      _playSpeed === 0 ? _startPlayback(1) : _pausePlayback();
    });

  if (_clockTimer) clearInterval(_clockTimer);
  _updateClock();
  _clockTimer = setInterval(_updateClock, 1000);
}

function _syncSimFromDate(d) {
  _simMinutes = d.getHours() * 60 + d.getMinutes();
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var simDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  _simDayOffset = Math.round((simDay - today) / 86400000);
  _updateSlidersFromSim();
}
function _resetToNow() {
  var now = new Date();
  _simMinutes = now.getHours() * 60 + now.getMinutes();
  _simDayOffset = 0;
  _pausePlayback();
  _updateSlidersFromSim();
}
function _updateSlidersFromSim() {
  var tm = document.getElementById('sky-time');
  if (tm && !_sliderDragging) tm.value = _simMinutes;
  _updateClock();
  _applyTimeToEngine();
}

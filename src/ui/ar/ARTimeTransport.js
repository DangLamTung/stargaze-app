/**
 * ARTimeTransport — Copied from sky-map.js _initControls.
 * Targets ar- prefixed DOM elements instead of sky-.
 */

var _stelAR = null;
var _timeOffset = 0;
var _clockTimer = null;
var _simMinutes = 0;
var _simDayOffset = 0;
var _sliderDragging = false;
var _playSpeed = 0;
var _playAnimId = null;
var _playLastTs = 0;

var _onTimeChange = null;

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

function _updateSliderMoonlight(moon, riseMin, setMin) {
  var slider = document.getElementById('ar-daylight');
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
  var duskEnd = 24,
    dawnStart = 76;
  var twSpan = 4;

  var duskDawn =
    '#87CEEB 0%,#87CEEB ' +
    (duskEnd - twSpan * 3) +
    '%,#7ba8c8 ' +
    (duskEnd - twSpan * 3) +
    '%,#7ba8c8 ' +
    (duskEnd - twSpan * 2) +
    '%,#4a7090 ' +
    (duskEnd - twSpan * 2) +
    '%,#4a7090 ' +
    (duskEnd - twSpan) +
    '%,#2a4460 ' +
    (duskEnd - twSpan) +
    '%,#2a4460 ' +
    duskEnd +
    '%,';
  var dawnDusk =
    '#2a4460 ' +
    dawnStart +
    '%,#2a4460 ' +
    (dawnStart + twSpan) +
    '%,#4a7090 ' +
    (dawnStart + twSpan) +
    '%,#4a7090 ' +
    (dawnStart + twSpan * 2) +
    '%,#7ba8c8 ' +
    (dawnStart + twSpan * 2) +
    '%,#7ba8c8 ' +
    (dawnStart + twSpan * 3) +
    '%,#87CEEB ' +
    (dawnStart + twSpan * 3) +
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
      duskEnd +
      '%,' +
      darkNight +
      ' ' +
      dawnStart +
      '%,' +
      dawnDusk +
      ')';
  } else if (rClamp < sClamp) {
    grad =
      'linear-gradient(90deg,' +
      duskDawn +
      darkNight +
      ' ' +
      duskEnd +
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
      dawnStart +
      '%,' +
      dawnDusk +
      ')';
  } else {
    grad =
      'linear-gradient(90deg,' +
      duskDawn +
      moonColor +
      ' ' +
      duskEnd +
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
      dawnStart +
      '%,' +
      dawnDusk +
      ')';
  }
  slider.style.background = grad;
}

function _updateClock() {
  var d = _getSimDate();
  var hh = String(d.getHours()).padStart(2, '0'),
    mm = String(d.getMinutes()).padStart(2, '0'),
    ss = String(d.getSeconds()).padStart(2, '0');

  var yr = document.getElementById('ar-yr'),
    mo = document.getElementById('ar-mo'),
    dy = document.getElementById('ar-dy');
  if (yr) yr.textContent = d.getFullYear();
  if (mo) mo.textContent = String(d.getMonth() + 1).padStart(2, '0');
  if (dy) dy.textContent = String(d.getDate()).padStart(2, '0');

  var h = document.getElementById('ar-h'),
    m = document.getElementById('ar-m'),
    s = document.getElementById('ar-s');
  if (h) h.textContent = hh;
  if (m) m.textContent = mm;
  if (s) s.textContent = ss;

  if (!_sliderDragging) {
    var tm = document.getElementById('ar-daylight');
    if (tm) tm.value = _minutesToSlider(_simMinutes);
  }

  var moon = _moonPhase(d);
  var rs = _moonRiseSet(d, moon);
  var riseMin = parseInt(rs.rise.split(':')[0]) * 60 + parseInt(rs.rise.split(':')[1]);
  var setMin = parseInt(rs.set.split(':')[0]) * 60 + parseInt(rs.set.split(':')[1]);
  var riseMarker = document.getElementById('ar-moon-rise-marker'),
    setMarker = document.getElementById('ar-moon-set-marker');
  if (riseMarker) {
    riseMarker.style.left = (_minutesToSlider(riseMin) / 1439) * 100 + '%';
    riseMarker.title = 'Moon rise ' + rs.rise;
  }
  if (setMarker) {
    setMarker.style.left = (_minutesToSlider(setMin) / 1439) * 100 + '%';
    setMarker.title = 'Moon set ' + rs.set;
  }

  _updateSliderMoonlight(moon, riseMin, setMin);
  _simDateToOffset();
  if (_stelAR && _stelAR.date2MJD) _stelAR.core.observer.utc = _stelAR.date2MJD(d);
}

function _applyTimeToEngine() {
  if (!_stelAR || !_stelAR.core || !_stelAR.core.observer || typeof _stelAR.date2MJD !== 'function') return;
  _stelAR.core.observer.utc = _stelAR.date2MJD(_getSimDate());
}

function _syncSimFromDate(d) {
  _simMinutes = d.getHours() * 60 + d.getMinutes();
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var simDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  _simDayOffset = Math.round((simDay - today) / 86400000);
  _updateSlidersFromSim();
}
function _updateSlidersFromSim() {
  var tm = document.getElementById('ar-daylight');
  if (tm && !_sliderDragging) tm.value = _simMinutes;
  _updateClock();
  _applyTimeToEngine();
}

function _initControls() {
  _offsetToSimDate();

  var tm = document.getElementById('ar-daylight');
  var _prevSlider = _minutesToSlider(_simMinutes);
  if (tm) {
    tm.min = 0;
    tm.max = 1439;
    tm.step = 1;
    tm.value = _prevSlider;
    tm.addEventListener('input', function () {
      _sliderDragging = true;
      var sv = parseInt(this.value);
      // Edge wrapping
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
      // Midnight crossing (720 = midnight on night-centered slider)
      if (_prevSlider < 720 && sv >= 720) {
        _simDayOffset++;
      } else if (_prevSlider >= 720 && sv < 720) {
        _simDayOffset--;
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
    var up = document.getElementById('ar-' + f + '-up'),
      dn = document.getElementById('ar-' + f + '-down'),
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
    var up = document.getElementById('ar-' + f + '-up'),
      dn = document.getElementById('ar-' + f + '-down'),
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

  if (_clockTimer) clearInterval(_clockTimer);
  _updateClock();
  _clockTimer = setInterval(_updateClock, 1000);
}

export class ARTimeTransport {
  constructor() {
    this.arTimeAnimSpeed = 0;
    this.arTimeAnimId = null;
    this.arTimeAnimLastTs = 0;
  }

  init(stelRef, onTimeChange) {
    _stelAR = stelRef;
    _onTimeChange = onTimeChange;
    _offsetToSimDate();
    _initControls();
    // Force immediate update
    _updateClock();
  }

  stepHours(dh) {
    var d = _getSimDate();
    d.setHours(d.getHours() + dh);
    _syncSimFromDate(d);
  }
  startAnim(speed) {
    /* no-op: no playback buttons in AR */
  }
  stopAnim() {
    /* no-op */
  }
}

export const arTimeTransport = new ARTimeTransport();

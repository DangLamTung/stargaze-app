/**
 * WindLayer — Animated wind flow overlay for Leaflet (Windy-style)
 * Uses Open-Meteo wind data, rendered on a Canvas overlay.
 */

var _windTimer = null;
var _windOverlay = null;
var _windParticles = [];
var _windData = null;
var _windMap = null;

function windColor(speedMs) {
  // Color gradient: light blue (calm) → cyan (moderate) → white (strong)
  if (speedMs < 2) return 'rgba(100,160,220,';
  if (speedMs < 5) return 'rgba(130,200,240,';
  if (speedMs < 8) return 'rgba(160,230,255,';
  if (speedMs < 12) return 'rgba(200,245,255,';
  return 'rgba(240,250,255,';
}

export function addWindLayer(map) {
  if (_windOverlay) return;
  _windMap = map;

  var WindLayer = L.Layer.extend({
    initialize: function () {
      this._canvas = null;
      this._frame = 0;
    },
    onAdd: function () {
      var pane = map.getPane('overlayPane');
      this._canvas = L.DomUtil.create('canvas', 'wind-canvas');
      this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:450;';
      this._canvas.width = map.getSize().x;
      this._canvas.height = map.getSize().y;
      pane.appendChild(this._canvas);
      this._start();
    },
    onRemove: function () {
      this._stop();
      if (this._canvas) {
        L.DomUtil.remove(this._canvas);
        this._canvas = null;
      }
    },
    _start: function () {
      var self = this;
      _windParticles = [];
      // Dense grid for smoother look
      var cols = 40,
        rows = 30;
      var size = map.getSize();
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          _windParticles.push({
            x: (c / cols) * size.x + (Math.random() - 0.5) * (size.x / cols),
            y: (r / rows) * size.y + (Math.random() - 0.5) * (size.y / rows),
            age: Math.random() * 120,
            maxAge: 60 + Math.random() * 80,
            perturb: (Math.random() - 0.5) * 0.3,
          });
        }
      }
      _windTimer = setInterval(function () {
        self._draw();
      }, 33); // ~30fps
    },
    _stop: function () {
      clearInterval(_windTimer);
      _windTimer = null;
      _windParticles = [];
    },
    _draw: function () {
      if (!this._canvas || !_windMap) return;
      var ctx = this._canvas.getContext('2d');
      var size = _windMap.getSize();
      if (this._canvas.width !== size.x || this._canvas.height !== size.y) {
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        // Re-spawn if resized
        _windParticles = [];
        var cols = 40,
          rows = 30;
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            _windParticles.push({
              x: (c / cols) * size.x + (Math.random() - 0.5) * (size.x / cols),
              y: (r / rows) * size.y + (Math.random() - 0.5) * (size.y / rows),
              age: Math.random() * 120,
              maxAge: 60 + Math.random() * 80,
              perturb: (Math.random() - 0.5) * 0.3,
            });
          }
        }
      }
      ctx.clearRect(0, 0, size.x, size.y);

      var wind = { speed: 3, dir: 90 };
      if (_windData && _windData.hourly) {
        var h = new Date().getHours();
        var idx = Math.min(h, (_windData.hourly.time?.length || 1) - 1);
        wind.speed = _windData.hourly.wind_speed_10m?.[idx] || 3;
        wind.dir = _windData.hourly.wind_direction_10m?.[idx] || 90;
      }

      // Wind blows FROM dir, particles flow TO (dir + 180)
      var baseRad = ((wind.dir + 180) * Math.PI) / 180;
      var spd = Math.max(0.5, wind.speed);
      var colorBase = windColor(spd);

      for (var i = 0; i < _windParticles.length; i++) {
        var p = _windParticles[i];
        p.age += 1;
        if (p.age > p.maxAge) {
          p.age = 0;
          p.x = Math.random() * size.x;
          p.y = Math.random() * size.y;
        }

        // Add slight perturbation for natural look
        var rad = baseRad + p.perturb;
        p.x += Math.cos(rad) * spd * 0.6;
        p.y += Math.sin(rad) * spd * 0.6;
        if (p.x < -30) p.x = size.x + 30;
        if (p.x > size.x + 30) p.x = -30;
        if (p.y < -30) p.y = size.y + 30;
        if (p.y > size.y + 30) p.y = -30;

        var life = p.age / p.maxAge;
        var alpha = 0.05 + 0.25 * (1 - life);
        var trailLen = spd * 2.5 * (1 - life);

        ctx.strokeStyle = colorBase + alpha + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(rad) * trailLen, p.y - Math.sin(rad) * trailLen);
        ctx.stroke();
      }
    },
  });

  _windOverlay = new WindLayer();
  map.addLayer(_windOverlay);

  // Fetch wind data
  var center = map.getCenter();
  fetch(
    'https://api.open-meteo.com/v1/forecast?latitude=' +
      center.lat.toFixed(2) +
      '&longitude=' +
      center.lng.toFixed(2) +
      '&hourly=wind_speed_10m,wind_direction_10m&forecast_days=1&wind_speed_unit=ms',
  )
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      _windData = d;
    })
    .catch(function () {});
}

export function removeWindLayer(map) {
  if (_windOverlay) {
    map.removeLayer(_windOverlay);
    _windOverlay = null;
  }
  _windData = null;
  _windMap = null;
}

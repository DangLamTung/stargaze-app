/**
 * WindLayer — Animated wind flow overlay for Leaflet (Windy-style)
 * Uses wind data, rendered on a Canvas overlay with dynamic streamlines.
 */

let _windTimer = null;
let _windOverlay = null;
let _windParticles = [];
let _windData = null;
let _windMap = null;
let _windOpacity = 0.85;

function windColor(speedMs) {
  // Color gradient: light blue (calm) → cyan (moderate) → white/amber (strong)
  if (speedMs < 2) return 'rgba(100,160,220,';
  if (speedMs < 5) return 'rgba(130,200,240,';
  if (speedMs < 8) return 'rgba(160,230,255,';
  if (speedMs < 12) return 'rgba(200,245,255,';
  return 'rgba(255,235,170,';
}

export function setWindOpacity(opacity) {
  _windOpacity = Math.max(0.1, Math.min(1.0, opacity));
}

function fetchCenterWind(map) {
  if (!map) return;
  const center = map.getCenter();
  fetch(
    'https://api.open-meteo.com/v1/forecast?latitude=' +
      center.lat.toFixed(2) +
      '&longitude=' +
      center.lng.toFixed(2) +
      '&hourly=wind_speed_10m,wind_direction_10m&forecast_days=1&wind_speed_unit=ms',
  )
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d) _windData = d;
    })
    .catch(() => {});
}

export function addWindLayer(map) {
  if (_windOverlay) return;
  _windMap = map;

  const WindLayer = L.Layer.extend({
    initialize: function () {
      this._canvas = null;
    },
    onAdd: function () {
      const pane = map.getPane('overlayPane');
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
      const self = this;
      _windParticles = [];
      const cols = 45;
      const rows = 35;
      const size = map.getSize();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          _windParticles.push({
            x: (c / cols) * size.x + (Math.random() - 0.5) * (size.x / cols),
            y: (r / rows) * size.y + (Math.random() - 0.5) * (size.y / rows),
            age: Math.random() * 120,
            maxAge: 60 + Math.random() * 80,
            perturb: (Math.random() - 0.5) * 0.35,
          });
        }
      }
      _windTimer = setInterval(function () {
        self._draw();
      }, 33);
    },
    _stop: function () {
      if (_windTimer) clearInterval(_windTimer);
      _windTimer = null;
      _windParticles = [];
    },
    _draw: function () {
      if (!this._canvas || !_windMap) return;
      const ctx = this._canvas.getContext('2d');
      const size = _windMap.getSize();
      if (this._canvas.width !== size.x || this._canvas.height !== size.y) {
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        _windParticles = [];
        const cols = 45;
        const rows = 35;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            _windParticles.push({
              x: (c / cols) * size.x + (Math.random() - 0.5) * (size.x / cols),
              y: (r / rows) * size.y + (Math.random() - 0.5) * (size.y / rows),
              age: Math.random() * 120,
              maxAge: 60 + Math.random() * 80,
              perturb: (Math.random() - 0.5) * 0.35,
            });
          }
        }
      }
      ctx.clearRect(0, 0, size.x, size.y);

      let speed = 3;
      let dir = 90;
      if (_windData?.hourly) {
        const h = new Date().getHours();
        const idx = Math.min(h, (_windData.hourly.time?.length || 1) - 1);
        speed = _windData.hourly.wind_speed_10m?.[idx] || 3;
        dir = _windData.hourly.wind_direction_10m?.[idx] || 90;
      }

      // Wind blows FROM dir, particles flow TO (dir + 180)
      const baseRad = ((dir + 180) * Math.PI) / 180;
      const spd = Math.max(0.5, speed);
      const colorBase = windColor(spd);

      for (let i = 0; i < _windParticles.length; i++) {
        const p = _windParticles[i];
        p.age += 1;
        if (p.age > p.maxAge) {
          p.age = 0;
          p.x = Math.random() * size.x;
          p.y = Math.random() * size.y;
        }

        const rad = baseRad + p.perturb;
        p.x += Math.cos(rad) * spd * 0.65;
        p.y += Math.sin(rad) * spd * 0.65;
        if (p.x < -30) p.x = size.x + 30;
        if (p.x > size.x + 30) p.x = -30;
        if (p.y < -30) p.y = size.y + 30;
        if (p.y > size.y + 30) p.y = -30;

        const life = p.age / p.maxAge;
        const alpha = (0.08 + 0.35 * (1 - life)) * _windOpacity;
        const trailLen = spd * 3.0 * (1 - life);

        ctx.strokeStyle = colorBase + alpha + ')';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(rad) * trailLen, p.y - Math.sin(rad) * trailLen);
        ctx.stroke();
      }
    },
  });

  _windOverlay = new WindLayer();
  map.addLayer(_windOverlay);

  fetchCenterWind(map);
  map.on('moveend', () => fetchCenterWind(map));
}

export function removeWindLayer(map) {
  if (_windOverlay && map) {
    map.off('moveend');
    map.removeLayer(_windOverlay);
    _windOverlay = null;
  }
  _windData = null;
  _windMap = null;
}

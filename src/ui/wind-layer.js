/**
 * WindLayer — High-Visibility Animated Wind Flow & Streamlines for Leaflet (Windy-style)
 * Uses high-contrast neon streamlines with trailing heads and multi-speed palettes.
 */

let _windTimer = null;
let _windOverlay = null;
let _windParticles = [];
let _windData = null;
let _windMap = null;
let _windOpacity = 0.95;

function getWindColor(speedMs) {
  // Vibrant glowing neon color based on wind speed (m/s)
  if (speedMs < 2.5) return { r: 0, g: 240, b: 255 }; // Electric Cyan
  if (speedMs < 5.5) return { r: 56, g: 189, b: 248 }; // Vivid Sky Blue
  if (speedMs < 8.5) return { r: 52, g: 211, b: 153 }; // Neon Mint
  if (speedMs < 13.0) return { r: 251, g: 191, b: 36 }; // Vivid Amber
  return { r: 248, g: 113, b: 113 }; // Neon Coral / Magenta
}

export function setWindOpacity(opacity) {
  _windOpacity = Math.max(0.2, Math.min(1.0, opacity));
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
      this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:460;';
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
      const isMobile = window.innerWidth <= 768;
      const count = isMobile ? 120 : 260;
      const size = map.getSize();

      for (let i = 0; i < count; i++) {
        _windParticles.push({
          x: Math.random() * size.x,
          y: Math.random() * size.y,
          age: Math.random() * 90,
          maxAge: 50 + Math.random() * 60,
          perturb: (Math.random() - 0.5) * 0.4,
          history: [],
        });
      }

      _windTimer = setInterval(function () {
        self._draw();
      }, 25); // ~40fps smooth flow
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
        const isMobile = window.innerWidth <= 768;
        const count = isMobile ? 120 : 260;
        for (let i = 0; i < count; i++) {
          _windParticles.push({
            x: Math.random() * size.x,
            y: Math.random() * size.y,
            age: Math.random() * 90,
            maxAge: 50 + Math.random() * 60,
            perturb: (Math.random() - 0.5) * 0.4,
            history: [],
          });
        }
      }

      ctx.clearRect(0, 0, size.x, size.y);

      let speed = 4;
      let dir = 110;
      if (_windData?.hourly) {
        const h = new Date().getHours();
        const idx = Math.min(h, (_windData.hourly.time?.length || 1) - 1);
        speed = _windData.hourly.wind_speed_10m?.[idx] || 4;
        dir = _windData.hourly.wind_direction_10m?.[idx] || 110;
      }

      // Wind blows FROM dir, particles flow TO (dir + 180)
      const baseRad = ((dir + 180) * Math.PI) / 180;
      const spd = Math.max(1.0, speed);
      const c = getWindColor(spd);

      for (let i = 0; i < _windParticles.length; i++) {
        const p = _windParticles[i];
        p.age += 1;

        if (p.age > p.maxAge) {
          p.age = 0;
          p.x = Math.random() * size.x;
          p.y = Math.random() * size.y;
          p.history = [];
        }

        const rad = baseRad + p.perturb;
        const step = spd * 0.85;
        p.x += Math.cos(rad) * step;
        p.y += Math.sin(rad) * step;

        // Wrap around borders with margin
        if (p.x < -40) {
          p.x = size.x + 30;
          p.history = [];
        }
        if (p.x > size.x + 40) {
          p.x = -30;
          p.history = [];
        }
        if (p.y < -40) {
          p.y = size.y + 30;
          p.history = [];
        }
        if (p.y > size.y + 40) {
          p.y = -30;
          p.history = [];
        }

        p.history.push({ x: p.x, y: p.y });
        if (p.history.length > 5) p.history.shift();

        const life = p.age / p.maxAge;
        const alpha = Math.sin(life * Math.PI) * _windOpacity * 0.95;

        if (p.history.length >= 2 && alpha > 0.05) {
          ctx.beginPath();
          ctx.moveTo(p.history[0].x, p.history[0].y);
          for (let j = 1; j < p.history.length; j++) {
            ctx.lineTo(p.history[j].x, p.history[j].y);
          }
          ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, 0.6)`;
          ctx.shadowBlur = 4;
          ctx.stroke();

          // Draw head dot for high definition particle flow
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.4, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
          ctx.fill();
        }
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

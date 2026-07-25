/**
 * AppTide — tide panel, chart, search dropdown.
 * Extracted from app.js to reduce monolith size (~550 lines saved).
 */
import { getTideExtremes, getTideCurve, VN_TIDE_STATIONS } from '../core/tide-service.js';
import { saveState } from './app-state.js';

let _state = null;
let _tideSearchTimer = null;

// Tide chart panning state
const _chartState = { offsetDays: 0, dragging: false, dragStartX: 0, dragStartOffset: 0 };
let _chartLat = 0,
  _chartLon = 0,
  _chartTides = [];

export function init(stateRef) {
  _state = stateRef;
  initTideSearch();
  initStationSelector();
}

function initStationSelector() {
  const sel = document.getElementById('tide-station-select');
  if (!sel) return;
  VN_TIDE_STATIONS.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.name;
    opt.textContent =
      st.name + ' (' + st.regime.charAt(0).toUpperCase() + st.regime.slice(1) + ', ' + st.maxRange + 'm)';
    sel.appendChild(opt);
  });
  sel.value = _state.tideStation || '';
  sel.addEventListener('change', function () {
    _state.tideStation = this.value || null;
    saveState();
    if (_state.location) renderTidePanel(_state.location.latitude, _state.location.longitude);
  });
}

function initTideSearch() {
  const input = document.getElementById('tide-search-input');
  const dropdown = document.getElementById('tide-search-dropdown');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(_tideSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      dropdown.style.display = 'none';
      return;
    }
    _tideSearchTimer = setTimeout(() => {
      fetch('/api/tide-search?q=' + encodeURIComponent(q) + '&count=8')
        .then(r => r.json())
        .then(results => {
          if (!results?.length) {
            dropdown.style.display = 'none';
            return;
          }
          dropdown.innerHTML = results
            .map(r => {
              const sub = [r.admin1, r.country].filter(Boolean).join(', ');
              return `<div class="tide-search-item" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${r.name}">
              <span class="tide-search-name">${r.name}${r.coastal ? ' 🏖️' : ''}</span>
              <span class="tide-search-sub">${sub}${r.stationName ? ' · ' + r.stationName : ''}</span></div>`;
            })
            .join('');
          dropdown.style.display = 'block';
        })
        .catch(() => {
          dropdown.style.display = 'none';
        });
    }, 300);
  });

  input.addEventListener('blur', () =>
    setTimeout(() => {
      dropdown.style.display = 'none';
    }, 200),
  );

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.tide-search-item');
    if (!item) return;
    const lat = parseFloat(item.dataset.lat),
      lon = parseFloat(item.dataset.lon);
    input.value = item.dataset.name;
    dropdown.style.display = 'none';
    renderTidePanel(lat, lon);
    try {
      _state.map.setView([lat, lon], 12);
      L.marker([lat, lon])
        .addTo(_state.map)
        .bindPopup('🌊 ' + item.dataset.name)
        .openPopup();
    } catch (ex) {
      void ex;
    }
  });
}

export async function renderTidePanel(lat, lon) {
  const sec = document.getElementById('tide-section');
  const tbl = document.getElementById('tide-table');
  const src = document.getElementById('tide-source');
  const stn = document.getElementById('tide-station');
  const sel = document.getElementById('tide-station-select');
  if (!sec || !tbl) return;

  try {
    const data = await getTideExtremes(lat, lon, new Date(), 3, _state.tideStation);
    if (!data.tides?.length) {
      sec.style.display = 'none';
      return;
    }
    sec.style.display = '';

    _setChartParams(lat, lon, data.tides);
    drawTideChart(lat, lon, data.tides);
    setupTideChartDrag();
    updateTideStatus(data.tides);

    tbl.innerHTML = data.tides
      .map(t => {
        const dt = new Date(t.time);
        const hh = ('0' + dt.getHours()).slice(-2),
          mm = ('0' + dt.getMinutes()).slice(-2);
        const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:11px">
        <span style="color:#94a3b8">${dateStr} ${hh}:${mm}</span>
        <span style="color:${t.type === 'high' ? '#00d4ff' : '#f97316'}">${t.type === 'high' ? '▲' : '▼'} ${t.height}m</span></div>`;
      })
      .join('');

    if (src) {
      let sourceName = data.source;
      if (data.usingConstants) sourceName = 'Published harmonic constants (VN Marine Center)';
      else if (sourceName === 'stormglass') sourceName = 'StormGlass API';
      else sourceName = 'Harmonic model (estimated)';
      src.textContent = 'Source: ' + sourceName;
    }
    if (stn && data.stationName)
      stn.textContent = '· ' + data.stationName + (data.stationDistance ? ' (' + data.stationDistance + 'km)' : '');
    if (sel && data.stationName && !_state.tideStation) sel.value = data.stationName;
  } catch (e) {
    sec.style.display = 'none';
  }
}

function updateTideStatus(tides) {
  const now = new Date();
  const nowLabel = document.getElementById('tide-now-label');
  const nextLabel = document.getElementById('tide-next-label');
  const seaLabel = document.getElementById('tide-sea-label');
  const seaBox = document.getElementById('tide-sea-box');

  let prev, next;
  for (let i = 0; i < tides.length; i++) {
    if (new Date(tides[i].time) > now) {
      prev = tides[i - 1] || tides[tides.length - 1];
      next = tides[i];
      break;
    }
  }
  if (!next && tides.length >= 2) {
    prev = tides[tides.length - 2];
    next = tides[tides.length - 1];
  }

  if (prev && next) {
    const falling = prev.type === 'high' && next.type === 'low';
    const icon = falling ? '↘' : '↗';
    const label = falling ? 'Falling' : 'Rising';
    const minToNext = Math.round((new Date(next.time) - now) / 60000);
    const h = minToNext >= 60 ? Math.floor(minToNext / 60) + 'h ' + (minToNext % 60) + 'm' : minToNext + 'm';
    const curH = prev.height != null ? prev.height.toFixed(1) : '--';
    const nextTime = new Date(next.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (nowLabel)
      nowLabel.innerHTML =
        icon +
        ' <b>' +
        label +
        '</b> <span style="color:#94a3b8;font-size:10px">' +
        curH +
        'm · to ' +
        next.type.toUpperCase() +
        ' ' +
        h +
        '</span>';
    if (nextLabel)
      nextLabel.innerHTML =
        (next.type === 'high' ? '🔺' : '🔻') +
        ' <b>' +
        next.type.toUpperCase() +
        ' ' +
        next.height.toFixed(1) +
        'm</b> <span style="color:#94a3b8;font-size:10px">at ' +
        nextTime +
        '</span>';
  }

  let windKph = 0;
  try {
    windKph = _state.weatherData?.current?.windSpeed || 0;
  } catch (e) {
    void e;
  }

  let condition, color, bg;
  if (windKph < 5) {
    condition = '🪞 Mirror';
    color = '#22d3ee';
    bg = 'rgba(34,211,238,0.08)';
  } else if (windKph < 12) {
    condition = '🌊 Calm';
    color = '#4ade80';
    bg = 'rgba(74,222,128,0.08)';
  } else if (windKph < 20) {
    condition = '🌬️ Choppy';
    color = '#fbbf24';
    bg = 'rgba(251,191,36,0.08)';
  } else {
    condition = '⚠️ Rough';
    color = '#f87171';
    bg = 'rgba(248,113,113,0.08)';
  }
  if (seaLabel) {
    seaLabel.innerHTML = condition + ' <span style="color:#94a3b8;font-size:10px">' + windKph + ' km/h</span>';
    seaLabel.style.color = color;
  }
  if (seaBox) seaBox.style.background = bg;
}

// ─── Tide Chart (interactive, 24h view with drag-to-pan) ───

function drawTideChart(lat, lon, tides) {
  const canvas = document.getElementById('tide-chart-canvas');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  if (!wrap || wrap.offsetWidth === 0 || wrap.offsetHeight === 0) {
    setTimeout(() => drawTideChart(lat, lon, tides), 100);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrap.offsetWidth * dpr;
  canvas.height = wrap.offsetHeight * dpr;
  canvas.style.width = wrap.offsetWidth + 'px';
  canvas.style.height = wrap.offsetHeight + 'px';
  const ctx = canvas.getContext('2d');

  getTideCurve(lat, lon, new Date(), 4, _state.tideStation).then(allPoints => {
    if (!allPoints || allPoints.length < 2) return;
    const cw = canvas.width / dpr,
      ch = canvas.height / dpr;
    if (cw === 0 || ch === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    _drawChartOnCanvas(ctx, cw, ch, allPoints, tides);
  });
}

function _drawChartOnCanvas(ctx, W, H, allPoints, tides) {
  ctx.clearRect(0, 0, W, H);
  const maxOffset = 2.5;
  _chartState.offsetDays = Math.max(-0.5, Math.min(maxOffset, _chartState.offsetDays));

  const windowH = 24;
  let startIdx = Math.round((_chartState.offsetDays * 24) / 0.25);
  startIdx = Math.max(0, Math.min(allPoints.length - windowH / 0.25 - 1, startIdx));
  const endIdx = startIdx + Math.round(windowH / 0.25);
  const points = allPoints.slice(startIdx, Math.min(endIdx + 1, allPoints.length));
  if (points.length < 2) return;

  const winStart = points[0].time,
    winEnd = points[points.length - 1].time;
  let minH = Infinity,
    maxH = -Infinity;
  points.forEach(p => {
    if (p.height < minH) minH = p.height;
    if (p.height > maxH) maxH = p.height;
  });
  const pad = { top: 20, right: 40, bottom: 28, left: 42 };
  const pw = W - pad.left - pad.right,
    ph = H - pad.top - pad.bottom;
  maxH = Math.ceil(maxH * 2) / 2 || 1;
  minH = 0;

  const x = t => pad.left + ((t - winStart) / (winEnd - winStart)) * pw;
  const y = h => pad.top + ph - ((h - minH) / (maxH - minH)) * ph;

  // Background
  ctx.fillStyle = 'rgba(8,14,26,0.5)';
  ctx.fillRect(pad.left, pad.top, pw, ph);

  // Grid + Y labels
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Outfit, sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const val = minH + (g / 4) * (maxH - minH),
      gy = y(val);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(W - pad.right, gy);
    ctx.stroke();
    ctx.fillText(val.toFixed(1) + 'm', pad.left - 4, gy + 3);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '9px Outfit, sans-serif';
  for (let h = 0; h <= 24; h += 3) {
    const ht = new Date(winStart.getTime() + h * 3600000);
    ctx.fillText(ht.getHours() + 'h', x(ht), H - pad.bottom + 14);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 10px Outfit, sans-serif';
  ctx.fillText(
    winStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    pad.left + pw / 2,
    H - 4,
  );

  // Water fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(0,180,220,0.22)');
  grad.addColorStop(1, 'rgba(0,80,140,0.04)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x(points[0].time), y(points[0].height));
  points.forEach(p => ctx.lineTo(x(p.time), y(p.height)));
  ctx.lineTo(W - pad.right, H - pad.bottom);
  ctx.lineTo(pad.left, H - pad.bottom);
  ctx.closePath();
  ctx.fill();

  // Curve
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(14,165,233,0.4)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(x(points[0].time), y(points[0].height));
  points.forEach(p => ctx.lineTo(x(p.time), y(p.height)));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // High/Low dots
  if (tides) {
    ctx.textAlign = 'center';
    tides.forEach(t => {
      const tt = new Date(t.time);
      if (tt < winStart || tt > winEnd) return;
      const mx = x(tt),
        my = y(t.height),
        isHigh = t.type === 'high';
      ctx.fillStyle = isHigh ? '#38bdf8' : '#f97316';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, 2 * Math.PI);
      ctx.stroke();
      const lbl = ('0' + tt.getHours()).slice(-2) + ':' + ('0' + tt.getMinutes()).slice(-2) + ' ' + t.height + 'm';
      ctx.fillStyle = isHigh ? '#7dd3fc' : '#fb923c';
      ctx.font = 'bold 9px Outfit, sans-serif';
      ctx.fillText(lbl, mx, isHigh ? my - 12 : my + 16);
    });
    ctx.textAlign = 'start';
  }

  // Sunrise/sunset
  try {
    const sr = _state.weatherData?.daily?.sunrise?.[0],
      ss = _state.weatherData?.daily?.sunset?.[0];
    [sr, ss].forEach((tm, idx) => {
      if (!tm) return;
      const d = new Date(tm);
      if (d < winStart || d > winEnd) return;
      const sx = x(d);
      ctx.strokeStyle = 'rgba(251,191,36,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, pad.top);
      ctx.lineTo(sx, H - pad.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '12px sans-serif';
      ctx.fillText(idx === 0 ? '↑' : '↓', sx - 5, pad.top + 16);
    });
  } catch (e) {
    void e;
  }

  // NOW line
  const now = new Date();
  if (now >= winStart && now <= winEnd) {
    const nx = x(now);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(nx, pad.top);
    ctx.lineTo(nx, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Outfit, sans-serif';
    ctx.fillText('NOW', nx + 2, pad.top + 10);
  }

  // Legend
  const lx = W - pad.right - 8;
  ctx.font = '9px Outfit, sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('● High', lx - 50, pad.top + 10);
  ctx.fillStyle = '#f97316';
  ctx.fillText('● Low', lx - 50, pad.top + 22);
  let wind = 0;
  try {
    wind = _state.weatherData?.current?.windSpeed || 0;
  } catch (e) {
    void e;
  }
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('💨 ' + wind + ' km/h', lx - 50, pad.top + 34);

  if (_chartState.offsetDays > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px sans-serif';
    ctx.fillText('◀', pad.left, pad.top - 4);
  }
  if (_chartState.offsetDays < maxOffset) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px sans-serif';
    ctx.fillText('▶', W - pad.right - 14, pad.top - 4);
  }
}

function setupTideChartDrag() {
  const canvas = document.getElementById('tide-chart-canvas');
  if (!canvas) return;
  _chartState.offsetDays = 0;
  canvas.style.cursor = 'grab';
  const redraw = () => drawTideChart(_chartLat, _chartLon, _chartTides);

  canvas.onmousedown = e => {
    _chartState.dragging = true;
    _chartState.dragStartX = e.clientX;
    _chartState.dragStartOffset = _chartState.offsetDays;
  };
  canvas.onmousemove = e => {
    if (!_chartState.dragging) return;
    _chartState.offsetDays = _chartState.dragStartOffset - (e.clientX - _chartState.dragStartX) / canvas.clientWidth;
  };
  canvas.onmouseup = () => {
    _chartState.dragging = false;
    redraw();
  };
  canvas.onmouseleave = () => {
    if (_chartState.dragging) {
      _chartState.dragging = false;
      redraw();
    }
  };
  canvas.ontouchstart = e => {
    _chartState.dragging = true;
    _chartState.dragStartX = e.touches[0].clientX;
    _chartState.dragStartOffset = _chartState.offsetDays;
  };
  canvas.ontouchmove = e => {
    if (!_chartState.dragging) return;
    _chartState.offsetDays =
      _chartState.dragStartOffset - (e.touches[0].clientX - _chartState.dragStartX) / canvas.clientWidth;
  };
  canvas.ontouchend = () => {
    _chartState.dragging = false;
    redraw();
  };
}

function _setChartParams(lat, lon, tides) {
  _chartLat = lat;
  _chartLon = lon;
  _chartTides = tides;
}

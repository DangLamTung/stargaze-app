/**
 * AppRender — UI rendering functions for StarGaze.
 * All functions receive state and DOM helper as parameters.
 */

import { getScoreGradient } from '../core/stargazing-score.js';
import { getCurrentConditions, getWeatherDescription } from '../core/weather-service.js';
import { getNowScore, getTrendIcon, getTrendLabel } from '../core/sky-condition-now.js';
import { createAllCharts } from './chart-service.js';
import { setLocation, invalidateSize } from './map-service.js';
import { initSkyMap, getStellariumUrl, setSkyContext } from './sky-map.js';

export function renderLocationInfo(state, $) {
  const loc = state.location,
    w = state.weatherData;
  const cur = getCurrentConditions(w);
  if (!cur) return;
  const wx = getWeatherDescription(cur.weatherCode, cur.isDay === 0);

  $('loc-name').textContent = loc.name;
  $('loc-country').textContent = [loc.admin1, loc.country].filter(Boolean).join(', ');
  $('loc-coords').textContent = `${loc.latitude.toFixed(3)}°, ${loc.longitude.toFixed(3)}°`;
  $('current-temp').textContent = `${Math.round(cur.temperature)}°C`;
  $('current-weather-icon').textContent = wx.icon;
  $('current-weather-desc').textContent = wx.description;
  $('current-cloud').textContent = cur.cloudCover != null ? `${cur.cloudCover}%` : '--';
  $('current-humidity').textContent = `${cur.humidity}%`;
  $('current-visibility').textContent = `${(cur.visibility / 1000).toFixed(0)}km`;
  $('current-wind').textContent = `${cur.windSpeed} km/h`;
}

export function renderNowScore(state, $) {
  if (!state.weatherData) return;

  const nowData = getNowScore(state.weatherData, state.bortleClass);
  if (!nowData) return;

  const g = getScoreGradient(nowData.score);
  const circ = 2 * Math.PI * 45;
  const off = circ * (1 - nowData.score / 100);

  const section = $('now-score-section');
  if (!section) return;

  $('now-score-value').textContent = nowData.score;
  $('now-score-value').style.color = nowData.ratingColor;
  $('now-score-rating').textContent = nowData.rating;
  $('now-score-rating').style.color = nowData.ratingColor;
  $('now-cloud-pct').textContent = nowData.cloudCover != null ? `${nowData.cloudCover}%` : '--';
  $('now-humidity').textContent = nowData.humidity != null ? `${nowData.humidity}%` : '--';
  $('now-visibility').textContent = nowData.visibility != null ? `${(nowData.visibility / 1000).toFixed(0)}km` : '--';
  $('now-wind').textContent = nowData.windSpeed != null ? `${nowData.windSpeed} km/h` : '--';

  const gaugeFill = section.querySelector('.now-gauge-fill');
  if (gaugeFill) {
    gaugeFill.style.strokeDasharray = circ;
    gaugeFill.style.strokeDashoffset = off;
    gaugeFill.style.stroke = g[0];
  }

  const trend = nowData.trend;
  $('now-trend-icon').textContent = getTrendIcon(trend.trend);
  $('now-trend-label').textContent = getTrendLabel(trend.trend);
  $('now-trend-confidence').style.width = `${trend.confidence}%`;

  const predContainer = $('now-predicted-hours');
  if (predContainer && trend.predicted) {
    predContainer.innerHTML = trend.predicted
      .map(p => {
        const predColor =
          p.cloudCover <= 20
            ? '#00e676'
            : p.cloudCover <= 40
              ? '#76ff03'
              : p.cloudCover <= 60
                ? '#ffea00'
                : p.cloudCover <= 80
                  ? '#ff9800'
                  : '#f44336';
        return `<div class="now-pred-item">
          <span class="now-pred-label">+${p.hoursAhead}h</span>
          <span class="now-pred-cloud" style="color:${predColor}">☁️ ${p.cloudCover}%</span>
        </div>`;
      })
      .join('');
  }

  // Source consensus
  const allSources = state.weatherData?.current?.allCloudSources;
  const consensusEl = $('now-consensus');
  if (consensusEl && allSources) {
    const labels = {
      satellite: '🛰️ Sat',
      metar: '🛫 METAR',
      weatherapi: '📡 WAPI',
      owm: '📡 OWM',
      wttr: '🌐 wttr',
      metno: '🇳🇴 Met',
      'open-meteo': '🌍 OM',
    };
    consensusEl.innerHTML = Object.entries(allSources)
      .sort(([, a], [, b]) => a - b)
      .map(([key, pct]) => {
        const color =
          pct <= 20 ? '#00e676' : pct <= 40 ? '#76ff03' : pct <= 60 ? '#ffea00' : pct <= 80 ? '#ff9800' : '#f44336';
        const name = labels[key] || key;
        return `<div class="now-consensus-row" title="${key}: ${pct}%">
          <span class="now-consensus-label">${name}</span>
          <span class="now-consensus-bar-track"><span class="now-consensus-bar" style="width:${Math.max(2, pct)}%;background:${color}"></span></span>
          <span class="now-consensus-pct" style="color:${color}">${pct}%</span>
        </div>`;
      })
      .join('');
  }

  $('now-updated-time').textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function renderStargazingCards(state, $) {
  const container = $('score-cards');
  const best = state.bestNight;
  if (!state.scores.length) {
    container.innerHTML = '<p class="no-data">No forecast data</p>';
    return;
  }

  if (best) {
    const d = new Date(best.date);
    $('best-night-date').textContent = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    $('best-night-score').textContent = best.score;
    $('best-night-rating').textContent = best.rating;
    $('best-night-rating').style.color = best.ratingColor;
    $('best-night-moon').textContent = `${best.moonPhaseIcon} ${best.moonPhaseName}`;
    $('best-night-cloud').textContent =
      best.avgCloudCover != null ? `${best.avgCloudCover}% cloud cover` : 'Cloud cover unavailable';
    const bt = best.bestViewingTime
      ? new Date(best.bestViewingTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : 'After sunset';
    $('best-night-time').textContent = `Best time: ${bt}`;
  }

  container.innerHTML = state.scores
    .map((n, i) => {
      const isBest = best && n.date === best.date;
      const isToday = n.date === new Date().toISOString().split('T')[0];
      const g = getScoreGradient(n.score);
      const circ = 2 * Math.PI * 40,
        off = circ * (1 - n.score / 100);
      return `<div class="score-card ${isBest ? 'best-night' : ''} ${isToday ? 'today' : ''}" data-index="${i}">
        <div class="badges-container">${isBest ? '<div class="best-badge">✨ BEST</div>' : ''}${isToday ? '<div class="today-badge">Tonight</div>' : ''}</div>
        <div class="score-card-date"><span class="score-day">${n.dayOfWeek}</span><span class="score-date-num">${n.dayOfMonth}</span><span class="score-month">${n.month}</span></div>
        <div class="score-gauge"><svg viewBox="0 0 100 100" class="gauge-svg"><circle cx="50" cy="50" r="40" class="gauge-bg"/><circle cx="50" cy="50" r="40" class="gauge-fill" style="stroke-dasharray:${circ};stroke-dashoffset:${off};stroke:${g[0]}"/></svg><div class="score-value" style="color:${g[0]}">${n.score}</div><div class="score-label">${n.rating}</div></div>
        <div class="score-moon">${n.moonPhaseIcon} ${n.moonPhaseName}</div>
        <div class="score-metrics"><div class="metric"><span class="metric-icon">☁️</span><span class="metric-value">${n.avgCloudCover != null ? `${n.avgCloudCover}%` : '--'}</span></div><div class="metric"><span class="metric-icon">💧</span><span class="metric-value">${n.avgHumidity}%</span></div><div class="metric"><span class="metric-icon">👁️</span><span class="metric-value">${(n.avgVisibility / 1000).toFixed(0)}km</span></div><div class="metric"><span class="metric-icon">🌧️</span><span class="metric-value">${n.avgPrecipProb}%</span></div></div>
        <div class="score-card-actions"><button class="btn-remind" onclick="window.openReminder(${i})">🔔 Remind</button><button class="btn-calendar" onclick="window.addToCalendar(${i})">📅 Calendar</button></div>
      </div>`;
    })
    .join('');
}

export function renderCharts(state) {
  if (state.weatherData) createAllCharts(state.weatherData.hourly);
}

export function handleChartTab(e) {
  const target = e.currentTarget.dataset.chart;
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  e.currentTarget.classList.add('active');
  document.querySelectorAll('.chart-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${target}`));
}

export function updateMapView(state) {
  const loc = state.location;
  setLocation(loc.latitude, loc.longitude, `${loc.name}, ${loc.country}`);
  invalidateSize();
}

export async function initSkyMapView(state) {
  const loc = state.location;
  setSkyContext({ latitude: loc.latitude, longitude: loc.longitude, date: null });
  await initSkyMap('panel-sky', loc.latitude, loc.longitude, null);
}

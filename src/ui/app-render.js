/**
 * AppRender — UI rendering functions for StarGaze.
 * All functions receive state and DOM helper as parameters.
 */

import { getScoreGradient } from '../core/stargazing-score.js';
import { getCurrentConditions, getWeatherDescription } from '../core/weather-service.js';
import { getNowScore, getTrendIcon, getTrendLabel } from '../core/sky-condition-now.js';
import { createAllCharts } from './chart-service.js';
import { setLocation, invalidateSize } from './map-service.js';
import { initSkyMap, setSkyContext } from './sky-map.js?v=33';

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
  var vis = cur.visibility;
  $('current-visibility').textContent = vis != null && !isNaN(vis) ? `${(vis / 1000).toFixed(0)}km` : '--';
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
  $('now-cloud-pct').title = _cloudAnalysisFromNow(nowData);
  // Cloud base from METAR (if available)
  var cloudBaseEl = document.getElementById('now-cloud-base');
  if (cloudBaseEl) {
    var cbf = nowData.cloudBaseFt || state.weatherData?.current?.cloudBaseFt;
    if (cbf) {
      var m = Math.round(cbf * 0.3048);
      cloudBaseEl.textContent = m + 'm base';
      cloudBaseEl.style.display = '';
    } else {
      cloudBaseEl.style.display = 'none';
    }
  }
  $('now-humidity').textContent = nowData.humidity != null ? `${nowData.humidity}%` : '--';
  var nowVis = nowData.visibility;
  $('now-visibility').textContent = nowVis != null && !isNaN(nowVis) ? `${(nowVis / 1000).toFixed(0)}km` : '--';
  $('now-wind').textContent = nowData.windSpeed != null ? `${nowData.windSpeed} km/h` : '--';

  // Moon illumination
  var moonPhase = 0;
  if (state.scores && state.scores.length > 0) moonPhase = state.scores[0].moonPhase || 0;
  var moonIllum = Math.round(50 * (1 - Math.cos(2 * Math.PI * moonPhase)));
  $('now-moon-pct').textContent = moonIllum + '%';
  $('now-moon-icon').textContent = moonIllum > 80 ? '🌕' : moonIllum > 50 ? '🌔' : moonIllum > 20 ? '🌒' : '🌑';

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

  // Show 12 hours of actual forecast in the hourly strip
  var stripEl = $('hourly-strip-items');
  if (stripEl && state.weatherData?.hourly) {
    var nowTs = Date.now();
    // Take the next 12 hours from the forecast data, starting from now
    var next12 = state.weatherData.hourly
      .filter(function (h) {
        return new Date(h.time).getTime() > nowTs - 3600000;
      })
      .slice(0, 12);
    if (next12.length > 0) {
      stripEl.innerHTML = next12
        .map(function (p) {
          var pTime = new Date(p.time);
          var hourLabel = pTime.getHours() + ':00';
          var wx = getWeatherDescription(p.weatherCode, !p.isDay);
          var label = wx ? wx.description : '--';
          var rainPct = p.precipProbability != null ? Math.round(p.precipProbability) : null;
          return (
            '<div class="hourly-item">' +
            '<span class="hourly-time">' +
            hourLabel +
            '</span>' +
            '<span class="hourly-desc">' +
            label +
            '</span>' +
            '<span class="hourly-temp">' +
            Math.round(p.temperature) +
            '°</span>' +
            (rainPct != null
              ? '<span class="hourly-rain">💧' + rainPct + '%</span>'
              : '<span class="hourly-rain">--</span>') +
            '</div>'
          );
        })
        .join('');
    }
  }

  // Predicted next 3 hours with scores
  var predEl = $('now-predicted-hours');
  if (predEl && trend.predicted && trend.predicted.length > 0) {
    predEl.innerHTML = trend.predicted
      .map(function (p) {
        var scoring = p.score != null && !isNaN(p.score) ? p.score : '--';
        var scoreColor =
          p.score >= 80
            ? '#00e676'
            : p.score >= 60
              ? '#76ff03'
              : p.score >= 40
                ? '#ffea00'
                : p.score >= 20
                  ? '#ff9800'
                  : '#f44336';
        var cloudVal = p.cloudCover != null ? p.cloudCover + '%' : '--';
        return (
          '<div class="now-pred-item">' +
          '<span class="now-pred-label">+' +
          p.hoursAhead +
          'h</span>' +
          '<span class="now-pred-score" style="color:' +
          scoreColor +
          '">' +
          scoring +
          '</span>' +
          '<span class="now-pred-detail">☁️' +
          cloudVal +
          '</span>' +
          '</div>'
        );
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
      accuweather: '🌩️ Accu',
      weatherapi: '📡 WAPI',
      owm: '📡 OWM',
      wttr: '🌐 wttr',
      metno: '🇳🇴 Met',
      'open-meteo': '🌍 OM',
    };
    const priorityMap = { accuweather: 0, 'open-meteo': 1 };
    consensusEl.innerHTML = Object.entries(allSources)
      .sort(([keyA, a], [keyB, b]) => {
        const pA = priorityMap[keyA] ?? 99;
        const pB = priorityMap[keyB] ?? 99;
        if (pA !== pB) return pA - pB;
        return a - b;
      })
      .map(([key, pct]) => {
        const color =
          pct <= 20 ? '#00e676' : pct <= 40 ? '#76ff03' : pct <= 60 ? '#ffea00' : pct <= 80 ? '#ff9800' : '#f44336';
        const name = labels[key] || key;
        return `<div class="now-consensus-row" title="${key}: ${pct}%">
          <span class="now-consensus-label">${name}</span>
          <span class="now-consensus-bar-track"><span class="now-consensus-bar" style="width:${Math.max(4, pct)}%;background:${color}"></span></span>
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

  // DSO / Milky Way recommendation
  var recEl = $('now-recommendation');
  if (recEl) {
    var lo = nowData.cloudCoverLow,
      mi = nowData.cloudCoverMid,
      hi = nowData.cloudCoverHigh;
    var pm25 = nowData.pm25;
    var bortle = state.bortleClass || 5;
    var parts = [];

    // Bortle / City Sky description
    if (bortle <= 3) parts.push('🟢 Bortle ' + bortle + ' — dark skies, ideal for Milky Way & DSOs');
    else if (bortle <= 5) parts.push('🟡 Bortle ' + bortle + ' — decent for bright DSOs (clusters, Andromeda)');
    else parts.push('🌆 City Sky — high light pollution; best for planets, Moon & bright stars');

    // PM2.5
    if (pm25 != null) {
      if (pm25 <= 12) parts.push('🌬 PM2.5 ' + pm25 + 'μg — clean air, great transparency');
      else if (pm25 <= 35) parts.push('🌁 PM2.5 ' + pm25 + 'μg — slight haze, Milky Way still visible');
      else if (pm25 <= 55) parts.push('🌫 PM2.5 ' + pm25 + 'μg — hazy, DSO contrast reduced');
      else parts.push('💨 PM2.5 ' + pm25 + 'μg — heavy haze, avoid deep-sky');
    }

    // Cloud layers for Milky Way
    if (hi != null && hi > 40 && (lo || 0) < 20) {
      parts.push('☁️ High cirrus ' + hi + '% — invisible killer for Milky Way contrast');
    } else if (lo != null && lo > 40) {
      parts.push('⚠ Low clouds ' + lo + '% — may block viewing entirely');
    } else if ((lo || 0) < 15 && (mi || 0) < 15 && (hi || 0) < 20) {
      parts.push('✅ Crystal-clear sky profile');
    }

    // Milky Way viability
    if (bortle <= 4 && (pm25 == null || pm25 <= 25) && (hi == null || hi <= 30) && (lo == null || lo <= 20)) {
      parts.push('🌌 Milky Way should be visible tonight');
    } else if (bortle <= 5 && (pm25 == null || pm25 <= 35)) {
      parts.push('🔭 Milky Way may be faint but detectable');
    } else if (bortle > 5 || (pm25 != null && pm25 > 55) || (hi != null && hi > 60)) {
      parts.push('🌃 Milky Way unlikely — try bright objects instead');
    }

    if (nowData.score >= 80) parts.push('⭐ Excellent conditions — grab your gear!');
    else if (nowData.score >= 60) parts.push('👍 Good conditions — worth setting up');
    else if (nowData.score >= 40) parts.push('🤞 Marginal — check for clearing later');
    else parts.push('😔 Poor conditions — check the 7-day forecast');

    recEl.innerHTML = parts.join(' · ');
  }
}

export function renderStargazingCards(state, $) {
  const container = $('score-cards');
  const best = state.bestNight;
  if (!state.scores || !state.scores.length) {
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
      best.avgCloudCover != null
        ? `${best.avgCloudCover}% cover · L:${_fmtPct(best.avgCloudCoverLow)} M:${_fmtPct(best.avgCloudCoverMid)} H:${_fmtPct(best.avgCloudCoverHigh)}`
        : 'Cloud cover unavailable';
    $('best-night-cloud').title = _cloudAnalysis(best);
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
        <div class="score-metrics"><div class="metric"><span class="metric-icon">☁️</span><span class="metric-value">${n.avgCloudCover != null ? `${n.avgCloudCover}%` : '--'}</span></div><div class="metric"><span class="metric-icon">💧</span><span class="metric-value">${n.avgHumidity}%</span></div><div class="metric"><span class="metric-icon">👁️</span><span class="metric-value">${n.avgVisibility != null && !isNaN(n.avgVisibility) ? (n.avgVisibility / 1000).toFixed(0) + 'km' : '--'}</span></div><div class="metric"><span class="metric-icon">�️</span><span class="metric-value">${n.avgPM25 != null ? n.avgPM25 + 'μg' : '--'}</span></div></div>
        <div class="cloud-layers" style="display:flex;gap:6px;justify-content:center;font-size:9px;color:#94a3b8;padding:2px 0">${_cloudLayerBadge('L', n.avgCloudCoverLow)}${_cloudLayerBadge('M', n.avgCloudCoverMid)}${_cloudLayerBadge('H', n.avgCloudCoverHigh)}</div>
        <div class="score-card-actions"><button class="btn-remind" onclick="window.openReminder(${i})">🔔 Remind</button><button class="btn-calendar" onclick="window.addToCalendar(${i})">📅 Calendar</button></div>
      </div>`;
    })
    .join('');
}

function _cloudAnalysisFromNow(now) {
  var parts = [];
  var lo = now.cloudCoverLow,
    mi = now.cloudCoverMid,
    hi = now.cloudCoverHigh;
  if (lo != null && lo > 40) parts.push('⚠ Low clouds (' + lo + '%) block most starlight');
  else if (lo != null && lo > 20) parts.push('⚡ Low clouds (' + lo + '%) — may thin out');
  if (mi != null && mi > 50) parts.push('Mid-level clouds (' + mi + '%)');
  if (hi != null && hi > 40 && (lo || 0) < 20) parts.push('💡 High cirrus (' + hi + '%) — visible through haze');
  if (!parts.length) parts.push('✅ Clear profile');
  return parts.join(' · ');
}

function _cloudLayerBadge(label, pct) {
  if (pct == null) return '<span style="color:#475569">' + label + ':?</span>';
  var color = pct > 60 ? '#ef4444' : pct > 30 ? '#f59e0b' : '#22c55e';
  return '<span style="color:' + color + '">' + label + ':' + Math.round(pct) + '%</span>';
}

function _fmtPct(v) {
  return v != null ? Math.round(v) + '%' : '?';
}

function _cloudAnalysis(n) {
  var parts = [];
  if (n.avgCloudCoverLow > 40) parts.push('⚠ Low clouds block most starlight — worst for stargazing');
  else if (n.avgCloudCoverLow > 20) parts.push('⚡ Low clouds moderate — may clear');
  if (n.avgCloudCoverMid > 50) parts.push('Mid-level clouds present');
  if (n.avgCloudCoverHigh > 40 && (n.avgCloudCoverLow || 0) < 20)
    parts.push('💡 Thin high cirrus — stars visible through haze');
  if (!parts.length) parts.push('✅ Favorable cloud profile');
  return parts.join(' · ');
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
  // Pass actual sunrise/sunset from forecast
  const todayStr = new Date().toISOString().split('T')[0];
  const todayDay = state.weatherData?.daily?.find(d => d.date === todayStr);
  setSkyContext({
    latitude: loc.latitude,
    longitude: loc.longitude,
    date: null,
    sunrise: todayDay?.sunrise || null,
    sunset: todayDay?.sunset || null,
  });
  await initSkyMap('sky-map-container', loc.latitude, loc.longitude, null);
}

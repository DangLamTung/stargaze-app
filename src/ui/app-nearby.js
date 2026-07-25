/**
 * AppNearby — nearby search + map layer controls for StarGaze.
 */

import { searchNearbyPlaces, getBatchWeatherData, rankBestLocations } from '../core/nearby-best-service.js';
import { batchEstimateBortle } from '../core/bortle-service.js';
import { showToast } from './toast.js';
import { getMap, setLightPollutionLayer, renderNearbyMarkers } from './map-service.js';
import { setWeatherLayer, startCloudAnimation, stopCloudAnimation, setCloudOpacity } from './cloud-layer.js';
import { getScoreGradient } from '../core/stargazing-score.js';

export async function handleFindNearby(state, $, applyFiltersFn) {
  const loc = state.location;
  if (!loc) return;

  const radius = parseInt($('nearby-radius').value, 10) || 100;
  const maxResults = parseInt($('nearby-max-results')?.value, 10) || 20;

  // Country filter: prefer ISO code (e.g. "VN") over full name (e.g. "Vietnam")
  const sameCountry = $('nearby-same-country')?.checked ?? true;
  const country = sameCountry ? loc.countryCode || loc.country || null : null;

  // Update hint text
  const hint = $('nearby-country-hint');
  if (hint && sameCountry && loc.country) {
    hint.textContent = `(${loc.country})`;
  } else if (hint) {
    hint.textContent = '';
  }

  const loadingEl = $('nearby-loading');
  const resultsEl = $('nearby-results');
  const filtersEl = $('nearby-filters');
  const countEl = $('nearby-filter-count');
  const btn = $('btn-find-nearby');

  loadingEl.classList.remove('hidden');
  loadingEl.innerHTML =
    '<div class="spinner"></div><p>Step 1/4: Finding nearby locations...</p><p style="font-size:0.75rem;color:#aaa">This can take 2-3 minutes for large areas</p>';
  resultsEl.classList.add('hidden');
  filtersEl?.classList.add('hidden');
  countEl?.classList.add('hidden');
  if (btn) btn.disabled = true;

  try {
    const places = await searchNearbyPlaces(loc.latitude, loc.longitude, radius, country);
    if (!places.length) {
      resultsEl.innerHTML = '<p class="no-data">No nearby towns found</p>';
      resultsEl.classList.remove('hidden');
      return;
    }

    loadingEl.innerHTML = `<div class="spinner"></div><p>Step 2/4: Found ${places.length} locations. Sampling...</p>`;

    let topPlaces = [];
    if (places.length <= maxResults) {
      topPlaces = places;
    } else {
      const step = places.length / maxResults;
      for (let i = 0; i < maxResults; i++) topPlaces.push(places[Math.floor(i * step)]);
    }

    loadingEl.innerHTML = '<div class="spinner"></div><p>Step 3/4: Fetching weather...</p>';
    const weatherDataArray = await getBatchWeatherData(topPlaces, loc.timezone || 'auto', (batchNum, total) => {
      loadingEl.innerHTML = `<div class="spinner"></div><p>Step 3/4: Weather batch ${batchNum}/${total}...</p>`;
    });
    const validWeather = weatherDataArray.filter(Boolean).length;
    console.log('Nearby: weather done, valid:', validWeather, '/', weatherDataArray.length);
    if (validWeather === 0) {
      loadingEl.innerHTML = '<p class="no-data">⚠️ Weather service unavailable. Try again later.</p>';
      if (btn) btn.disabled = false;
      return;
    }

    loadingEl.innerHTML = `<p style="font-weight:600;">Step 4/4: Analyzing light pollution (${topPlaces.length} locations)...</p>
      <div style="width:100%;background:rgba(255,255,255,0.1);border-radius:4px;height:8px;overflow:hidden;">
        <div id="nearby-bortle-bar" style="height:100%;width:100%;background:var(--primary);transition:width 0.3s;"></div>
      </div>
      <p id="nearby-bortle-count" style="font-size:0.8rem;color:#aaa;margin-top:0.3rem;">Fetching...</p>`;

    const bortles = await batchEstimateBortle(topPlaces);
    const bar = document.getElementById('nearby-bortle-bar');
    const cnt = document.getElementById('nearby-bortle-count');
    if (bar) bar.style.width = '100%';
    if (cnt) cnt.textContent = `${topPlaces.length} / ${topPlaces.length}`;

    topPlaces.forEach((p, i) => (p.bortle = bortles[i]));

    const ranked = rankBestLocations(topPlaces, weatherDataArray);
    console.log('Nearby: ranked', ranked.length, 'results');
    if (ranked.length === 0) {
      loadingEl.innerHTML = '<p class="no-data">⚠️ No scored results. Weather data may be incomplete.</p>';
      resultsEl.classList.remove('hidden');
      if (btn) btn.disabled = false;
      return;
    }
    window._nearbyRawData = ranked;
    if (applyFiltersFn) applyFiltersFn();
    filtersEl?.classList.remove('hidden');
    countEl?.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    showToast(`Failed to search nearby: ${err.message}`, 'error');
  } finally {
    loadingEl.classList.add('hidden');
    if (btn) btn.disabled = false;
  }
}

export function applyNearbyFilters() {
  const data = window._nearbyRawData;
  if (!data || !data.length) return;

  const $ = id => document.getElementById(id);
  const dayFilterBest = $('filter-day-best')?.checked;
  const dayStart = $('filter-day-start')?.value;
  const dayEnd = $('filter-day-end')?.value;
  const bortleMax = parseInt($('filter-bortle')?.value || '9', 10);
  const cloudsMax = parseInt($('filter-clouds')?.value || '100', 10);
  const sortMode = $('filter-sort')?.value || 'score';

  let filtered = data.filter(r => {
    if (r.place.bortle > bortleMax) return false;
    let nightToEvaluate = r.bestNight;
    if (!dayFilterBest && (dayStart || dayEnd)) {
      const validNights = r.scores.filter(s => {
        const d = new Date(s.date).toISOString().split('T')[0];
        if (dayStart && d < dayStart) return false;
        if (dayEnd && d > dayEnd) return false;
        if (s.avgCloudCover > cloudsMax) return false;
        return true;
      });
      if (validNights.length === 0) return false;
      nightToEvaluate = validNights.reduce(
        (best, curr) => (curr.finalScore > best.finalScore ? curr : best),
        validNights[0],
      );
      r.displayNight = nightToEvaluate;
    } else {
      if (nightToEvaluate.avgCloudCover > cloudsMax) return false;
      r.displayNight = nightToEvaluate;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const na = a.displayNight,
      nb = b.displayNight;
    if (sortMode === 'clouds') return na.avgCloudCover - nb.avgCloudCover;
    if (sortMode === 'bortle') return a.place.bortle - b.place.bortle;
    if (sortMode === 'distance') return a.place.distance - b.place.distance;
    return nb.finalScore - na.finalScore;
  });

  window._nearbySpots = filtered;
  renderNearbyMarkers(filtered);

  const resultsEl = $('nearby-results');
  const countEl = $('nearby-filter-count');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${data.length} locations.`;
  if (!filtered.length) {
    resultsEl.innerHTML = '<p class="no-data">No suitable conditions found for these filters.</p>';
    resultsEl.classList.remove('hidden');
    return;
  }

  resultsEl.innerHTML = filtered
    .map((r, i) => {
      const an = r.displayNight;
      const g = getScoreGradient(an.score);
      const circ = 2 * Math.PI * 25,
        off = circ * (1 - an.score / 100);
      let bColor = 'white';
      if (r.place.bortle <= 3) bColor = '#4caf50';
      else if (r.place.bortle <= 5) bColor = '#ff9800';
      else bColor = '#f44336';
      const dateStr = new Date(an.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      return `<div class="nearby-spot-card" onclick="window.selectNearbySpot(${i})">
      <div class="nearby-spot-name">${r.place.name}${r.place.id === 'current' ? ' (Here)' : ''}</div>
      <div class="nearby-spot-distance">${r.place.distance < 1 ? '0km' : r.place.distance.toFixed(0) + 'km'}</div>
      <div class="nearby-spot-bortle" style="color:${bColor}">B${r.place.bortle}</div>
      <div class="nearby-spot-gauge"><svg viewBox="0 0 60 60" class="gauge-svg"><circle cx="30" cy="30" r="25" class="gauge-bg"/><circle cx="30" cy="30" r="25" class="gauge-fill" style="stroke-dasharray:${circ};stroke-dashoffset:${off};stroke:${g[0]}"/></svg><div class="score-value" style="color:${g[0]}">${an.score}</div><div class="score-label">${an.rating || ''}</div></div>
      <div class="nearby-spot-meta"><span>☁️${an.avgCloudCover}%</span><span>${dateStr}</span></div>
    </div>`;
    })
    .join('');
  resultsEl.classList.remove('hidden');
}

window.selectNearbySpot = function (index) {
  const spot = window._nearbySpots[index];
  if (!spot) return;
  const loc = {
    name: spot.place.name,
    country: '',
    admin1: '',
    latitude: spot.place.latitude,
    longitude: spot.place.longitude,
    timezone: 'auto',
  };
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window._selectLocation) window._selectLocation(loc);
};

// ─── Map Layer Controls ───

export function handleWeatherLayerChange(e, cloudAnimating, setCloudAnimating) {
  const $ = id => document.getElementById(id);
  const map = getMap();
  if (!map) return;
  const type = e.target.value;
  setWeatherLayer(map, type);

  $('nasa-date-control')?.classList.toggle('hidden', type !== 'nasa');
  $('animation-controls')?.classList.toggle('hidden', type !== 'satellite' && type !== 'radar');

  if (type === 'satellite' || type === 'radar') {
    if (cloudAnimating) {
      stopCloudAnimation();
      setCloudAnimating(false);
    }
    import('./cloud-layer.js').then(m => {
      const count = m.getCloudFramesCount();
      if (count > 0) {
        const slider = $('cloud-time-slider');
        if (slider) {
          slider.max = count - 1;
          slider.value = count - 1;
        }
        const time = m.setCloudFrame(count - 1);
        if (time) {
          const label = $('cloud-time-label');
          if (label)
            label.textContent = time.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
        }
      }
    });
  } else {
    stopCloudAnimation();
    setCloudAnimating(false);
    const btn = $('cloud-animate');
    if (btn) btn.textContent = '▶ Play';
  }
}

export function handleLpLayerChange(e) {
  const $ = id => document.getElementById(id);
  const val = e.target.value;
  setLightPollutionLayer(val);
  $('lp-controls')?.classList.toggle('hidden', val === 'none');
}

export function handleCloudAnimate(cloudAnimating, setCloudAnimating) {
  const $ = id => document.getElementById(id);
  const map = getMap();
  if (!map) return;
  const newState = !cloudAnimating;
  setCloudAnimating(newState);
  const btn = $('cloud-animate');
  if (newState) {
    import('./cloud-layer.js').then(({ startCloudAnimation: start, getCloudFramesCount }) => {
      const count = getCloudFramesCount();
      if (count) {
        const s = $('cloud-time-slider');
        if (s) s.max = count - 1;
      }
      start((time, pos) => {
        const label = $('cloud-time-label');
        if (label)
          label.textContent = time.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        const slider = $('cloud-time-slider');
        if (slider) slider.value = pos;
      });
    });
    if (btn) {
      btn.textContent = '⏸ Stop';
      btn.classList.add('active');
    }
  } else {
    import('./cloud-layer.js').then(m => m.stopCloudAnimation());
    if (btn) {
      btn.textContent = '▶️ Play';
      btn.classList.remove('active');
    }
  }
}

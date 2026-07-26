/**
 * AppRecommend — Best Places Right Now recommendation panel.
 * Loads into existing nearby results containers.
 */

import { getBatchWeatherData, rankBestLocations } from '../core/nearby-best-service.js';
import { batchEstimateBortle } from '../core/bortle-service.js';

export async function loadRecommendationsInto(resultsSelector, loadingSelector, selectCallback) {
  var resultsEl = typeof resultsSelector === 'string' ? document.querySelector(resultsSelector) : resultsSelector;
  var loadingEl = typeof loadingSelector === 'string' ? document.querySelector(loadingSelector) : loadingSelector;
  if (!resultsEl) return;

  try {
    var resp = await fetch('/api/famous-spots');
    if (!resp.ok) throw new Error('Failed');
    var spots = await resp.json();
    if (!spots || !spots.length) {
      if (loadingEl) loadingEl.classList.add('hidden');
      resultsEl.innerHTML = '<p class="no-data">No recommendations available</p>';
      resultsEl.classList.remove('hidden');
      return;
    }

    if (loadingEl)
      loadingEl.innerHTML = '<div class="spinner"></div><p>Scoring ' + spots.length + ' famous places...</p>';

    var weatherData = await getBatchWeatherData(spots, 'auto');
    var missingSpots = spots.filter(function (s) {
      return s.bortle == null;
    });
    if (missingSpots.length > 0) {
      var bortles = await batchEstimateBortle(missingSpots);
      missingSpots.forEach(function (s, i) {
        s.bortle = bortles[i];
      });
    }

    var ranked = rankBestLocations(spots, weatherData);
    if (!ranked || !ranked.length) {
      if (loadingEl) loadingEl.classList.add('hidden');
      resultsEl.innerHTML = '<p class="no-data">Could not score locations</p>';
      resultsEl.classList.remove('hidden');
      return;
    }

    var top = ranked.slice(0, 10);
    window._nearbyRawData = top;
    resultsEl.innerHTML = top
      .map(function (r, i) {
        var icon = r.bestScore >= 80 ? '🌟' : r.bestScore >= 60 ? '⭐' : '✨';
        var typeIcon =
          r.place.type === 'beach'
            ? '🏖️'
            : r.place.type === 'mountain'
              ? '🏔️'
              : r.place.type === 'island'
                ? '🏝️'
                : r.place.type === 'heritage'
                  ? '🏛️'
                  : '📍';
        var dateStr = r.bestDate
          ? new Date(r.bestDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : '';
        return (
          '<div class="nearby-result" style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer" data-lat="' +
          r.place.latitude +
          '" data-lon="' +
          r.place.longitude +
          '" data-name="' +
          r.place.name +
          '" data-country="' +
          (r.place.country || '') +
          '">' +
          '<span style="font-size:1.4rem">' +
          typeIcon +
          '</span>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-size:0.9rem;font-weight:600;color:#e2e8f0">' +
          r.place.name +
          '</div>' +
          '<div style="font-size:0.75rem;color:#94a3b8">' +
          r.place.admin1 +
          ' · ' +
          dateStr +
          (r.place.bortle ? ' · B' + r.place.bortle : '') +
          '</div>' +
          '</div>' +
          '<span style="font-size:0.9rem;font-weight:700;color:#fbbf24">' +
          icon +
          ' ' +
          r.bestScore +
          '</span>' +
          '</div>'
        );
      })
      .join('');

    // Click handlers
    resultsEl.querySelectorAll('.nearby-result').forEach(function (el) {
      el.addEventListener('click', function () {
        selectCallback({
          latitude: parseFloat(el.dataset.lat),
          longitude: parseFloat(el.dataset.lon),
          name: el.dataset.name,
          country: el.dataset.country,
        });
      });
    });

    resultsEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.add('hidden');

    var filtersEl = document.getElementById('nearby-filters');
    var countEl = document.getElementById('nearby-filter-count');
    if (filtersEl) filtersEl.classList.remove('hidden');
    if (countEl) countEl.classList.remove('hidden');
  } catch (e) {
    console.warn('Recommendations failed:', e);
    if (loadingEl) loadingEl.classList.add('hidden');
    resultsEl.innerHTML = '<p class="no-data">Failed to load recommendations</p>';
    resultsEl.classList.remove('hidden');
  }
}

/**
 * StarGaze — Main Application
 * Orchestrates all services: weather, scoring, POIs, sky map, cloud map, reminders
 */

import {
  searchLocations,
  getWeatherData,
  getWeatherDescription,
  getCurrentConditions,
  reverseGeocode,
} from '../core/weather-service.js';
import { calculateAllScores, findBestNight, getScoreColor, getScoreGradient } from '../core/stargazing-score.js';
import { loadFavorites, getFavorites, toggleFavorite, isFavorite } from '../core/favorites-service.js';
import {
  createStargazingReminder,
  sendEmailReminder,
  requestNotificationPermission,
  showNotification,
} from '../core/reminder-service.js';
import {
  initMap,
  setLocation,
  invalidateSize,
  getMap,
  setLightPollutionLayer,
  renderNearbyMarkers,
  computeBearing,
  updateViewingBearing,
} from './map-service.js';
import { createAllCharts } from './chart-service.js';
import { initSkyMap, updateSkyMap, getStellariumUrl, setSkyContext } from './sky-map.js';
import {
  initCloudSatelliteLayer,
  setWeatherLayer,
  startCloudAnimation,
  stopCloudAnimation,
  setCloudOpacity,
} from './cloud-layer.js';
import { showToast } from './toast.js';
import { searchNearbyPlaces, getBatchWeatherData, rankBestLocations } from '../core/nearby-best-service.js';
import { estimateBortleClass } from '../core/bortle-service.js';
import { getNowScore, getTrendIcon, getTrendLabel } from '../core/sky-condition-now.js';
import {
  renderLocationInfo as _renderLocationInfo,
  renderNowScore as _renderNowScore,
  renderStargazingCards as _renderStargazingCards,
  renderCharts as _renderCharts,
  handleChartTab,
  updateMapView as _updateMapView,
  initSkyMapView as _initSkyMapView,
} from './app-render.js';
import {
  handleFindNearby as _handleFindNearby,
  applyNearbyFilters,
  handleWeatherLayerChange as _handleWeatherLayerChange,
  handleLpLayerChange as _handleLpLayerChange,
  handleCloudAnimate as _handleCloudAnimate,
} from './app-nearby.js';

// ─── State ───
const state = { location: null, weatherData: null, scores: null, bestNight: null, loading: false, bortleClass: 5 };
let refreshTimer = null;
let refreshIntervalMs = 5 * 60 * 1000; // default 5 min

function restartRefresh() {
  stopNowRefresh();
  startNowRefresh();
}

const $ = id => document.getElementById(id);
let cloudAnimating = false;

// Global Error & Promise Rejection Handlers for Debugging
window.addEventListener('error', event => {
  console.error('💥 [Global Error]', event.error || event.message);
  fetch('/?log_error=' + encodeURIComponent(event.message + ' | ' + (event.error ? event.error.stack : '')));
  if (typeof showToast === 'function') {
    showToast(`Client Error: ${event.message}`, 'error');
  }
});

window.addEventListener('unhandledrejection', event => {
  console.error('💥 [Unhandled Rejection]', event.reason);
  fetch(
    '/?log_rejection=' +
      encodeURIComponent(event.reason && event.reason.message ? event.reason.message : String(event.reason)),
  );
  if (typeof showToast === 'function') {
    showToast(`Promise Rejection: ${event.reason?.message || event.reason}`, 'error');
  }
});

// ─── Debounce ───
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Sync map bearing to Stellarium
function updateStellariumBearing(bearing) {
  import('./sky-map.js').then(m => m.setSkyBearing(bearing));
  const link = document.getElementById('stellarium-link');
  if (link && state.location) {
    import('./sky-map.js').then(m => {
      link.href = m.getStellariumUrl(state.location.latitude, state.location.longitude, bearing);
    });
  }
}

// ─── Favorites ───
window.selectFavorite = function (idx) {
  const favs = getFavorites();
  if (favs[idx]) {
    selectLocation(favs[idx]);
  }
};

export function renderFavoritesList() {
  const container = $('favorites-list');
  if (!container) return;
  const favs = getFavorites();

  if (favs.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = favs
    .map(f => {
      const bg = f.image ? `<img src="${f.image}" alt="${f.name}">` : `<div class="favorite-card-fallback"></div>`;
      const score = window._favScores?.[f.name];
      const scoreBadge = score
        ? `<span style="font-size:0.65rem;color:${score.score >= 80 ? '#00e676' : score.score >= 60 ? '#76ff03' : '#ffea00'};margin-left:4px;">${score.score}</span>`
        : '';
      return `
      <div class="favorite-card" data-lat="${f.latitude}" data-lon="${f.longitude}" data-name="${f.name}" data-country="${f.country || ''}">
        ${bg}
        <div class="favorite-card-overlay" title="${f.name}">${f.name}${scoreBadge}</div>
      </div>
    `;
    })
    .join('');

  container.querySelectorAll('.favorite-card').forEach(el => {
    el.addEventListener('click', () => {
      const { lat, lon, name, country } = el.dataset;
      selectLocation({ latitude: parseFloat(lat), longitude: parseFloat(lon), name, country });
      $('search-results').classList.remove('visible');
    });
  });
}

function updateFavoriteButton() {
  const btn = $('favorite-btn');
  if (!btn || !state.location) return;
  if (isFavorite(state.location.latitude, state.location.longitude)) {
    btn.style.color = '#fbbf24'; // Yellow
    btn.textContent = '★';
  } else {
    btn.style.color = '#cbd5e1'; // Gray
    btn.textContent = '☆';
  }
}

$('favorite-btn')?.addEventListener('click', async () => {
  if (!state.location) return;
  const added = await toggleFavorite(state.location);
  updateFavoriteButton();
  renderFavoritesList();
  showToast(added ? 'Added to favorites' : 'Removed from favorites', 'success');
});

// ─── Notification bell in header ───
$('notif-btn')?.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showToast('Notifications not supported', 'error');
    return;
  }
  if (Notification.permission === 'granted') {
    showToast('Notifications already enabled ✅', 'success');
    return;
  }
  try {
    var result = await Notification.requestPermission();
    if (result === 'granted') {
      showToast('Notifications enabled! ✅', 'success');
      $('notif-btn').style.color = '#00ff88';
    } else if (result === 'denied') {
      showToast('Denied. Enable in Chrome settings → Notifications', 'error');
    }
  } catch(e) {
    showToast('Permission request failed: ' + e.message, 'error');
  }
});

// Update bell color based on permission
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  var nb = $('notif-btn');
  if (nb) nb.style.color = '#00ff88';
}

// ─── Notification permission in settings ───
$('settings-notif-btn')?.addEventListener('click', async () => {
  var status = document.getElementById('settings-notif-status');
  if (!('Notification' in window)) {
    if (status) status.textContent = '❌ Notifications not supported on this browser';
    return;
  }
  if (Notification.permission === 'granted') {
    if (status) status.textContent = '✅ Notifications already allowed';
    return;
  }
  try {
    var result = await Notification.requestPermission();
    if (result === 'granted') {
      if (status) status.textContent = '✅ Notifications enabled!';
      showToast('Notifications enabled', 'success');
    } else {
      if (status) status.textContent = '❌ Denied. Enable manually: Chrome → Settings → Site settings → Notifications → stargaze-app.fly.dev → Allow';
    }
  } catch(e) {
    if (status) status.textContent = '❌ Error: ' + e.message;
  }
});

// Test notification button - sends immediately
$('settings-test-notif-btn')?.addEventListener('click', () => {
  if (!('Notification' in window)) {
    showToast('Notifications not supported', 'error');
    return;
  }
  if (Notification.permission !== 'granted') {
    showToast('Permission: ' + Notification.permission, 'warn');
    return;
  }
  var w = state.weatherData?.current || {};
  var info = [
    '☁️ Cloud ' + (w.cloudCover != null ? Math.round(w.cloudCover) + '%' : '?'),
    '🌡️ ' + (w.temperature != null ? Math.round(w.temperature) + '°C' : '?'),
    '👁️ Vis ' + (w.visibility != null ? (w.visibility/1000).toFixed(1) + 'km' : '?'),
    '💧 Hum ' + (w.humidity != null ? Math.round(w.humidity) + '%' : '?'),
    '📍 ' + (state.location ? state.location.name : '?')
  ].join(' · ');
  try {
    new Notification('🔭 StarGaze Update', { body: info, tag: 'stargaze-test' });
    showToast('Notification sent! ✅', 'success');
    return;
  } catch(e) {}
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then(function(reg) {
      reg.showNotification('🔭 StarGaze Update', { body: info, tag: 'stargaze-test' });
      showToast('Notification sent via SW! ✅', 'success');
    }).catch(function(e) {
      showToast('SW failed: ' + e.message, 'error');
    });
  } else {
    showToast('No notification method available', 'error');
  }
});

// Update notification status when settings opens
function updateNotifStatus() {
  var status = document.getElementById('settings-notif-status');
  if (!status) return;
  if (!('Notification' in window)) {
    status.textContent = '❌ Not supported';
  } else if (Notification.permission === 'granted') {
    status.textContent = '✅ Allowed';
  } else if (Notification.permission === 'denied') {
    status.textContent = '❌ Blocked — tap button below to retry, or enable in Chrome site settings';
  } else {
    status.textContent = '⚠️ Not yet requested — tap button below';
  }
}

// Update status when settings opens
$('settings-btn')?.addEventListener('click', async () => {
  $('settings-modal').classList.add('visible');
  updateNotifStatus();
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      const el = $('settings-interval');
      if (el) el.value = data.interval;
      if (data.interval) {
        refreshIntervalMs = parseInt(data.interval) * 1000;
        restartRefresh();
      }
    }
  } catch (err) {
    console.error('Failed to load settings', err);
  }
});

$('close-settings')?.addEventListener('click', () => {
  $('settings-modal').classList.remove('visible');
});

$('save-settings-btn')?.addEventListener('click', async () => {
  const interval = $('settings-interval')?.value || '14400';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval: parseInt(interval) }),
    });
    if (res.ok) {
      refreshIntervalMs = parseInt(interval) * 1000;
      restartRefresh();
      showToast('Settings saved', 'success');
      $('settings-modal').classList.remove('visible');
    }
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
});

// ─── Init ───
function init() {
  initMap('map');

  loadFavorites().then(() => renderFavoritesList());

  // Pre-fetch cloud APIs so they are ready when toggled
  import('./cloud-layer.js').then(m => m.initCloudSatelliteLayer().catch(console.error));

  // Fetch Curated Spots
  fetch('/api/curated_spots')
    .then(res => res.json())
    .then(spots => {
      const panel = document.getElementById('curated-spots-panel');
      const list = document.getElementById('curated-spots-list');
      if (spots && spots.length > 0 && panel && list) {
        panel.style.display = 'block';
        spots.forEach(spot => {
          const btn = document.createElement('button');
          btn.style.cssText =
            'text-align: left; background: transparent; border: none; color: white; cursor: pointer; padding: 6px; border-radius: 6px; transition: background 0.2s;';
          btn.innerHTML = `<strong style="font-size: 0.95rem;">${spot.name}</strong><br><span style="font-size: 0.75rem; color: #94a3b8;">${spot.bortle ? 'Class ' + spot.bortle + ' • ' : ''}${spot.admin1}</span>`;
          btn.onmouseover = () => (btn.style.background = 'rgba(255,255,255,0.1)');
          btn.onmouseout = () => (btn.style.background = 'transparent');
          btn.onclick = () => {
            selectLocation({
              latitude: spot.latitude,
              longitude: spot.longitude,
              name: spot.name,
              country: spot.country,
            });
          };
          list.appendChild(btn);
        });
      }
    })
    .catch(err => console.error('Failed to load curated spots', err));

  const map = getMap();

  // Left-click: relocate
  map.on('click', async e => {
    if (state.loading) return;
    setLoading(true);
    try {
      const locInfo = await reverseGeocode(e.latlng.lat, e.latlng.lng);
      await selectLocation({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
        name: locInfo.name,
        country: locInfo.country,
      });
    } catch (err) {
      console.error('💥 Map click error:', err);
      showToast('Error selecting location from map', 'error');
    } finally {
      setLoading(false);
    }
  });

  // Right-click: rotate viewing direction without relocating
  map.on('contextmenu', e => {
    if (state.loading || !state.location) return;
    const bearing = computeBearing(state.location.latitude, state.location.longitude, e.latlng.lat, e.latlng.lng);
    updateViewingBearing(state.location.latitude, state.location.longitude, bearing);
    updateStellariumBearing(bearing);
    // Sync slider
    const slider = $('bearing-slider');
    const label = $('bearing-label');
    if (slider) slider.value = Math.round(bearing);
    if (label) label.textContent = `${Math.round(bearing)}°`;
  });

  $('search-input').addEventListener('input', debounce(handleSearch, 300));
  $('search-input').addEventListener('focus', () => {
    if ($('search-results').children.length) $('search-results').classList.add('visible');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-container')) $('search-results').classList.remove('visible');
  });
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('search-results').classList.remove('visible');
      $('search-input').blur();
    }
  });

  $('locate-btn').addEventListener('click', handleGeolocation);
  $('reminder-close')?.addEventListener('click', closeReminderModal);
  $('reminder-form')?.addEventListener('submit', handleReminderSubmit);

  // Nearby Search
  $('nearby-radius')?.addEventListener('input', e => {
    $('nearby-radius-label').textContent = e.target.value;
  });

  $('nearby-max-results')?.addEventListener('input', e => {
    $('nearby-max-results-label').textContent = e.target.value;
  });

  // Same-country checkbox: update hint
  $('nearby-same-country')?.addEventListener('change', () => {
    const hint = $('nearby-country-hint');
    const checked = $('nearby-same-country')?.checked;
    if (hint && checked && state.location?.country) {
      hint.textContent = `(${state.location.country})`;
    } else if (hint) {
      hint.textContent = checked ? '' : '(search worldwide)';
    }
  });
  $('btn-find-nearby')?.addEventListener('click', handleFindNearby);

  document.querySelectorAll('.chart-tab').forEach(tab => tab.addEventListener('click', handleChartTab));

  // Mobile panel toggle & drag
  const panelToggleBtn = $('panel-toggle-btn');
  const infoPanel = $('info-panel');
  const panelHandle = $('panel-handle');
  if (panelToggleBtn && infoPanel && panelHandle) {
    panelToggleBtn.addEventListener('click', () => {
      infoPanel.classList.toggle('collapsed');
      panelToggleBtn.classList.toggle('collapsed');
    });
    // Touch drag to resize panel
    let dragStartY = 0, dragStartH = 0;
    panelHandle.addEventListener('touchstart', e => {
      dragStartY = e.touches[0].clientY;
      dragStartH = infoPanel.getBoundingClientRect().height;
    }, { passive: true });
    panelHandle.addEventListener('touchmove', e => {
      const dy = dragStartY - e.touches[0].clientY;
      const newH = Math.min(Math.max(dragStartH + dy, window.innerHeight * 0.08), window.innerHeight * 0.8);
      infoPanel.style.height = newH + 'px';
      infoPanel.style.maxHeight = newH + 'px';
    }, { passive: true });
    panelHandle.addEventListener('touchend', () => {
      // Snap to collapsed or expanded
      const h = infoPanel.getBoundingClientRect().height;
      if (h < window.innerHeight * 0.25) {
        infoPanel.classList.add('collapsed');
        panelToggleBtn.classList.add('collapsed');
        infoPanel.style.height = '';
        infoPanel.style.maxHeight = '';
      } else {
        infoPanel.classList.remove('collapsed');
        panelToggleBtn.classList.remove('collapsed');
        infoPanel.style.height = '';
        infoPanel.style.maxHeight = '';
      }
    });
  }

  // Map layer controls
  $('basemap-select')?.addEventListener('change', e => {
    import('./map-service.js').then(m => m.setBasemapLayer(e.target.value));
  });
  $('weather-layer-select')?.addEventListener('change', handleWeatherLayerChange);
  $('lp-layer-select')?.addEventListener('change', handleLpLayerChange);
  $('cloud-animate')?.addEventListener('click', handleCloudAnimate);

  // Satellite band toggle (IR ↔ True-Color)
  $('sat-band-toggle')?.addEventListener('click', () => {
    import('./cloud-layer.js').then(m => {
      const band = m.toggleSatelliteBand();
      const btn = $('sat-band-toggle');
      if (btn) btn.textContent = band === 'truecolor' ? '📷 True-Color' : '🌡️ IR';
      // Reload satellite layer if active
      if ($('weather-layer-select').value === 'satellite') {
        handleWeatherLayerChange({ target: { value: 'satellite' } });
      }
    });
  });

  // Zoom Earth link
  $('zoom-earth-link')?.addEventListener('click', e => {
    if (state.location) {
      e.preventDefault();
      window.open(`https://zoom.earth/#view=${state.location.latitude},${state.location.longitude},8z`, '_blank');
    }
  });

  // Opacity sliders
  $('cloud-opacity-slider')?.addEventListener('input', e => {
    import('./cloud-layer.js').then(m => m.setCloudOpacity(parseFloat(e.target.value)));
  });

  $('cloud-time-slider')?.addEventListener('input', e => {
    import('./cloud-layer.js').then(m => {
      if (cloudAnimating) handleCloudAnimate(); // Stop animation if scrubbing manually
      const time = m.setCloudFrame(parseInt(e.target.value, 10));
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
    });
  });

  $('lp-opacity-slider')?.addEventListener('input', e => {
    import('./map-service.js').then(m => m.setLightPollutionOpacity(parseFloat(e.target.value)));
  });

  // LP year slider
  $('lp-year-slider')?.addEventListener('input', e => {
    const year = parseInt(e.target.value, 10);
    $('lp-year-label').textContent = year;
    import('./map-service.js').then(m => m.setLightPollutionYear(year));
  });

  // LP year play/stop
  let lpPlayTimer = null;
  $('lp-play-btn')?.addEventListener('click', () => {
    const btn = $('lp-play-btn');
    const slider = $('lp-year-slider');
    if (lpPlayTimer) {
      clearInterval(lpPlayTimer);
      lpPlayTimer = null;
      btn.textContent = '▶ Play';
    } else {
      slider.value = 2012;
      btn.textContent = '⏸ Stop';
      lpPlayTimer = setInterval(() => {
        let val = parseInt(slider.value, 10) + 1;
        if (val > 2025) val = 2012;
        slider.value = val;
        $('lp-year-label').textContent = val;
        import('./map-service.js').then(m => m.setLightPollutionYear(val));
      }, 2000);
    }
  });

  // Nearby Filters
  ['filter-day-start', 'filter-day-end', 'filter-bortle', 'filter-clouds', 'filter-sort', 'filter-day-best'].forEach(
    id => {
      $(id)?.addEventListener('change', e => {
        if (id === 'filter-day-best') {
          const start = $('filter-day-start');
          const end = $('filter-day-end');
          if (start) start.disabled = e.target.checked;
          if (end) end.disabled = e.target.checked;
        }
        applyNearbyFilters();
      });
    },
  );

  console.log('🔭 StarGaze initialized');

  // Register service worker for PWA notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(function(reg) {
      reg.update();
    }).catch(() => {});
  }

  // Request notification permission for forecast alerts
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission(), 5000);
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopNowRefresh();
    stopForecastWatch();
    stopFavoritesWatch();
  });

  // Start favorites watcher
  startFavoritesWatch();

  // Load Ho Chi Minh City by default
  const defaultLoc = {
    name: 'Ho Chi Minh City',
    country: 'Vietnam',
    admin1: 'Ho Chi Minh City',
    latitude: 10.762622,
    longitude: 106.660172,
    timezone: 'Asia/Ho_Chi_Minh',
  };

  console.log('🔭 Loading default location: Ho Chi Minh City');
  selectLocation(defaultLoc).catch(err => {
    console.error('Failed to load default location:', err);
    showToast(`Failed to load default location: ${err.message}`, 'error');
  });

  // Expose for nearby-spot clicks
  window._selectLocation = selectLocation;

  // On mobile, collapse the info panel and controls by default (map-first layout)
  if (window.innerWidth <= 900) {
    $('info-panel')?.classList.add('collapsed');
    $('panel-toggle-btn')?.classList.add('collapsed');
    $('map-layers-control')?.classList.add('collapsed');
  }

  // Load default satellite cloud layer
  setTimeout(function() {
    var sel = $('weather-layer-select');
    if (sel && sel.value === 'satellite') {
      handleWeatherLayerChange({ target: { value: 'satellite' } });
    }
  }, 500);

  // Map controls toggle button
  $('controls-toggle-btn')?.addEventListener('click', () => {
    $('map-layers-control')?.classList.toggle('collapsed');
  });

  // AR Mode
  $('ar-btn')?.addEventListener('click', async () => {
    if (!state.location) {
      showToast('Select a location first', 'warn');
      return;
    }
    const ar = await import('./ar-mode.js');
    if (ar.isARActive()) {
      ar.stopARMode();
    } else {
      // Sync bearing so AR heading updates the map
      window._arBearingCallback = (heading, lat, lon) => {
        updateViewingBearing(lat, lon, heading);
        import('./sky-map.js').then(m => m.setSkyBearing(heading));
        const slider = $('bearing-slider');
        if (slider) slider.value = Math.round(heading);
      };
      // Expose current weather for AR overlay
      window._arWeatherData = state.weatherData?.current || null;
      ar.startARMode(state.location.latitude, state.location.longitude, (err) => {
        if (err) showToast(`AR: ${err}`, 'error');
        window._arBearingCallback = null;
        window._arWeatherData = null;
      });
    }
  });

  $('ar-close-btn')?.addEventListener('click', async () => {
    const ar = await import('./ar-mode.js');
    ar.stopARMode();
    window._arBearingCallback = null;
  });

  // Viewing bearing rotation slider
  $('bearing-slider')?.addEventListener('input', e => {
    const bearing = parseInt(e.target.value, 10);
    const label = $('bearing-label');
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[Math.round(bearing / 45) % 8];
    if (label) label.textContent = `${bearing}° ${dir}`;
    if (state.location) {
      updateViewingBearing(state.location.latitude, state.location.longitude, bearing);
      import('./sky-map.js').then(m => m.setSkyBearing(bearing));
    }
  });
}

// ─── Search ───
async function handleSearch(e) {
  const q = e.target.value.trim();
  const sr = $('search-results');
  if (q.length < 2) {
    sr.innerHTML = '';
    sr.classList.remove('visible');
    return;
  }

  const locs = await searchLocations(q);
  if (!locs.length) {
    sr.innerHTML = '<div class="search-item no-results">No locations found</div>';
    sr.classList.add('visible');
    return;
  }

  sr.innerHTML = locs
    .map(
      (l, i) => `
    <button class="search-item" data-index="${i}" type="button">
      <span class="search-item-name">${l.name}</span>
      <span class="search-item-detail">${[l.admin1, l.country].filter(Boolean).join(', ')}</span>
    </button>`,
    )
    .join('');
  sr.classList.add('visible');
  sr.querySelectorAll('.search-item').forEach(item => {
    item.addEventListener('click', () => {
      selectLocation(locs[parseInt(item.dataset.index)]);
      sr.classList.remove('visible');
    });
  });
}

// ─── Geolocation ───
async function handleGeolocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'error');
    return;
  }
  const btn = $('locate-btn');
  btn.classList.add('loading');
  btn.textContent = '⏳ Locating...';
  try {
    const pos = await new Promise((ok, fail) =>
      navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 10000 }),
    );
    const { latitude, longitude } = pos.coords;
    const locs = await searchLocations(`${latitude},${longitude}`);
    const loc = locs[0] || { name: 'Current Location', country: '', admin1: '', latitude, longitude, timezone: 'auto' };
    loc.latitude = latitude;
    loc.longitude = longitude;
    selectLocation(loc);
  } catch {
    showToast('Could not get location. Search manually.', 'error');
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '<span class="btn-icon">📍</span> My Location';
  }
}

// ─── Select Location ───
async function selectLocation(location) {
  setLoading(true);
  try {
    state.location = location;
    $('search-results').classList.remove('visible');
    $('search-input').value = `${location.name}${location.country ? ', ' + location.country : ''}`;

    updateFavoriteButton();

    const [weatherData, bortleClass] = await Promise.all([
      getWeatherData(location.latitude, location.longitude, location.timezone || 'auto'),
      estimateBortleClass(location.latitude, location.longitude),
    ]);

    state.weatherData = weatherData;
    // Pass observed cloud cover to bias-correct the model forecast
    const observedCloud = weatherData.current?.cloudCover ?? null;
    state.scores = calculateAllScores(weatherData, bortleClass, observedCloud);
    state.bestNight = findBestNight(state.scores);
    state.bortleClass = bortleClass;

    // Reveal container BEFORE rendering map and charts
    // Otherwise Leaflet and Chart.js get 0x0 dimensions and throw errors/NaNs
    $('welcome-section')?.classList.add('hidden');
    $('info-panel')?.classList.remove('hidden');
    $('content-sections')?.classList.remove('hidden');

    // Force a small delay to guarantee browser DOM reflow applies dimensions
    await new Promise(r => setTimeout(r, 50));

    // On mobile, expand the panel when a location is selected
    if (window.innerWidth <= 900) {
      $('info-panel')?.classList.remove('collapsed');
      $('panel-toggle-btn')?.classList.remove('collapsed');
    }

    renderLocationInfo();
    renderNowScore();
    renderStargazingCards();
    renderCharts();

    updateMapView();
    updateViewingBearing(location.latitude, location.longitude, 0);
    initSkyMapView();

    // Show bearing control and reset slider
    const bearingCtrl = $('bearing-control');
    const bearingSlider = $('bearing-slider');
    const bearingLabel = $('bearing-label');
    if (bearingCtrl) bearingCtrl.style.display = '';
    if (bearingSlider) bearingSlider.value = 0;
    if (bearingLabel) bearingLabel.textContent = '0° N';

    // Start continuous now-score refresh
    startNowRefresh();
    startForecastWatch();

    // Update nearby country hint
    const hint = $('nearby-country-hint');
    const sameCountry = $('nearby-same-country');
    if (hint && sameCountry?.checked && location.country) {
      hint.textContent = `(${location.country})`;
    }

    // Preload Stellarium for instant AR mode
    import('./ar-mode.js').then(m => m.preloadStellarium(location.latitude, location.longitude));

    const stellariumLink = $('stellarium-link');
    if (stellariumLink) stellariumLink.href = getStellariumUrl(location.latitude, location.longitude, 0);

    setTimeout(() => {
      document.querySelectorAll('.animate-in').forEach((el, i) => {
        el.style.animationDelay = `${i * 0.1}s`;
        el.classList.add('visible');
      });
    }, 100);
  } catch (err) {
    console.error('Failed:', err);
    showToast(`Failed to load weather: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// ─── Render delegates ───
function renderLocationInfo() {
  _renderLocationInfo(state, $);
}
function renderNowScore() {
  _renderNowScore(state, $);
}
function renderStargazingCards() {
  _renderStargazingCards(state, $);
}
function renderCharts() {
  _renderCharts(state);
}
function updateMapView() {
  _updateMapView(state);
}
function initSkyMapView() {
  return _initSkyMapView(state);
}

// ─── Auto-refresh (weather + notifications for favorites & forecast) ───
function startNowRefresh() {
  stopNowRefresh();
  checkAllFavorites();
  checkAndNotifyForecast();
  refreshTimer = setInterval(async () => {
    if (state.location && !state.loading) {
      try {
        var wd = await getWeatherData(state.location.latitude, state.location.longitude, state.location.timezone || 'auto');
        state.weatherData = wd;
        renderNowScore();
      } catch (err) { console.warn('Refresh failed:', err); }
    }
    checkAllFavorites();
    checkAndNotifyForecast();
  }, refreshIntervalMs);
}
function stopNowRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

// ─── 7-day forecast watcher ───
function startForecastWatch() {}
function stopForecastWatch() {}

async function checkAndNotifyForecast() {
  if (!state.location || !state.weatherData || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    var bortle = await estimateBortleClass(state.location.latitude, state.location.longitude).catch(function(){ return 5; });
    var cur = state.weatherData.current || {};
    var scores = calculateAllScores(state.weatherData, bortle, cur.cloudCover ?? null);
    var body = buildForecastBody(scores);
    sendNotification('📍 ' + state.location.name, body, 'now-' + state.location.name.replace(/\s/g,'-'));
  } catch(e) { console.warn('Forecast notify failed:', e); }
}

function scoreIcon(v) {
  if (v >= 90) return '🌟';
  if (v >= 80) return '⭐';
  if (v >= 70) return '✨';
  if (v >= 60) return '🌙';
  if (v >= 50) return '🌤️';
  return '☁️';
}

function buildForecastBody(scores) {
  var lines = [];
  var best = null;
  for (var i = 0; i < scores.length; i++) {
    if (!best || scores[i].score > best.score) best = scores[i];
  }
  if (best) {
    var bd = new Date(best.date).toLocaleDateString('en-US',{weekday:'short'});
    lines.push(scoreIcon(best.score) + ' Best: ' + bd + ' ' + best.score);
  }
  for (var i = 0; i < Math.min(scores.length, 7); i++) {
    var s = scores[i];
    var d = new Date(s.date).toLocaleDateString('en-US',{weekday:'short'});
    var cloud = (s.avgCloudCover != null) ? s.avgCloudCover : '?';
    var rain = (s.precipProbability != null) ? s.precipProbability : '?';
    lines.push(d + ' ☁' + cloud + '% 🌧' + rain + '% ' + scoreIcon(s.score) + ' ' + s.score);
  }
  return lines.join('\n');
}
// ─── Favorites watcher ───
window._favScores = {};

function startFavoritesWatch() { checkAllFavorites(); }
function stopFavoritesWatch() {}

async function checkAllFavorites() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  var locs = [];
  if (state.location) locs.push({ name: state.location.name, lat: state.location.latitude, lon: state.location.longitude });
  var favs = getFavorites();
  for (var i = 0; i < favs.length; i++) {
    var f = favs[i];
    if (state.location && Math.abs(f.latitude - state.location.latitude) < 0.01 && Math.abs(f.longitude - state.location.longitude) < 0.01) continue;
    locs.push({ name: f.name, lat: f.latitude, lon: f.longitude });
  }
  if (!locs.length) return;

  for (var j = 0; j < locs.length; j++) {
    var loc = locs[j];
    try {
      var wd = await getWeatherData(loc.lat, loc.lon, 'auto');
      var cur = wd.current || {};
      var bortle = await estimateBortleClass(loc.lat, loc.lon).catch(function(){ return 5; });
      var scores = calculateAllScores(wd, bortle, cur.cloudCover ?? null);
      var body = buildForecastBody(scores);
      sendNotification('📍 ' + loc.name, body, 'loc-' + loc.name.replace(/\s/g,'-'));
    } catch (e) { console.warn('Check failed for ' + loc.name + ':', e); }
  }
  renderFavoritesList();
}

function sendNotification(title, body, tag) {
  try { new Notification(title, { body: body, tag: tag }); return; } catch(e) {}
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then(function(reg) {
      reg.showNotification(title, { body: body, tag: tag });
    }).catch(function(){});
  }
}
// ─── Nearby wrappers ───
function handleFindNearby() {
  return _handleFindNearby(state, $, applyNearbyFilters);
}
function handleWeatherLayerChange(e) {
  return _handleWeatherLayerChange(e, cloudAnimating, v => {
    cloudAnimating = v;
  });
}
function handleLpLayerChange(e) {
  return _handleLpLayerChange(e);
}
function handleCloudAnimate() {
  return _handleCloudAnimate(cloudAnimating, v => {
    cloudAnimating = v;
  });
}

// ─── Reminder Modal ───
window.openReminder = function (i) {
  const night = state.scores[i];
  if (!night) return;
  const modal = document.getElementById('reminder-modal');
  document.getElementById('reminder-night-date').textContent = new Date(night.date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  document.getElementById('reminder-night-score').textContent = night.score + '/100';
  document.getElementById('reminder-night-score').style.color = night.ratingColor;
  document.getElementById('reminder-score-index').value = i;
  modal.classList.add('visible');
};
function closeReminderModal() {
  document.getElementById('reminder-modal').classList.remove('visible');
}
async function handleReminderSubmit(e) {
  e.preventDefault();
  const i = parseInt(document.getElementById('reminder-score-index').value);
  const night = state.scores[i];
  if (!night) return;
  const email = document.getElementById('reminder-email').value.trim();
  const method = document.querySelector('input[name="reminder-method"]:checked').value;
  if (method === 'email' && email) {
    sendEmailReminder(email, night, state.location.name + ', ' + state.location.country);
    showToast('Opening email client', 'success');
  } else if (method === 'notification') {
    if (!('Notification' in window)) {
      showToast('Notifications not supported on this browser', 'error');
      closeReminderModal();
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Notifications blocked. Enable in Chrome → Site Settings → Notifications', 'error');
      closeReminderModal();
      return;
    }
    var ok = await requestNotificationPermission();
    if (ok) {
      var nightDate = new Date(night.date).toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});
      var weatherInfo = [
        '⭐ ' + night.score + '/100 ' + night.rating,
        '☁️ Cloud ' + (night.avgCloudCover || '?') + '%',
        '🌡️ ' + (night.tempMin || '?') + '°–' + (night.tempMax || '?') + '°C',
        '👁️ Vis ' + ((night.avgVisibility || 0) / 1000).toFixed(1) + 'km',
        night.moonPhaseIcon + ' Moon ' + (night.moonPhaseName || '?'),
        '📍 ' + state.location.name
      ].join(' · ');
      showNotification('🔭 Stargazing — ' + nightDate, { body: weatherInfo });
      var now = Date.now();
      var target = new Date(night.sunset).getTime() + 30 * 60000;
      var delay = Math.max(1000, target - now);
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SCHEDULE',
          delay: delay,
          title: '🔭 Stargazing Tonight!',
          body: weatherInfo
        });
        showToast('Reminder scheduled for sunset! ✅', 'success');
      } else {
        showToast('Notification set! ✅', 'success');
      }
    } else {
      showToast('Notification denied — check browser site settings', 'error');
    }
  }
  closeReminderModal();
}
window.addToCalendar = function (i) {
  const night = state.scores[i];
  if (!night) return;
  createStargazingReminder(night, state.location.name + ', ' + state.location.country);
  showToast('Calendar event downloaded!', 'success');
};

// ─── Loading ───
function setLoading(on) {
  state.loading = on;
  document.getElementById('loading-overlay').classList.toggle('visible', on);
}
document.addEventListener('DOMContentLoaded', init);

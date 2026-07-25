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
  isAccuWeatherEnabled,
  setAccuWeatherEnabled,
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
import { createAllCharts, resizeAllCharts } from './chart-service.js';
import { initSkyMap, updateSkyMap, getStellariumUrl, setSkyContext } from './sky-map.js?v=33';
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

import {
  state,
  saveState,
  loadSavedLocation,
  getRecentSearches,
  addRecentSearch,
  formatLocationName,
  debounce,
} from './app-state.js';
import { setupReminderModal, closeReminderModal } from './app-reminders.js';
import { init as initSearch, showRecentSearches, setToast } from './app-search.js';
import { init as initTide, renderTidePanel } from './app-tide.js';

let refreshTimer = null;
let refreshIntervalMs = 5 * 60 * 1000; // default 5 min

function restartRefresh() {
  stopNowRefresh();
  startNowRefresh();
}

const $ = id => document.getElementById(id);
let cloudAnimating = false;

// Global Error & Promise Rejection Handlers
window.addEventListener('error', event => {
  console.error('💥 [Global Error]', event.error || event.message);
});

window.addEventListener('unhandledrejection', event => {
  console.error('💥 [Unhandled Rejection]', event.reason);
});

function updateStellariumBearing(bearing) {
  import('./sky-map.js').then(m => m.setSkyBearing(bearing));
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
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      showToast('Notifications enabled! ✅', 'success');
      $('notif-btn').style.color = '#00ff88';
    } else if (result === 'denied') {
      showToast('Denied. Enable in Chrome settings → Notifications', 'error');
    }
  } catch (e) {
    showToast('Permission request failed: ' + e.message, 'error');
  }
});

// Update bell color based on permission
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  const nb = $('notif-btn');
  if (nb) nb.style.color = '#00ff88';
}

// ─── Notification permission in settings ───
$('settings-notif-btn')?.addEventListener('click', async () => {
  const status = document.getElementById('settings-notif-status');
  if (!('Notification' in window)) {
    if (status) status.textContent = '❌ Notifications not supported on this browser';
    return;
  }
  if (Notification.permission === 'granted') {
    if (status) status.textContent = '✅ Notifications already allowed';
    return;
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      if (status) status.textContent = '✅ Notifications enabled!';
      showToast('Notifications enabled', 'success');
    } else {
      if (status)
        status.textContent =
          '❌ Denied. Enable manually: Chrome → Settings → Site settings → Notifications → stargaze-app.fly.dev → Allow';
    }
  } catch (e) {
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
  const w = state.weatherData?.current || {};
  const info = [
    '☁️ Cloud ' + (w.cloudCover != null ? Math.round(w.cloudCover) + '%' : '?'),
    '🌡️ ' + (w.temperature != null ? Math.round(w.temperature) + '°C' : '?'),
    '👁️ Vis ' + (w.visibility != null ? (w.visibility / 1000).toFixed(1) + 'km' : '?'),
    '💧 Hum ' + (w.humidity != null ? Math.round(w.humidity) + '%' : '?'),
    '📍 ' + (state.location ? state.location.name : '?'),
  ].join(' · ');
  try {
    new Notification('🔭 StarGaze Update', { body: info, tag: 'stargaze-test' });
    showToast('Notification sent! ✅', 'success');
    return;
  } catch (e) {
    void e;
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then(function (reg) {
        reg.showNotification('🔭 StarGaze Update', { body: info, tag: 'stargaze-test' });
        showToast('Notification sent via SW! ✅', 'success');
      })
      .catch(function (e) {
        showToast('SW failed: ' + e.message, 'error');
      });
  } else {
    showToast('No notification method available', 'error');
  }
});

// Update notification status when settings opens
function updateNotifStatus() {
  const status = document.getElementById('settings-notif-status');
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

// AccuWeather label helper
function updateAccuLabel() {
  const label = $('accu-status-label');
  const check = $('settings-accuweather');
  if (label && check) {
    label.textContent = check.checked ? 'ON' : 'OFF';
    label.style.color = check.checked ? '#f80' : '#64748b';
  }
}

// Update status when settings opens
$('settings-btn')?.addEventListener('click', async () => {
  $('settings-modal').classList.add('visible');
  updateNotifStatus();
  // AccuWeather toggle
  const accuCheck = $('settings-accuweather');
  if (accuCheck) {
    accuCheck.checked = isAccuWeatherEnabled();
    updateAccuLabel();
  }
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
  const accuCheck = $('settings-accuweather');
  if (accuCheck) {
    setAccuWeatherEnabled(accuCheck.checked);
    updateAccuLabel();
  }
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

  // AccuWeather toggle listener — attach once
  $('settings-accuweather')?.addEventListener('change', updateAccuLabel);

  // Load saved settings interval BEFORE starting refresh
  fetch('/api/settings')
    .then(res => res.json())
    .then(data => {
      if (data.interval) {
        refreshIntervalMs = parseInt(data.interval) * 1000;
      }
    })
    .catch(() => {})
    .finally(() => {
      // Start refresh with correct interval (or default 5 min if load fails)
      startNowRefresh();
      startForecastWatch();
      startFavoritesWatch();
    });

  loadFavorites().then(() => renderFavoritesList());

  // Pre-fetch cloud APIs so they are ready when toggled
  import('./cloud-layer.js').then(m => m.initCloudSatelliteLayer().catch(console.error));

  if (new URLSearchParams(window.location.search).get('mockAR') === 'true') {
    import('../simulator/ARSimulatorUI.js')
      .then(m => m.arSimulator?.init())
      .catch(err => console.warn('AR Simulator import note:', err));
  }

  // Fetch Curated Spots
  fetch('/api/curated_spots')
    .then(res => res.json())
    .then(spots => {
      const panel = document.getElementById('curated-spots-panel');
      const list = document.getElementById('curated-spots-list');
      if (spots && spots.length > 0 && panel && list) {
        panel.style.display = 'block';
        spots.forEach(spot => {
          const icon = spot.type === 'mirror_sea' ? '🪞' : '⭐';
          const btn = document.createElement('button');
          btn.style.cssText =
            'text-align: left; background: transparent; border: none; color: white; cursor: pointer; padding: 6px; border-radius: 6px; transition: background 0.2s;';
          btn.innerHTML =
            icon +
            ' <strong style="font-size: 0.95rem;">' +
            spot.name +
            '</strong><br><span style="font-size: 0.75rem; color: #94a3b8;">' +
            (spot.bortle ? 'Class ' + spot.bortle + ' • ' : '') +
            spot.admin1 +
            '</span>';
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

  initTide(state);

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

  // Search bar & geolocation — delegated to app-search module
  initSearch({ selectLocation, searchLocations, getRecentSearches, addRecentSearch, $, showToast });
  setToast(showToast);
  // Restore location name after search blur
  $('search-input')?.addEventListener('blur', function () {
    if (!this.value.trim() && state.location) {
      this.value = formatLocationName(state.location);
    }
  });

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

  // Weather model selector — refresh data when model changes
  const modelSel = $('weather-model-select');
  if (modelSel) {
    modelSel.value = state.weatherModel || 'best_match';
    modelSel.addEventListener('change', function () {
      state.weatherModel = this.value;
      saveState();
      if (state.location) selectLocation(state.location);
    });
  }

  document.querySelectorAll('.chart-tab').forEach(tab => tab.addEventListener('click', handleChartTab));

  // Mobile panel toggle & drag
  const panelToggleBtn = $('panel-toggle-btn');
  const infoPanel = $('info-panel');
  const panelHandle = $('panel-handle');
  if (panelToggleBtn && infoPanel && panelHandle) {
    panelToggleBtn.addEventListener('click', () => {
      infoPanel.classList.toggle('collapsed');
      panelToggleBtn.classList.toggle('collapsed');
      if (!infoPanel.classList.contains('collapsed')) {
        setTimeout(function () {
          resizeAllCharts();
        }, 400);
      }
    });
    // Touch drag to resize panel
    let dragStartY = 0,
      dragStartH = 0;
    panelHandle.addEventListener(
      'touchstart',
      e => {
        dragStartY = e.touches[0].clientY;
        dragStartH = infoPanel.getBoundingClientRect().height;
      },
      { passive: true },
    );
    panelHandle.addEventListener(
      'touchmove',
      e => {
        const dy = dragStartY - e.touches[0].clientY;
        const newH = Math.min(Math.max(dragStartH + dy, window.innerHeight * 0.08), window.innerHeight * 0.8);
        infoPanel.style.height = newH + 'px';
        infoPanel.style.maxHeight = newH + 'px';
      },
      { passive: true },
    );
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
  // Initialize LP controls visibility on page load
  if ($('lp-layer-select')?.value !== 'none') {
    $('lp-controls')?.classList.remove('hidden');
  }
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
    const opacity = parseFloat(e.target.value);
    const label = $('cloud-opacity-val');
    if (label) label.textContent = `${Math.round(opacity * 100)}%`;
    import('./cloud-layer.js').then(m => m.setCloudOpacity(opacity));
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
    const opacity = parseFloat(e.target.value);
    const label = $('lp-opacity-val');
    if (label) label.textContent = `${Math.round(opacity * 100)}%`;
    import('./map-service.js').then(m => m.setLightPollutionOpacity(opacity));
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
  // NOTE: Do NOT call reg.update() — it forces an update check on every page load
  // which, combined with skipWaiting, can cause a constant reload cycle.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
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

  // Resume refresh when tab becomes visible (fixes mobile background throttling)
  let lastVisibleTime = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const elapsed = Date.now() - lastVisibleTime;
      // If tab was hidden longer than the refresh interval, run immediately
      if (elapsed >= refreshIntervalMs) {
        checkAllFavorites();
        checkAndNotifyForecast();
        // Restart the interval timer
        restartRefresh();
      }
    } else {
      lastVisibleTime = Date.now();
    }
  });

  // ─── Smart initial location: saved > IP geolocation > default ───
  const saved = loadSavedLocation();
  if (saved) {
    console.log('📍 Restoring saved location:', saved.name);
    selectLocation(saved).catch(err => console.error('Failed to restore location:', err));
  } else {
    // Try IP geolocation first (free, no API key needed)
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        if (data.latitude && data.longitude) {
          const ipLoc = {
            name: data.city || data.region || 'Your Location',
            country: data.country_name || '',
            admin1: data.region || '',
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone || 'auto',
          };
          console.log('📍 IP geolocation:', ipLoc.name + ', ' + ipLoc.country);
          return selectLocation(ipLoc);
        }
        throw new Error('No location from IP');
      })
      .catch(() => {
        // Fallback to Ho Chi Minh City
        const defaultLoc = {
          name: 'Ho Chi Minh City',
          country: 'Vietnam',
          admin1: 'Ho Chi Minh City',
          latitude: 10.762622,
          longitude: 106.660172,
          timezone: 'Asia/Ho_Chi_Minh',
        };
        console.log('📍 Using default location:', defaultLoc.name);
        return selectLocation(defaultLoc);
      })
      .catch(err => console.error('Failed to load location:', err));
  }

  // ─── AR button: always visible, shows hint on desktop ───
  if (!('DeviceOrientationEvent' in window) || !('ontouchstart' in window)) {
    const arBtn = $('ar-btn');
    if (arBtn) {
      arBtn.style.opacity = '0.5';
      arBtn.title = 'AR requires a phone with gyroscope';
    }
  }

  // ─── Show offline indicator when loaded from SW cache ───
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    const banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.textContent = '📡 Offline-ready — cached data may be stale';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f97316;color:#000;text-align:center;padding:6px;font-size:12px;font-weight:600';
    document.body.prepend(banner);
    // Auto-hide after 4 seconds
    setTimeout(() => {
      const b = $('offline-banner');
      if (b) b.remove();
    }, 4000);
  }

  // ─── Close modals on outside click ───
  document.addEventListener('click', e => {
    if (e.target.id === 'settings-modal') $('settings-modal').classList.remove('visible');
    if (e.target.id === 'reminder-modal') $('reminder-modal').classList.remove('visible');
  });

  // Expose for nearby-spot clicks
  window._selectLocation = selectLocation;

  // On mobile, collapse controls by default; keep info panel OPEN for chart rendering
  if (window.innerWidth <= 900) {
    $('map-layers-control')?.classList.add('collapsed');
  }

  // Load default satellite cloud layer
  setTimeout(function () {
    const sel = $('weather-layer-select');
    if (sel && sel.value === 'satellite') {
      handleWeatherLayerChange({ target: { value: 'satellite' } });
    }
  }, 500);

  // Map controls toggle button (FAB 🗺️)
  $('controls-toggle-btn')?.addEventListener('click', () => {
    $('map-layers-control')?.classList.toggle('collapsed');
  });

  // AR Mode
  $('ar-btn')?.addEventListener('click', async () => {
    if (!state.location) {
      // Try geolocation first
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
        });
        const lat = pos.coords.latitude,
          lon = pos.coords.longitude;
        state.location = {
          latitude: lat,
          longitude: lon,
          name: lat.toFixed(4) + ', ' + lon.toFixed(4),
          countryCode: '',
        };
        selectLocation(state.location);
      } catch (e) {
        alert('Please tap \uD83D\uDCCD My Location first, or search for a city first.');
        return;
      }
    }
    const ar = await import('./ar-mode.js');
    if (ar.isARActive()) {
      ar.stopARMode();
    } else {
      // AR heading updates the map via event emitter
      import('./ar-mode.js').then(() => {
        import('../core/events.js').then(({ on }) => {
          on('bearing:update', ({ heading, lat, lon }) => {
            updateViewingBearing(lat, lon, heading);
            import('./sky-map.js').then(m => m.setSkyBearing(heading));
            const slider = $('bearing-slider');
            if (slider) slider.value = Math.round(heading);
          });
        });
      });
      ar.startARMode(state.location.latitude, state.location.longitude, err => {
        if (err) showToast(`AR: ${err}`, 'error');
      });
    }
  });

  $('ar-close-btn')?.addEventListener('click', async () => {
    const ar = await import('./ar-mode.js');
    ar.stopARMode();
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

// ─── Select Location ───
let _selectReqId = 0; // guard against concurrent calls corrupting state
async function selectLocation(location) {
  const reqId = ++_selectReqId;

  // Phase 1: Show location immediately — pan map, update search bar
  state.location = location;
  saveState();
  addRecentSearch(location);
  $('search-results').classList.remove('visible');
  $('search-input').value = formatLocationName(location);

  updateFavoriteButton();

  // Show panels immediately (before data arrives)
  $('welcome-section')?.classList.add('hidden');
  $('info-panel')?.classList.remove('hidden');
  $('content-sections')?.classList.remove('hidden');

  if (window.innerWidth <= 900) {
    $('info-panel')?.classList.remove('collapsed');
    $('panel-toggle-btn')?.classList.remove('collapsed');
    setTimeout(function () {
      resizeAllCharts();
    }, 400);
  }

  updateMapView();
  updateViewingBearing(location.latitude, location.longitude, 0);

  const bearingCtrl = $('bearing-control');
  const bearingSlider = $('bearing-slider');
  const bearingLabel = $('bearing-label');
  if (bearingCtrl) bearingCtrl.style.display = '';
  if (bearingSlider) bearingSlider.value = 0;
  if (bearingLabel) bearingLabel.textContent = '0° N';

  const hint = $('nearby-country-hint');
  const sameCountry = $('nearby-same-country');
  if (hint && sameCountry?.checked && location.country) {
    hint.textContent = `(${location.country})`;
  }

  // Phase 2: Fetch data in parallel (non-blocking for UI)
  setLoading(true);
  try {
    const [weatherData, bortleClass] = await Promise.all([
      getWeatherData(location.latitude, location.longitude, location.timezone || 'auto', state.weatherModel),
      estimateBortleClass(location.latitude, location.longitude),
    ]);

    // Guard: discard if another selectLocation was called while we were waiting
    if (reqId !== _selectReqId) return;

    state.weatherData = weatherData;
    const observedCloud = weatherData.current?.cloudCover ?? null;
    state.scores = calculateAllScores(weatherData, bortleClass, observedCloud);
    state.bestNight = findBestNight(state.scores);
    state.bortleClass = bortleClass;

    renderLocationInfo();
    renderNowScore();
    renderNextHours();
    renderStargazingCards();
    renderCharts();

    initSkyMapView();
    renderTidePanel(location.latitude, location.longitude);

    startNowRefresh();
    startForecastWatch();

    // Preload Stellarium for instant AR mode
    import('./ar-mode.js').then(m => m.preloadStellarium(location.latitude, location.longitude));

    setTimeout(() => {
      if (reqId !== _selectReqId) return;
      document.querySelectorAll('.animate-in').forEach((el, i) => {
        el.style.animationDelay = `${i * 0.1}s`;
        el.classList.add('visible');
      });
    }, 100);
  } catch (err) {
    if (reqId === _selectReqId) {
      console.error('Failed:', err);
      showToast(`Failed to load weather: ${err.message}`, 'error');
    }
  } finally {
    if (reqId === _selectReqId) setLoading(false);
  }
}

// ─── Render delegates ───
function renderLocationInfo() {
  _renderLocationInfo(state, $);
}
function renderNowScore() {
  _renderNowScore(state, $);
}
function renderNextHours() {
  const sec = $('next-hours-section');
  const grid = $('next-hours-grid');
  if (!sec || !grid || !state.weatherData || !state.weatherData.hourly) return;
  const now = Date.now();
  const hours = state.weatherData.hourly
    .filter(function (h) {
      return h.time.getTime() >= now && h.time.getTime() <= now + 12 * 3600000;
    })
    .slice(0, 12);
  if (!hours.length) return;
  sec.style.display = '';
  grid.innerHTML = hours
    .map(function (h) {
      const hr = h.time.getHours();
      const label = hr === 0 ? '12AM' : hr < 12 ? hr + 'AM' : hr === 12 ? '12PM' : hr - 12 + 'PM';
      const cc = h.cloudCover != null ? h.cloudCover : 50;
      const lo = h.cloudCoverLow,
        mi = h.cloudCoverMid,
        hi = h.cloudCoverHigh;
      const ccColor =
        cc <= 20 ? '#00e676' : cc <= 40 ? '#76ff03' : cc <= 60 ? '#ffea00' : cc <= 80 ? '#ff9800' : '#f44336';
      let icon = cc <= 20 ? '☀️' : cc <= 50 ? '⛅' : '☁️';
      // If mostly cirrus, show ☁️ but lighter
      if (hi > 50 && (lo || 0) < 20 && (mi || 0) < 30) icon = '🌤️';
      const temp = h.temperature != null ? Math.round(h.temperature) + '°' : '--';
      // Tiny bar showing cloud layer composition
      const barW = 40;
      const loW = Math.round(((lo || 0) / 100) * barW),
        miW = Math.round(((mi || 0) / 100) * barW),
        hiW = Math.round(((hi || 0) / 100) * barW);
      return (
        '<div style="flex:0 0 58px;text-align:center;font-size:10px;color:#94a3b8;padding:3px 2px;background:rgba(255,255,255,0.04);border-radius:6px">' +
        '<div style="font-weight:600;color:#e2e8f0;margin-bottom:1px;font-size:10px">' +
        label +
        '</div>' +
        '<div style="font-size:16px;margin:1px 0">' +
        icon +
        '</div>' +
        '<div style="color:' +
        ccColor +
        ';font-weight:600;font-size:10px">' +
        cc +
        '%</div>' +
        '<div style="display:flex;gap:1px;justify-content:center;margin:2px 0;height:4px">' +
        '<span style="width:' +
        loW +
        'px;background:#f44336;border-radius:1px" title="Low:' +
        (lo || 0) +
        '%"></span>' +
        '<span style="width:' +
        miW +
        'px;background:#ff9800;border-radius:1px" title="Mid:' +
        (mi || 0) +
        '%"></span>' +
        '<span style="width:' +
        hiW +
        'px;background:#78909c;border-radius:1px" title="High:' +
        (hi || 0) +
        '%"></span>' +
        '</div>' +
        '<div style="font-size:9px">' +
        temp +
        '</div></div>'
      );
    })
    .join('');
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
        const wd = await getWeatherData(
          state.location.latitude,
          state.location.longitude,
          state.location.timezone || 'auto',
          state.weatherModel,
        );
        state.weatherData = wd;
        renderNowScore();
      } catch (err) {
        console.warn('Refresh failed:', err);
      }
    }
    checkAllFavorites();
    checkAndNotifyForecast();
  }, refreshIntervalMs);
}
function stopNowRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ─── 7-day forecast watcher ───
function startForecastWatch() {}
function stopForecastWatch() {}

async function checkAndNotifyForecast() {
  if (!state.location || !state.weatherData || !('Notification' in window) || Notification.permission !== 'granted')
    return;
  try {
    const bortle = await estimateBortleClass(state.location.latitude, state.location.longitude).catch(function () {
      return 7;
    });
    const cur = state.weatherData.current || {};
    const scores = calculateAllScores(state.weatherData, bortle, cur.cloudCover ?? null);
    const body = buildForecastBody(scores);
    sendNotification('📍 ' + state.location.name, body, 'now-' + state.location.name.replace(/\s/g, '-'));
  } catch (e) {
    console.warn('Forecast notify failed:', e);
  }
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
  const lines = [];
  let best = null;
  for (let i = 0; i < scores.length; i++) {
    if (!best || scores[i].score > best.score) best = scores[i];
  }
  if (best) {
    const bd = new Date(best.date).toLocaleDateString('en-US', { weekday: 'short' });
    lines.push(scoreIcon(best.score) + ' Best: ' + bd + ' ' + best.score);
  }
  for (let i = 0; i < Math.min(scores.length, 7); i++) {
    const s = scores[i];
    const d = new Date(s.date).toLocaleDateString('en-US', { weekday: 'short' });
    const cloud = s.avgCloudCover != null ? s.avgCloudCover : '?';
    const rain = s.avgPrecipProb != null ? s.avgPrecipProb : '?';
    lines.push(d + ' ☁' + cloud + '% 🌧' + rain + '% ' + scoreIcon(s.score) + ' ' + s.score);
  }
  return lines.join('\n');
}
// ─── Favorites watcher ───
window._favScores = {};

function startFavoritesWatch() {
  checkAllFavorites();
}
function stopFavoritesWatch() {}

async function checkAllFavorites() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const locs = [];
  if (state.location)
    locs.push({ name: state.location.name, lat: state.location.latitude, lon: state.location.longitude });
  const favs = getFavorites();
  for (let i = 0; i < favs.length; i++) {
    const f = favs[i];
    if (
      state.location &&
      Math.abs(f.latitude - state.location.latitude) < 0.01 &&
      Math.abs(f.longitude - state.location.longitude) < 0.01
    )
      continue;
    locs.push({ name: f.name, lat: f.latitude, lon: f.longitude });
  }
  if (!locs.length) return;

  for (let j = 0; j < locs.length; j++) {
    const loc = locs[j];
    try {
      const wd = await getWeatherData(loc.lat, loc.lon, 'auto');
      const cur = wd.current || {};
      const bortle = await estimateBortleClass(loc.lat, loc.lon).catch(function () {
        return 7;
      });
      const scores = calculateAllScores(wd, bortle, cur.cloudCover ?? null);
      const body = buildForecastBody(scores);
      sendNotification('📍 ' + loc.name, body, 'loc-' + loc.name.replace(/\s/g, '-'));
    } catch (e) {
      console.warn('Check failed for ' + loc.name + ':', e);
    }
  }
  renderFavoritesList();
}

function sendNotification(title, body, tag) {
  try {
    new Notification(title, { body: body, tag: tag });
    return;
  } catch (e) {
    void e;
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then(function (reg) {
        reg.showNotification(title, { body: body, tag: tag });
      })
      .catch(function () {});
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
setupReminderModal(state);

// ─── Loading ───
function setLoading(on) {
  state.loading = on;
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.toggle('visible', on);
}
document.addEventListener('DOMContentLoaded', init);

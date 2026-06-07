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
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

// ─── Settings ───
$('settings-btn')?.addEventListener('click', async () => {
  $('settings-modal').classList.add('visible');
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      const el = $('settings-interval');
      if (el) el.value = data.interval;
      const em = $('settings-email');
      if (em) em.value = data.email || '';
      const pw = $('settings-password');
      if (pw) pw.value = data.password || '';
      const owm = $('settings-owm-key');
      if (owm) owm.value = data.owm_key || '';
      const wapi = $('settings-weatherapi-key');
      if (wapi) wapi.value = data.weatherapi_key || '';

      // Store keys globally
      window.STARGAZE_OWM_KEY = data.owm_key || null;
      window.STARGAZE_WEATHERAPI_KEY = data.weatherapi_key || null;
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
  const email = $('settings-email')?.value || '';
  const password = $('settings-password')?.value || '';
  const owm_key = $('settings-owm-key')?.value || '';
  const weatherapi_key = $('settings-weatherapi-key')?.value || '';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval: parseInt(interval), email, password, owm_key, weatherapi_key }),
    });
    if (res.ok) {
      window.STARGAZE_OWM_KEY = owm_key;
      window.STARGAZE_WEATHERAPI_KEY = weatherapi_key;
      showToast('Settings saved successfully', 'success');
      $('settings-modal').classList.remove('visible');
    }
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
});

$('test-notification-btn')?.addEventListener('click', async () => {
  // 1. Instant browser notification (mock)
  if ('Notification' in window) {
    const perm = Notification.permission;
    if (perm === 'granted') {
      new Notification('⭐ StarGaze Test Notification', {
        body: 'Score: 92/100 🌌 | Cloud: 5% · Vis: 24km · Hum: 38% · Moon: 15%',
        icon: '/android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
        tag: 'stargaze-test',
      });
      showToast('📬 Browser notification sent! Check your screen.', 'success');
    } else if (perm === 'default') {
      const granted = await Notification.requestPermission();
      if (granted === 'granted') {
        new Notification('⭐ StarGaze Test Notification', {
          body: 'Score: 92/100 🌌 | Cloud: 5% · Vis: 24km · Hum: 38% · Moon: 15%',
          tag: 'stargaze-test',
        });
        showToast('📬 Notification sent! (permission granted)', 'success');
      } else {
        showToast('⚠️ Notification permission denied', 'warn');
      }
    } else {
      showToast('⚠️ Notifications blocked in browser settings', 'warn');
    }
  } else {
    showToast('⚠️ Browser does not support notifications', 'warn');
  }

  // 2. Backend email notification
  try {
    const res = await fetch('/api/test-notification', { method: 'POST' });
    if (res.ok) showToast('📧 Email notification triggered!', 'success');
    else showToast('⚠️ Email failed (check settings)', 'warn');
  } catch (err) {
    showToast('⚠️ Backend unreachable for email', 'warn');
  }
});

// ─── Init ───
function init() {
  initMap('map');

  // Pre-load settings (e.g., API keys)
  fetch('/api/settings')
    .then(r => r.json())
    .then(data => {
      window.STARGAZE_OWM_KEY = data.owm_key || null;
      window.STARGAZE_WEATHERAPI_KEY = data.weatherapi_key || null;
    })
    .catch(console.warn);

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

    renderLocationInfo();
    renderNowScore();
    renderStargazingCards();
    renderCharts();

    updateMapView();
    updateViewingBearing(location.latitude, location.longitude, 0);
    initSkyMapView();

    // Start continuous now-score refresh
    startNowRefresh();
    startForecastWatch();

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

// ─── Auto-refresh ───
function startNowRefresh() {
  stopNowRefresh();
  refreshTimer = setInterval(async () => {
    if (!state.location || state.loading) return;
    try {
      const wd = await getWeatherData(
        state.location.latitude,
        state.location.longitude,
        state.location.timezone || 'auto',
      );
      state.weatherData = wd;
      renderNowScore();
    } catch (err) {
      console.warn('Now-score refresh failed:', err);
    }
  }, REFRESH_INTERVAL_MS);
}
function stopNowRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ─── 7-day forecast watcher (background notification for good nights) ───
let forecastWatchTimer = null;
const FORECAST_CHECK_MS = 30 * 60 * 1000; // every 30 minutes

function startForecastWatch() {
  stopForecastWatch();
  checkAndNotifyForecast(); // run immediately
  forecastWatchTimer = setInterval(checkAndNotifyForecast, FORECAST_CHECK_MS);
}

function stopForecastWatch() {
  if (forecastWatchTimer) {
    clearInterval(forecastWatchTimer);
    forecastWatchTimer = null;
  }
}

async function checkAndNotifyForecast() {
  if (!state.location || !state.scores?.length) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Find any night in the next 7 days with score >= 60
  const goodNights = state.scores.filter(s => s.score >= 60);
  if (!goodNights.length) return;

  const best = goodNights[0]; // already sorted by date
  const dateStr = new Date(best.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  new Notification('⭐ Good stargazing coming up!', {
    body: `${best.rating} night (${best.score}/100) — ${dateStr}\n☁️ ${best.avgCloudCover}% cloud · ${best.moonPhaseIcon} ${best.moonPhaseName}`,
    icon: '🔭',
    badge: '⭐',
    tag: `stargaze-${best.date}`,
  });
}
// ─── Favorites watcher — check all favorited locations in background ───
let favWatchTimer = null;
const FAV_CHECK_MS = 45 * 60 * 1000; // every 45 minutes
window._favScores = {}; // { name: { score, rating, date } }

function startFavoritesWatch() {
  stopFavoritesWatch();
  checkAllFavorites(); // run immediately
  favWatchTimer = setInterval(checkAllFavorites, FAV_CHECK_MS);
}

function stopFavoritesWatch() {
  if (favWatchTimer) { clearInterval(favWatchTimer); favWatchTimer = null; }
}

async function checkAllFavorites() {
  const favs = getFavorites();
  if (!favs.length) return;

  for (const fav of favs) {
    try {
      const wd = await getWeatherData(fav.latitude, fav.longitude, 'auto');
      const bortle = await estimateBortleClass(fav.latitude, fav.longitude);
      const scores = calculateAllScores(wd, bortle, wd.current?.cloudCover ?? null);
      const best = findBestNight(scores);
      if (best) {
        window._favScores[fav.name] = {
          score: best.score, rating: best.rating, date: best.date,
          cloud: best.avgCloudCover, moon: best.moonPhaseIcon,
        };
        // Notify if excellent (score >= 80)
        if (best.score >= 80 && Notification.permission === 'granted') {
          const d = new Date(best.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          new Notification(`🌟 ${fav.name}: ${best.rating} stargazing!`, {
            body: `Score ${best.score}/100 — ${d}\n☁️ ${best.avgCloudCover}% cloud · ${best.moonPhaseIcon} ${best.moonPhaseName}`,
            icon: '🔭', tag: `fav-${fav.name}-${best.date}`,
          });
        }
      }
    } catch (e) { console.warn(`Fav check failed for ${fav.name}:`, e); }
  }

  renderFavoritesList();
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
    const ok = await requestNotificationPermission();
    if (ok) {
      showNotification('Reminder Set', {
        body: night.rating + ' night on ' + new Date(night.date).toLocaleDateString(),
      });
      showToast('Notification enabled!', 'success');
    } else showToast('Notification denied', 'error');
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

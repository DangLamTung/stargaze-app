/**
 * AppSearch — search bar, recent searches, geolocation UI.
 * Receives callbacks from app.js to avoid circular dependencies.
 */
import { escapeHtml } from '../core/utils.js';

let _selectLocation, _searchLocations, _getRecent, _addRecent, _$;

export function init({ selectLocation, searchLocations, getRecentSearches, addRecentSearch, $, showToast }) {
  _selectLocation = selectLocation;
  _searchLocations = searchLocations;
  _getRecent = getRecentSearches;
  _addRecent = addRecentSearch;
  _$ = $;

  // Search input
  _$('search-input')?.addEventListener('input', debounce(handleSearch, 300));
  _$('search-input')?.addEventListener('focus', () => {
    const sr = _$('search-results');
    if (sr && sr.children.length === 0) showRecentSearches();
  });
  _$('search-input')?.addEventListener('blur', () => {
    setTimeout(() => _$('search-results')?.classList.remove('visible'), 200);
  });
  _$('search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const sr = _$('search-results');
      const firstItem = sr?.querySelector('.search-item:not(.no-results)');
      if (firstItem) {
        firstItem.click();
      }
    } else if (e.key === 'Escape') {
      _$('search-results')?.classList.remove('visible');
      _$('search-input')?.blur();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-container')) _$('search-results')?.classList.remove('visible');
  });

  // Locate button
  _$('locate-btn')?.addEventListener('click', handleGeolocation);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function showRecentSearches() {
  const recent = _getRecent();
  const sr = _$('search-results');
  if (!recent.length) {
    sr.classList.remove('visible');
    return;
  }

  sr.innerHTML =
    '<div style="padding:6px 12px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">🕐 Recent</div>' +
    recent
      .map(
        (r, i) => `
    <button class="search-item" data-index="${i}" type="button" style="opacity:0.85">
      <span class="search-item-name">📍 ${escapeHtml(r.name)}</span>
      <span class="search-item-detail">${escapeHtml([r.admin1, r.country].filter(Boolean).join(', '))}</span>
    </button>`,
      )
      .join('');
  sr.classList.add('visible');
  sr.querySelectorAll('.search-item').forEach(item => {
    item.addEventListener('click', () => {
      _selectLocation(recent[parseInt(item.dataset.index)]);
      sr.classList.remove('visible');
    });
  });
}

async function handleSearch(e) {
  const q = e.target.value.trim();
  const sr = _$('search-results');
  if (q.length < 2) {
    sr.innerHTML = '';
    showRecentSearches();
    return;
  }

  const locs = await _searchLocations(q);
  if (!locs.length) {
    sr.innerHTML = '<div class="search-item no-results">No locations found</div>';
    sr.classList.add('visible');
    return;
  }

  sr.innerHTML = locs
    .map(
      (l, i) => `
    <button class="search-item" data-index="${i}" type="button">
      <span class="search-item-name">${escapeHtml(l.name)}</span>
      <span class="search-item-detail">${escapeHtml([l.admin1, l.country].filter(Boolean).join(', '))}</span>
    </button>`,
    )
    .join('');
  sr.classList.add('visible');
  sr.querySelectorAll('.search-item').forEach(item => {
    item.addEventListener('click', () => {
      _selectLocation(locs[parseInt(item.dataset.index)]);
      sr.classList.remove('visible');
    });
  });
}

async function handleGeolocation() {
  if (!navigator.geolocation) {
    _showToast('Geolocation not supported', 'error');
    return;
  }
  const btn = _$('locate-btn');
  btn.classList.add('loading');
  btn.textContent = '⏳ Locating...';
  try {
    const pos = await new Promise((ok, fail) =>
      navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 10000 }),
    );
    const { latitude, longitude } = pos.coords;
    const locs = await _searchLocations(`${latitude},${longitude}`);
    const loc = locs[0] || { name: 'Current Location', country: '', admin1: '', latitude, longitude, timezone: 'auto' };
    loc.latitude = latitude;
    loc.longitude = longitude;
    _selectLocation(loc);
  } catch {
    _showToast('Could not get location. Search manually.', 'error');
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '<span class="btn-icon">📍</span> My Location';
  }
}

let _showToast;
export function setToast(fn) {
  _showToast = fn;
}

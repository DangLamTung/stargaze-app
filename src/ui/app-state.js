/**
 * app-state.js
 * Central application state and local storage persistence.
 */

const LS_KEY = 'stargaze_state';
const RECENT_KEY = 'stargaze_recent';
const MAX_RECENT = 5;

export const state = {
  location: null,
  weatherData: null,
  weatherData14: null,
  scores: null,
  scores14: null,
  bestNight: null,
  forecastDays: 7,
  loading: false,
  loadingExtended: false,
  bortleClass: 7,
  weatherModel: 'best_match',
};

window._starGazeState = state;

export function saveState() {
  if (state.location) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.location));
    } catch (e) {
      console.warn('[State] Failed to save state:', e);
    }
  }
}

export function loadSavedLocation() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('[State] Failed to load saved location:', e);
  }
  return null;
}

export function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

export function addRecentSearch(loc) {
  const recent = getRecentSearches().filter(r => r.name !== loc.name);
  recent.unshift({
    name: loc.name,
    country: loc.country,
    admin1: loc.admin1,
    latitude: loc.latitude,
    longitude: loc.longitude,
  });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (e) {
    console.warn('[State] Failed to save recent searches:', e);
  }
}

export function formatLocationName(loc) {
  return `${loc.name}${loc.country ? ', ' + loc.country : ''}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/**
 * SkyMap — Interactive star chart / planetarium view
 * Embeds Stellarium Web for an interactive sky view at the selected location.
 */

let skyInstance = null;
let currentIframe = null;
const skyContext = { latitude: null, longitude: null, date: null, bearing: 0, altitude: 35, fov: 60 };
let skyUpdateTimer = null;

function buildStellariumUrl() {
  const { latitude, longitude, date, bearing, altitude, fov } = skyContext;
  const numLat = parseFloat(latitude);
  const numLon = parseFloat(longitude);
  if (isNaN(numLat) || isNaN(numLon)) return null;

  const params = new URLSearchParams({
    lat: numLat.toFixed(4),
    lng: numLon.toFixed(4),
    az: String(Math.round(bearing)),
    alt: String(altitude),
    fov: String(fov),
  });

  if (date instanceof Date && !isNaN(date.getTime())) {
    params.set('date', date.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  }

  return `https://stellarium-web.org/?${params.toString()}`;
}

function scheduleSkyReload() {
  if (!currentIframe) return;
  clearTimeout(skyUpdateTimer);
  skyUpdateTimer = setTimeout(() => {
    const url = buildStellariumUrl();
    if (url) currentIframe.src = url;
  }, 350);
}

function applyIframeSrc(immediate = false) {
  const url = buildStellariumUrl();
  if (!url || !currentIframe) return;
  if (immediate) {
    clearTimeout(skyUpdateTimer);
    currentIframe.src = url;
    return;
  }
  scheduleSkyReload();
}

/**
 * Initialize the sky map at a given location
 */
export async function initSkyMap(containerId, latitude, longitude, date = null) {
  const numLat = parseFloat(latitude);
  const numLon = parseFloat(longitude);
  if (isNaN(numLat) || isNaN(numLon)) return null;

  skyContext.latitude = numLat;
  skyContext.longitude = numLon;
  skyContext.date = date;

  try {
    const container = document.getElementById(containerId);
    if (!container) return null;

    container.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.src = buildStellariumUrl();
    iframe.style.width = '200%';
    iframe.style.height = '200%';
    iframe.style.transform = 'scale(0.5)';
    iframe.style.transformOrigin = 'top left';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '24px';
    iframe.allowFullscreen = true;

    container.style.overflow = 'hidden';
    container.appendChild(iframe);
    currentIframe = iframe;
    skyInstance = iframe;

    const fallback = document.getElementById('sky-fallback');
    if (fallback) fallback.style.display = 'none';

    return skyInstance;
  } catch (err) {
    console.error('Sky map initialization failed:', err);
    showSkyMapFallback(containerId, numLat, numLon);
    return null;
  }
}

export function setSkyContext({ latitude, longitude, date, bearing, altitude, fov } = {}) {
  if (latitude != null) skyContext.latitude = parseFloat(latitude);
  if (longitude != null) skyContext.longitude = parseFloat(longitude);
  if (date !== undefined) skyContext.date = date;
  if (bearing != null) skyContext.bearing = ((Number(bearing) % 360) + 360) % 360;
  if (altitude != null) skyContext.altitude = altitude;
  if (fov != null) skyContext.fov = fov;
}

export function setSkyBearing(degrees) {
  skyContext.bearing = ((Number(degrees) % 360) + 360) % 360;
  applyIframeSrc();
}

export function updateSkyMap(latitude, longitude, date = null) {
  if (!currentIframe) {
    console.warn('SkyMap not initialized yet');
    return;
  }

  const numLat = parseFloat(latitude);
  const numLon = parseFloat(longitude);
  if (!isNaN(numLat) && !isNaN(numLon)) {
    skyContext.latitude = numLat;
    skyContext.longitude = numLon;
    skyContext.date = date;
    applyIframeSrc(true);
  }
}

function showSkyMapFallback(containerId, latitude, longitude) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const stellariumUrl = buildStellariumUrl() || `https://stellarium-web.org/?lat=${latitude}&lng=${longitude}`;

  container.innerHTML = `
    <div class="sky-fallback">
      <div class="sky-fallback-icon">🔭</div>
      <h3>Interactive Sky Map</h3>
      <p>Open the full Stellarium experience to explore tonight's sky</p>
      <a href="${stellariumUrl}" target="_blank" rel="noopener" class="btn-stellarium">
        🌌 Open Stellarium Web
      </a>
    </div>
  `;
}

export function getStellariumUrl(latitude, longitude, bearing = skyContext.bearing) {
  const prev = { ...skyContext };
  skyContext.latitude = parseFloat(latitude);
  skyContext.longitude = parseFloat(longitude);
  skyContext.bearing = bearing;
  const url = buildStellariumUrl();
  Object.assign(skyContext, prev);
  if (!url) return '#';
  return url;
}

export function destroySkyMap() {
  clearTimeout(skyUpdateTimer);
  if (currentIframe) currentIframe.remove();
  skyInstance = null;
  currentIframe = null;
}

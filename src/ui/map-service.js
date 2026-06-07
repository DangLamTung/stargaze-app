/**
 * MapService — Leaflet map with dark tiles
 */

let map = null,
  locationMarker = null,
  bearingLine = null,
  bearingArc = null,
  bearingGlow = null,
  bortleLabel = null;
let currentBearing = 0;
const ARC_SPREAD = 60; // degrees of FOV — wider for industrial look

function createIcon(emoji, color = '#00d4ff', size = 36) {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div class="marker-pin" style="background:${color};box-shadow:0 0 12px ${color}60"><span class="marker-emoji">${emoji}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

export function initMap(containerId) {
  console.log(`🗺️ Initializing map in container: #${containerId}`);
  if (map) {
    console.log('🗺️ Removing existing map instance');
    map.remove();
  }
  map = L.map(containerId, { zoomControl: false, attributionControl: true }).setView([20, 0], 3);

  // CartoDB Dark Matter basemap (default — pairs well with light pollution overlay)
  const basemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  // Store active basemap layer for switching later
  map._activeBasemap = basemap;

  setLightPollutionLayer('viirs'); // Default: show light pollution overlay

  // Add custom sovereignty overlays
  drawSovereigntyOverlays(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  console.log('🗺️ Map setup complete');
  return map;
}

function drawSovereigntyOverlays(map) {
  // Hoang Sa (Paracel Islands)
  const hoangSaIcon = L.divIcon({
    className: 'sovereignty-label',
    html: '<div style="color: #ff3333; font-weight: bold; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff; font-size: 14px; white-space: nowrap;">Quần đảo Hoàng Sa (Việt Nam)</div>',
    iconSize: [200, 20],
    iconAnchor: [100, 10],
  });
  L.marker([16.5, 112.0], { icon: hoangSaIcon, zIndexOffset: 500 }).addTo(map);
  L.circle([16.5, 112.0], { radius: 100000, color: '#ff3333', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(
    map,
  );

  // Truong Sa (Spratly Islands)
  const truongSaIcon = L.divIcon({
    className: 'sovereignty-label',
    html: '<div style="color: #ff3333; font-weight: bold; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff; font-size: 14px; white-space: nowrap;">Quần đảo Trường Sa (Việt Nam)</div>',
    iconSize: [200, 20],
    iconAnchor: [100, 10],
  });
  L.marker([10.0, 114.0], { icon: truongSaIcon, zIndexOffset: 500 }).addTo(map);
  L.circle([10.0, 114.0], { radius: 250000, color: '#ff3333', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(
    map,
  );
}

export function setLocation(lat, lon, name = '') {
  if (!map) {
    console.warn('🗺️ Cannot set location: map is not initialized');
    return;
  }

  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);
  console.log(`📍 setLocation called: lat=${lat} (parsed: ${numLat}), lon=${lon} (parsed: ${numLon}), name="${name}"`);

  if (isNaN(numLat) || isNaN(numLon) || numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) {
    console.error(`❌ Invalid coordinates passed to setLocation: (${numLat}, ${numLon})`);
    throw new Error(`Invalid LatLng: (${numLat}, ${numLon})`);
  }

  if (locationMarker) {
    console.log('📍 Removing old location marker');
    map.removeLayer(locationMarker);
  }

  console.log(`📍 Adding location marker at [${numLat}, ${numLon}]`);
  locationMarker = L.marker([numLat, numLon], { icon: createIcon('📍', '#00d4ff', 42), zIndexOffset: 1000 }).addTo(map);
  if (name)
    locationMarker.bindPopup(
      `<div class="map-popup"><strong>${name}</strong><br><small>${numLat.toFixed(4)}°, ${numLon.toFixed(4)}°</small></div>`,
    );

  console.log(`✈️ Flying to [${numLat}, ${numLon}]`);
  map.invalidateSize(); // Force Leaflet to update dimensions before calculating fly path
  map.flyTo([numLat, numLon], 11, { duration: 1.5 });
}

export function getMap() {
  return map;
}
export function invalidateSize() {
  if (map) setTimeout(() => map.invalidateSize(), 100);
}

// ─── Viewing direction indicator on map ───

function destPoint(lat, lon, bearingDeg, distKm) {
  const R = 6371;
  const d = distKm / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(brng));
  const λ2 = λ1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI];
}

export function updateViewingBearing(lat, lon, bearing) {
  if (!map || lat == null || lon == null) return;

  if (bearingLine) map.removeLayer(bearingLine);
  if (bearingArc) map.removeLayer(bearingArc);
  if (bearingGlow) map.removeLayer(bearingGlow);
  if (bortleLabel) map.removeLayer(bortleLabel);

  currentBearing = ((bearing % 360) + 360) % 360;

  // Larger distance for industrial radar look
  const dist = Math.max(8, 30 - (map.getZoom() - 8) * 2.5);

  // Glow layer — wide, translucent
  const glowTip = destPoint(lat, lon, bearing, dist * 1.05);
  bearingGlow = L.polyline([[lat, lon], glowTip], {
    color: '#00ff88',
    weight: 8,
    opacity: 0.12,
    interactive: false,
  }).addTo(map);

  // Main dashed line — bright neon green
  const tip = destPoint(lat, lon, bearing, dist);
  bearingLine = L.polyline([[lat, lon], tip], {
    color: '#00ff88',
    weight: 3,
    dashArray: '10, 6',
    opacity: 0.7,
    interactive: false,
  }).addTo(map);

  // Wide filled arc for FOV
  const arcPoints = [[lat, lon]];
  const steps = 16;
  for (let i = -ARC_SPREAD / 2; i <= ARC_SPREAD / 2; i += ARC_SPREAD / steps) {
    arcPoints.push(destPoint(lat, lon, bearing + i, dist * 0.75));
  }
  arcPoints.push([lat, lon]);
  bearingArc = L.polygon(arcPoints, {
    color: '#00ff88',
    weight: 1.5,
    fillColor: '#00ff88',
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(map);

  // Bortle label at the tip
  bortleLabel = L.marker(tip, {
    icon: L.divIcon({
      className: 'bearing-bortle-label',
      html: '<div style="background:rgba(0,0,0,0.85);color:#00ff88;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #00ff8844;white-space:nowrap;">⏳</div>',
      iconSize: [40, 18],
      iconAnchor: [20, 9],
    }),
    interactive: false,
  }).addTo(map);

  // Fire Bortle query along the bearing
  const samplePoint = destPoint(lat, lon, bearing, Math.min(dist * 0.8, 20));
  fetch(`/api/bortle?lat=${samplePoint[0].toFixed(4)}&lon=${samplePoint[1].toFixed(4)}`)
    .then(r => r.json())
    .then(d => {
      const b = d.bortle || '?';
      const color = b <= 3 ? '#00ff88' : b <= 5 ? '#ffcc00' : '#ff4444';
      bortleLabel.setIcon(L.divIcon({
        className: 'bearing-bortle-label',
        html: `<div style="background:rgba(0,0,0,0.9);color:${color};padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid ${color}44;white-space:nowrap;">🌌 B${b} ${Math.round(bearing)}°</div>`,
        iconSize: [70, 20],
        iconAnchor: [35, 10],
      }));
    })
    .catch(() => {});
}

export function getViewingBearing() {
  return currentBearing;
}

/** Compute bearing from (lat1,lon1) to (lat2,lon2) in degrees */
export function computeBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

let lpLayer = null;
let currentLpType = 'none';
let currentLpYear = 2023;
let currentLpOpacity = 0.55;

export function setBasemapLayer(type) {
  if (!map) return;
  if (map._activeBasemap) {
    map.removeLayer(map._activeBasemap);
  }

  let layerUrl, attr;
  if (type === 'dark') {
    layerUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    attr = '&copy; <a href="https://carto.com/attributions">CARTO</a>';
  } else if (type === 'satellite') {
    layerUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    attr = '&copy; <a href="https://www.esri.com">Esri</a>';
  } else {
    // Default to OSM
    layerUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  }

  map._activeBasemap = L.tileLayer(layerUrl, { attribution: attr, maxZoom: 19 }).addTo(map);
  // Re-add other layers on top
  if (lpLayer) lpLayer.bringToFront();
}

export function setLightPollutionLayer(type) {
  if (!map) return;
  if (lpLayer) map.removeLayer(lpLayer);
  lpLayer = null;
  currentLpType = type;

  if (type === 'none') return;

  lpLayer = L.tileLayer(`/api/tile/{z}/{x}/{y}.png?year=${currentLpYear}`, {
    attribution: `&copy; <a href="https://lightpollutionmap.info">lightpollutionmap.info (VIIRS ${currentLpYear})</a>`,
    opacity: currentLpOpacity,
    maxZoom: 19,
    maxNativeZoom: 8,
  }).addTo(map);
}

export function setLightPollutionOpacity(opacity) {
  currentLpOpacity = opacity;
  if (lpLayer) lpLayer.setOpacity(opacity);
}

export function setLightPollutionYear(year) {
  currentLpYear = year;
  if (currentLpType !== 'none') {
    setLightPollutionLayer(currentLpType);
  }
}

let nearbyMarkersLayer = null;

export function renderNearbyMarkers(rankedPlaces) {
  if (!map) return;
  if (nearbyMarkersLayer) map.removeLayer(nearbyMarkersLayer);

  nearbyMarkersLayer = L.layerGroup().addTo(map);

  rankedPlaces.forEach(r => {
    // Skip plotting the baseline location to avoid cluttering the center marker
    if (r.place.id === 'current') return;

    const lat = r.place.latitude;
    const lon = r.place.longitude;
    const score = r.bestNight.score;

    // Color scale: Green > 80, Yellow > 60, Red <= 60
    const color = score > 80 ? '#22c55e' : score > 60 ? '#eab308' : '#ef4444';

    const marker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: color,
      fillOpacity: 0.8,
      color: '#1e293b',
      weight: 2,
      opacity: 1,
    });

    marker.bindTooltip(
      `<div style="text-align:center;"><strong>${r.place.name}</strong><br>Score: ${score}/100<br>Dist: ${Math.round(r.place.distance)} km</div>`,
      { direction: 'top', className: 'nearby-tooltip' },
    );

    // Bind popup for 7-day forecast
    marker.bindPopup(`<div id="popup-${r.place.id}" style="min-width: 200px;">Loading 7-day forecast...</div>`);

    marker.on('popupopen', async () => {
      const popupEl = document.getElementById(`popup-${r.place.id}`);
      if (!popupEl) return;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,cloudcover_mean&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const daily = data.daily;

        let html = `<div style="text-align:center; font-weight:bold; margin-bottom:8px; color: var(--text-primary); border-bottom: 1px solid #ccc; padding-bottom: 4px;">${r.place.name} - 7 Day Forecast</div>`;
        html += `<div style="display:flex; flex-direction:column; gap:6px; font-size:0.85rem; color: #333;">`;
        for (let d = 0; d < 7; d++) {
          const date = new Date(daily.time[d]).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          html += `<div style="display:flex; justify-content:space-between;">
            <span style="font-weight:600; width:50px;">${date}</span>
            <span>☁️ ${Math.round(daily.cloudcover_mean[d])}%</span>
            <span>🌧️ ${daily.precipitation_sum[d]}mm</span>
            <span>🌡️ ${Math.round(daily.temperature_2m_max[d])}°</span>
          </div>`;
        }
        html += `</div>`;
        popupEl.innerHTML = html;
      } catch (err) {
        popupEl.innerHTML = 'Failed to load forecast';
      }
    });

    nearbyMarkersLayer.addLayer(marker);
  });
}

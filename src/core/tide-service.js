/**
 * TideService — Tide prediction using harmonic estimation + backend API.
 *
 * Harmonic model based on primary tidal constituents:
 *   M2 (12.42h), S2 (12.00h), K1 (23.93h), O1 (25.82h)
 *
 * Vietnam's coast has three tidal regimes:
 *   North (Gulf of Tonkin): Diurnal — 1 high, 1 low per day
 *   Central: Mixed — 1-2 of each
 *   South: Semidiurnal — 2 highs, 2 lows per day
 */

const BACKEND_TIDE_URL = '/api/tide';

// Vietnam tide reference stations with regime and max range
export const VN_TIDE_STATIONS = [
  { name: 'Hòn Dấu (Hải Phòng)', lat: 20.67, lon: 106.8, regime: 'diurnal', maxRange: 3.8 },
  { name: 'Hòn Gai (Hạ Long)', lat: 20.95, lon: 107.08, regime: 'diurnal', maxRange: 4.2 },
  { name: 'Cửa Ông', lat: 21.03, lon: 107.36, regime: 'diurnal', maxRange: 4.0 },
  { name: 'Bạch Long Vĩ', lat: 20.13, lon: 107.73, regime: 'diurnal', maxRange: 3.5 },
  { name: 'Sầm Sơn (Thanh Hóa)', lat: 19.74, lon: 105.9, regime: 'diurnal', maxRange: 3.2 },
  { name: 'Cửa Hội (Vinh)', lat: 18.75, lon: 105.73, regime: 'diurnal', maxRange: 2.8 },
  { name: 'Đà Nẵng (Tiên Sa)', lat: 16.12, lon: 108.22, regime: 'mixed', maxRange: 1.8 },
  { name: 'Thuận An (Huế)', lat: 16.55, lon: 107.63, regime: 'mixed', maxRange: 1.5 },
  { name: 'Quy Nhơn', lat: 13.77, lon: 109.25, regime: 'mixed', maxRange: 2.0 },
  { name: 'Nha Trang', lat: 12.25, lon: 109.2, regime: 'mixed', maxRange: 2.2 },
  { name: 'Cam Ranh', lat: 11.9, lon: 109.15, regime: 'mixed', maxRange: 2.0 },
  { name: 'Phan Thiết (Mũi Né)', lat: 10.93, lon: 108.1, regime: 'semidiurnal', maxRange: 2.4 },
  { name: 'Vũng Tàu', lat: 10.35, lon: 107.08, regime: 'semidiurnal', maxRange: 3.8 },
  { name: 'Côn Đảo', lat: 8.69, lon: 106.61, regime: 'semidiurnal', maxRange: 3.0 },
  { name: 'Cần Giờ (TP.HCM)', lat: 10.42, lon: 106.88, regime: 'semidiurnal', maxRange: 3.5 },
  { name: 'Phú Quốc (Dương Đông)', lat: 10.22, lon: 103.97, regime: 'mixed', maxRange: 0.8 },
  { name: 'Hà Tiên', lat: 10.38, lon: 104.48, regime: 'mixed', maxRange: 0.7 },
  { name: 'Rạch Giá', lat: 10.02, lon: 105.08, regime: 'mixed', maxRange: 0.8 },
  { name: 'Cà Mau (Năm Căn)', lat: 8.77, lon: 105.02, regime: 'mixed', maxRange: 1.2 },
];

// ─── Helpers ───

function haversineKm(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLon = ((lon2 - lon1) * Math.PI) / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getMoonPhase(date) {
  // Approximate moon phase using new moon reference: Jan 6, 2000 18:14 UTC
  var ref = new Date(Date.UTC(2000, 0, 6, 18, 14));
  var ageDays = ((date.getTime() - ref.getTime()) / 86400000) % 29.530588853;
  if (ageDays < 0) ageDays += 29.530588853;
  return { ageDays: ageDays, phase: ageDays / 29.530588853 };
}

function getNearestStation(lat, lon) {
  var best = null,
    bestDist = Infinity;
  for (var i = 0; i < VN_TIDE_STATIONS.length; i++) {
    var d = haversineKm(lat, lon, VN_TIDE_STATIONS[i].lat, VN_TIDE_STATIONS[i].lon);
    if (d < bestDist) {
      bestDist = d;
      best = VN_TIDE_STATIONS[i];
    }
  }
  if (best && bestDist <= 300) {
    return { station: best, distanceKm: Math.round(bestDist) };
  }
  // Global fallback: check if near water
  if (isNearWater(lat, lon)) {
    return { station: { name: null, regime: 'semidiurnal', maxRange: 1.5 }, distanceKm: null };
  }
  return null;
}

function isNearWater(lat, lon) {
  // Rough check against major ocean bounding boxes
  var oceans = [
    { minLat: -60, maxLat: 60, minLon: -180, maxLon: -60 },
    { minLat: -60, maxLat: 60, minLon: 100, maxLon: 180 },
    { minLat: -60, maxLat: 60, minLon: -60, maxLon: 20 },
    { minLat: -40, maxLat: 30, minLon: 20, maxLon: 100 },
    { minLat: 0, maxLat: 25, minLon: 100, maxLon: 122 },
  ];
  for (var i = 0; i < oceans.length; i++) {
    var o = oceans[i];
    var cl = Math.max(o.minLat, Math.min(lat, o.maxLat));
    var cn = Math.max(o.minLon, Math.min(lon, o.maxLon));
    if (haversineKm(lat, lon, cl, cn) <= 100) return true;
  }
  return false;
}

// ─── Harmonic Tide Computation ───

function computeHarmonicTides(lat, lon, date, days) {
  var info = getNearestStation(lat, lon);
  if (!info) return null;

  var regime = info.station.regime;
  var maxRange = info.station.maxRange;
  var moon = getMoonPhase(date);
  // Spring/neap modulation: 1.0 at spring (new/full), 0.5 at neap (quarter)
  var springFactor = 0.75 + 0.25 * Math.cos(4 * Math.PI * moon.phase);

  var tides = [];
  var stepH = 0.25; // 15-minute resolution
  var totalH = days * 24 + 12; // extra buffer for finding edges
  var lunarOffset = moon.phase * 24;

  // Generate water level curve
  var curve = [];
  for (var i = 0; i <= totalH / stepH; i++) {
    var t = i * stepH - 6;
    curve.push({ t: t, h: tideHeight(t, lunarOffset, regime, maxRange, springFactor) });
  }

  // Find extrema — threshold at 2% of spring-adjusted max range
  var dynThreshold = maxRange * springFactor * 0.02;
  for (var j = 1; j < curve.length - 1; j++) {
    var prev = curve[j - 1].h,
      curr = curve[j].h,
      next = curve[j + 1].h;

    if (curr > prev && curr > next && curr > dynThreshold) {
      tides.push({
        time: new Date(date.getTime() + curve[j].t * 3600000),
        height: Math.round(curr * 100) / 100,
        type: 'high',
      });
    } else if (curr < prev && curr < next && curr < -dynThreshold) {
      tides.push({
        time: new Date(date.getTime() + curve[j].t * 3600000),
        height: Math.round(curr * 100) / 100,
        type: 'low',
      });
    }
  }

  // Deduplicate (min 2.5h between same-type events)
  tides.sort(function (a, b) {
    return a.time - b.time;
  });
  var filtered = [];
  for (var k = 0; k < tides.length; k++) {
    if (filtered.length === 0 || tides[k].time - filtered[filtered.length - 1].time > 2.5 * 3600000) {
      filtered.push(tides[k]);
    }
  }

  return {
    tides: filtered,
    source: 'harmonic',
    stationName: info.station.name,
    stationDistance: info.distanceKm,
    regime: regime,
    maxRange: maxRange,
  };
}

function tideHeight(t, lunarOffset, regime, maxRange, springFactor) {
  var h = 0;
  if (regime === 'diurnal') {
    // K1 (23.93h) + O1 (25.82h): sum amplitude = maxRange at spring
    var k1 = maxRange * 0.55,
      o1 = maxRange * 0.45;
    h =
      k1 * Math.cos(((t - lunarOffset) / 23.93447) * 2 * Math.PI) +
      o1 * Math.cos(((t - lunarOffset - 3) / 25.81934) * 2 * Math.PI);
  } else if (regime === 'semidiurnal') {
    // M2 (12.42h) + S2 (12.00h): sum amplitude = maxRange at spring
    var m2 = maxRange * 0.65,
      s2 = maxRange * 0.35;
    h = m2 * Math.cos(((t - lunarOffset) / 12.4206012) * 2 * Math.PI) + s2 * Math.cos(((t - 12) / 12) * 2 * Math.PI);
  } else {
    var m2a = maxRange * 0.35,
      s2a = maxRange * 0.2;
    var semi =
      m2a * Math.cos(((t - lunarOffset) / 12.4206012) * 2 * Math.PI) + s2a * Math.cos(((t - 12) / 12) * 2 * Math.PI);
    var k1a = maxRange * 0.25,
      o1a = maxRange * 0.2;
    var diur =
      k1a * Math.cos(((t - lunarOffset) / 23.93447) * 2 * Math.PI) +
      o1a * Math.cos(((t - lunarOffset - 3) / 25.81934) * 2 * Math.PI);
    h = semi + diur;
  }
  return h * springFactor;
}

// ─── Public API ───

/**
 * Get tide extremes for a location.
 * Tries backend API first, falls back to local harmonic computation.
 * @param {number} lat
 * @param {number} lon
 * @param {Date} [date] - Reference date (defaults to now)
 * @param {number} [days=3] - Number of days to predict
 * @param {string} [stationName] - Optional: force a specific station name
 * @returns {Promise<{tides: Array<{time:Date, height:number, type:string}>, source:string, ...}>}
 */
export async function getTideExtremes(lat, lon, date, days, stationName) {
  date = date || new Date();
  days = days || 3;

  // Try backend API first
  try {
    var url = BACKEND_TIDE_URL + '?lat=' + lat + '&lon=' + lon + '&days=' + days;
    if (stationName) url += '&station=' + encodeURIComponent(stationName);
    var resp = await fetch(url);
    if (resp.ok) {
      var data = await resp.json();
      if (data && data.tides && data.tides.length) {
        // Convert time strings to Date objects, preserve usingConstants flag
        data.tides = data.tides.map(function (t) {
          return { time: new Date(t.time), height: t.height, type: t.type };
        });
        return data;
      }
    }
  } catch (e) {
    console.warn('Backend tide API unavailable, using local harmonic:', e.message);
  }

  // Fallback: local harmonic computation
  var result = computeHarmonicTides(lat, lon, date, days);
  if (result) {
    // Normalize heights relative to lowest trough so high > low always
    result.tides = _normalizeTideHeights(result.tides);
    return result;
  }

  // No tide data available
  return { tides: [], source: 'none' };
}

function _normalizeTideHeights(tides) {
  if (!tides || tides.length < 2) return tides;
  // Find the global minimum height across ALL tides
  var absMin = Infinity;
  for (var i = 0; i < tides.length; i++) {
    if (tides[i].height < absMin) absMin = tides[i].height;
  }
  if (absMin >= 0) return tides;
  // Shift everything up so the lowest point is at 0.05m
  var shift = Math.abs(absMin) + 0.05;
  for (var j = 0; j < tides.length; j++) {
    tides[j].height = Math.round((tides[j].height + shift) * 100) / 100;
  }
  return tides;
}

/**
 * Get the full tide curve points for chart rendering.
 * Returns [{time: Date, height: number}] at 15-min intervals, normalized to datum.
 */
export function getTideCurve(lat, lon, date, days, stationName) {
  date = date || new Date();
  days = days || 3;

  // Use backend API for accurate published constants
  var url = BACKEND_TIDE_URL + '-curve?lat=' + lat + '&lon=' + lon + '&days=' + days;
  if (stationName) url += '&station=' + encodeURIComponent(stationName);
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('Curve API failed');
      return r.json();
    })
    .then(function (data) {
      if (data && data.points && data.points.length) {
        return data.points.map(function (p) {
          return { time: new Date(p.time), height: p.height };
        });
      }
      return [];
    })
    .catch(function () {
      // Fallback: return empty, chart will just show table data
      return [];
    });
}

/**
 * Get tide station info for a location (without computing full predictions).
 */
export function getTideStationInfo(lat, lon) {
  return getNearestStation(lat, lon);
}

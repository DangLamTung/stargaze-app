/**
 * WeatherSources — all weather data fetchers + METAR station database.
 * Imported by weather-service.js. Each returns { cloudCover, temperature, humidity, windSpeed, visibility } or null.
 */

const METAR_URL = 'https://aviationweather.gov/api/data/metar';

// ─── METAR station database ───
const METAR_STATIONS = [
  { icao: 'VVTS', lat: 10.82, lon: 106.66, name: 'Tan Son Nhat (HCMC)' },
  { icao: 'VVNB', lat: 21.22, lon: 105.81, name: 'Noi Bai (Hanoi)' },
  { icao: 'VVDN', lat: 16.04, lon: 108.2, name: 'Da Nang' },
  { icao: 'VVCR', lat: 11.99, lon: 109.22, name: 'Cam Ranh (Nha Trang)' },
  { icao: 'VVPB', lat: 16.4, lon: 107.7, name: 'Phu Bai (Hue)' },
  { icao: 'VVDL', lat: 11.75, lon: 108.37, name: 'Lien Khuong (Da Lat)' },
  { icao: 'VVPC', lat: 20.87, lon: 106.7, name: 'Cat Bi (Hai Phong)' },
  { icao: 'VVCT', lat: 10.09, lon: 105.71, name: 'Can Tho' },
  { icao: 'VVPQ', lat: 10.23, lon: 103.96, name: 'Phu Quoc' },
  { icao: 'VTBS', lat: 13.69, lon: 100.75, name: 'Suvarnabhumi (Bangkok)' },
  { icao: 'VTCC', lat: 18.77, lon: 98.96, name: 'Chiang Mai' },
  { icao: 'VTSP', lat: 8.11, lon: 98.32, name: 'Phuket' },
  { icao: 'VDPP', lat: 11.55, lon: 104.84, name: 'Phnom Penh' },
  { icao: 'VDSR', lat: 13.41, lon: 103.81, name: 'Siem Reap' },
  { icao: 'VLVT', lat: 17.99, lon: 102.56, name: 'Vientiane' },
  { icao: 'WMKK', lat: 2.75, lon: 101.71, name: 'Kuala Lumpur' },
  { icao: 'WMKP', lat: 5.3, lon: 100.28, name: 'Penang' },
  { icao: 'WSSS', lat: 1.36, lon: 103.99, name: 'Singapore Changi' },
  { icao: 'WIII', lat: -6.13, lon: 106.66, name: 'Jakarta Soekarno-Hatta' },
  { icao: 'WADD', lat: -8.75, lon: 115.17, name: 'Bali Ngurah Rai' },
  { icao: 'RPLL', lat: 14.51, lon: 121.01, name: 'Manila NAIA' },
  { icao: 'RPVM', lat: 10.31, lon: 123.98, name: 'Mactan-Cebu' },
  { icao: 'RJTT', lat: 35.55, lon: 139.78, name: 'Tokyo Haneda' },
  { icao: 'RJBB', lat: 34.43, lon: 135.24, name: 'Osaka Kansai' },
  { icao: 'RKSI', lat: 37.46, lon: 126.44, name: 'Seoul Incheon' },
  { icao: 'ZBAA', lat: 40.08, lon: 116.58, name: 'Beijing Capital' },
  { icao: 'ZSPD', lat: 31.14, lon: 121.81, name: 'Shanghai Pudong' },
  { icao: 'ZGGG', lat: 23.39, lon: 113.3, name: 'Guangzhou Baiyun' },
  { icao: 'VHHH', lat: 22.31, lon: 113.91, name: 'Hong Kong' },
  { icao: 'VIDP', lat: 28.57, lon: 77.1, name: 'Delhi IGI' },
  { icao: 'VABB', lat: 19.09, lon: 72.87, name: 'Mumbai' },
  { icao: 'EGLL', lat: 51.47, lon: -0.46, name: 'London Heathrow' },
  { icao: 'LFPG', lat: 49.01, lon: 2.55, name: 'Paris CDG' },
  { icao: 'EDDF', lat: 50.03, lon: 8.57, name: 'Frankfurt' },
  { icao: 'KJFK', lat: 40.64, lon: -73.78, name: 'New York JFK' },
  { icao: 'KLAX', lat: 33.94, lon: -118.41, name: 'Los Angeles LAX' },
  { icao: 'YSSY', lat: -33.95, lon: 151.18, name: 'Sydney' },
  { icao: 'YMML', lat: -37.67, lon: 144.84, name: 'Melbourne' },
];

// ─── Helpers ───

function findNearestStation(lat, lon, maxKm = 400) {
  let best = null;
  let bestDist = Infinity;
  for (const st of METAR_STATIONS) {
    const dlat = (st.lat - lat) * 111.32;
    const dlon = (st.lon - lon) * (111.32 * Math.cos((lat * Math.PI) / 180));
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < bestDist && dist <= maxKm) {
      bestDist = dist;
      best = st;
    }
  }
  return best;
}

function metarCloudToPct(cloudObjects) {
  if (!cloudObjects || !cloudObjects.length) return { pct: 0, baseFt: null };
  // Check for CAVOK/SKC/CLR
  var covers = cloudObjects.map(c => (c.cover || '').toUpperCase()).join(' ');
  if (/CAVOK|NSC|SKC|CLR/i.test(covers)) return { pct: 0, baseFt: null };
  var maxPct = 0;
  var lowestBase = null;
  for (var i = 0; i < cloudObjects.length; i++) {
    var c = cloudObjects[i];
    var cover = (c.cover || '').slice(0, 3).toUpperCase();
    if (cover === 'FEW') maxPct = Math.max(maxPct, 20);
    else if (cover === 'SCT') maxPct = Math.max(maxPct, 40);
    else if (cover === 'BKN') maxPct = Math.max(maxPct, 70);
    else if (cover === 'OVC') maxPct = Math.max(maxPct, 100);
    // Extract cloud base from the object's 'base' field (feet)
    if (c.base != null && !isNaN(c.base)) {
      var baseFt = parseInt(c.base, 10);
      if (lowestBase === null || baseFt < lowestBase) lowestBase = baseFt;
    }
  }
  return { pct: maxPct, baseFt: lowestBase };
}

// ─── Source fetchers ───

export async function fetchSatelliteCloud(lat, lon) {
  try {
    const res = await fetch(`/api/satellite-cloud?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || data.cloud_pct == null) return null;
    return { cloudCover: data.cloud_pct, temperature: null, humidity: null, windSpeed: null, visibility: null };
  } catch (e) {
    console.warn('Satellite cloud fetch failed:', e);
    return null;
  }
}

export async function fetchMetarCurrent(lat, lon) {
  const station = findNearestStation(lat, lon, 50); // only use if within 50km
  if (!station) return null;
  try {
    const res = await fetch(`/api/metar/?ids=${station.icao}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    const m = data[0];
    const clouds = m.clouds || [];
    const cloudResult = metarCloudToPct(Array.isArray(clouds) ? clouds : []);
    const cloudCover = cloudResult.pct;
    const cloudBaseFt = cloudResult.baseFt;
    const ageMs = Date.now() - m.obsTime * 1000;
    if (ageMs > 2 * 60 * 60 * 1000) return null;
    // Calculate actual distance from user to station
    const dlat = (station.lat - lat) * 111.32;
    const dlon = (station.lon - lon) * (111.32 * Math.cos((lat * Math.PI) / 180));
    const distanceKm = Math.round(Math.sqrt(dlat * dlat + dlon * dlon));
    return {
      cloudCover,
      temperature: m.temp != null ? m.temp : null,
      humidity: null,
      windSpeed: m.wspd != null ? Math.round(m.wspd * 1.852) : null,
      visibility: m.visib != null && !isNaN(m.visib) ? m.visib * 1000 : null,
      cloudBaseFt: cloudBaseFt,
      _meta: { station: station.icao, stationName: station.name, distanceKm },
    };
  } catch (e) {
    console.warn('METAR fetch failed:', e);
    return null;
  }
}

export async function fetchWeatherApiCurrent(lat, lon) {
  try {
    const res = await fetch(`/api/weatherapi/current?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const c = (await res.json()).current;
    if (!c) return null;
    return {
      cloudCover: c.cloud ?? null,
      temperature: c.temp_c ?? null,
      humidity: c.humidity ?? null,
      windSpeed: c.wind_kph != null ? Math.round(c.wind_kph) : null,
      visibility: c.vis_km != null && !isNaN(c.vis_km) ? c.vis_km * 1000 : null,
    };
  } catch (e) {
    console.warn('WeatherAPI fetch failed:', e);
    return null;
  }
}

export async function fetchOwmCurrent(lat, lon) {
  try {
    const res = await fetch(`/api/owm/current?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      cloudCover: data.clouds?.all,
      temperature: data.main?.temp,
      humidity: data.main?.humidity,
      windSpeed: data.wind?.speed != null ? Math.round(data.wind.speed * 3.6) : null,
      visibility: data.visibility ?? null,
    };
  } catch (e) {
    console.warn('OWM fetch failed:', e);
    return null;
  }
}

export async function fetchMetNoCurrent(lat, lon) {
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`, {
      headers: { 'User-Agent': 'StarGaze/1.0 github.com/stargaze' },
    });
    if (!res.ok) return null;
    const now = (await res.json()).properties?.timeseries?.[0];
    if (!now?.data?.instant?.details) return null;
    const d = now.data.instant.details;
    return {
      cloudCover: d.cloud_area_fraction ?? null,
      temperature: d.air_temperature ?? null,
      humidity: d.relative_humidity ?? null,
      windSpeed: d.wind_speed != null ? Math.round(d.wind_speed * 3.6) : null,
      visibility: null,
    };
  } catch (e) {
    console.warn('Met.no fetch failed:', e);
    return null;
  }
}

/**
 * Fetch Met.no hourly forecast (free, no key).
 * Returns array of { time: Date, cloudCover: number } for blending with Open-Meteo.
 */
export async function fetchMetNoForecast(lat, lon) {
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`, {
      headers: { 'User-Agent': 'StarGaze/1.0 github.com/stargaze' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const timeseries = data.properties?.timeseries;
    if (!timeseries?.length) return null;
    return timeseries.map(ts => ({
      time: new Date(ts.time),
      cloudCover: ts.data?.instant?.details?.cloud_area_fraction ?? null,
    }));
  } catch (e) {
    console.warn('Met.no forecast fetch failed:', e);
    return null;
  }
}

/**
 * WeatherAPI.com 3-day hourly forecast (needs API key).
 * Returns array of { time: Date, cloudCover: number }.
 */
export async function fetchWeatherApiForecast(lat, lon) {
  try {
    const res = await fetch(`/api/weatherapi/forecast?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = [];
    for (const day of data.forecast?.forecastday || []) {
      for (const hour of day.hour || []) {
        result.push({ time: new Date(hour.time), cloudCover: hour.cloud ?? null });
      }
    }
    return result.length ? result : null;
  } catch (e) {
    console.warn('WeatherAPI forecast fetch failed:', e);
    return null;
  }
}

/**
 * AccuWeather current conditions — uses backend proxy (set ACCUWEATHER_KEY env var).
 */
export async function fetchAccuWeatherCurrent(lat, lon) {
  try {
    const res = await fetch(`/api/accuweather/current?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const cur = await res.json();
    if (!cur || cur.error) return null;
    return {
      cloudCover: cur.CloudCover ?? null,
      temperature: cur.Temperature?.Metric?.Value ?? null,
      humidity: cur.RelativeHumidity ?? null,
      windSpeed: cur.Wind?.Speed?.Metric?.Value != null ? Math.round(cur.Wind.Speed.Metric.Value) : null,
      visibility: cur.Visibility?.Metric?.Value != null ? cur.Visibility.Metric.Value * 1000 : null,
    };
  } catch (e) {
    console.warn('AccuWeather fetch failed:', e);
    return null;
  }
}

/**
 * Windy.com Point Forecast current snapshot — uses backend proxy (set WINDY_KEY env var).
 */
export async function fetchWindyCurrent(lat, lon) {
  try {
    const res = await fetch(`/api/windy/current?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const cur = await res.json();
    if (!cur || cur.error) return null;
    return {
      cloudCover: cur.cloudCover ?? null,
      cloudCoverLow: cur.cloudCoverLow ?? null,
      cloudCoverMid: cur.cloudCoverMid ?? null,
      cloudCoverHigh: cur.cloudCoverHigh ?? null,
      convectiveClouds: cur.convectiveClouds ?? null,
      temperature: cur.temperature ?? null,
      humidity: cur.humidity ?? null,
      windSpeed: cur.windSpeed ?? null,
      visibility: cur.visibility ?? null,
    };
  } catch (e) {
    console.warn('Windy current fetch failed:', e);
    return null;
  }
}

/**
 * Windy.com Point Forecast timeseries — uses backend proxy (set WINDY_KEY env var).
 * Returns array of { time: Date, cloudCover: number, cloudCoverLow?: number, cloudCoverMid?: number, cloudCoverHigh?: number, temperature?: number, windSpeed?: number, humidity?: number, dewPoint?: number, precip?: number }.
 */
export async function fetchWindyForecast(lat, lon) {
  try {
    const res = await fetch(`/api/windy/forecast?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error || !data.ts || !data['clouds-surface']) return null;

    const result = [];
    const ts = data.ts;
    const clouds = data['clouds-surface'];
    const lclouds = data['lclouds-surface'] || [];
    const mclouds = data['mclouds-surface'] || [];
    const hclouds = data['hclouds-surface'] || [];
    const cclouds = data['cclouds-surface'] || [];
    const temps = data['temp-surface'] || [];
    const winds = data['wind-surface'] || [];
    const rhs = data['rh-surface'] || [];
    const dews = data['dewpoint-surface'] || [];
    const precips = data['precip-surface'] || [];

    for (let i = 0; i < ts.length; i++) {
      if (clouds[i] != null) {
        result.push({
          time: new Date(ts[i]),
          cloudCover: Math.round(clouds[i]),
          cloudCoverLow: lclouds[i] != null ? Math.round(lclouds[i]) : null,
          cloudCoverMid: mclouds[i] != null ? Math.round(mclouds[i]) : null,
          cloudCoverHigh: hclouds[i] != null ? Math.round(hclouds[i]) : null,
          convectiveClouds: cclouds[i] != null ? Math.round(cclouds[i]) : null,
          temperature: temps[i] != null ? Math.round((temps[i] - 273.15) * 10) / 10 : null,
          windSpeed: winds[i] != null ? Math.round(winds[i] * 3.6) : null,
          humidity: rhs[i] != null ? Math.round(rhs[i]) : null,
          dewPoint: dews[i] != null ? Math.round((dews[i] - 273.15) * 10) / 10 : null,
          precip: precips[i] != null ? precips[i] : null,
        });
      }
    }
    return result.length ? result : null;
  } catch (e) {
    console.warn('Windy forecast fetch failed:', e);
    return null;
  }
}

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

function metarCloudToPct(codes) {
  if (!codes || !codes.length) return 0;
  const str = codes.join(' ');
  if (/CAVOK|NSC|SKC|CLR/i.test(str)) return 0;
  let maxPct = 0;
  for (const c of codes) {
    const cover = c.slice(0, 3).toUpperCase();
    if (cover === 'FEW') maxPct = Math.max(maxPct, 20);
    else if (cover === 'SCT') maxPct = Math.max(maxPct, 40);
    else if (cover === 'BKN') maxPct = Math.max(maxPct, 70);
    else if (cover === 'OVC') maxPct = Math.max(maxPct, 100);
  }
  return maxPct;
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
  const station = findNearestStation(lat, lon, 400);
  if (!station) return null;
  try {
    const res = await fetch(`${METAR_URL}?ids=${station.icao}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    const m = data[0];
    const clouds = m.clouds || [];
    const cloudCover = metarCloudToPct(Array.isArray(clouds) ? clouds.map(c => c.cover) : []);
    const ageMs = Date.now() - m.obsTime * 1000;
    if (ageMs > 2 * 60 * 60 * 1000) return null;
    return {
      cloudCover,
      temperature: m.temp != null ? m.temp : null,
      humidity: null,
      windSpeed: m.wspd != null ? Math.round(m.wspd * 1.852) : null,
      visibility: m.visib != null ? m.visib * 1000 : null,
    };
  } catch (e) {
    console.warn('METAR fetch failed:', e);
    return null;
  }
}

export async function fetchWeatherApiCurrent(lat, lon) {
  const key = typeof window !== 'undefined' ? window.STARGAZE_WEATHERAPI_KEY : null;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.weatherapi.com/v1/current.json?key=${key}&q=${lat},${lon}&aqi=no`);
    if (!res.ok) return null;
    const c = (await res.json()).current;
    return {
      cloudCover: c.cloud ?? null,
      temperature: c.temp_c ?? null,
      humidity: c.humidity ?? null,
      windSpeed: c.wind_kph != null ? Math.round(c.wind_kph) : null,
      visibility: c.vis_km != null ? c.vis_km * 1000 : null,
    };
  } catch (e) {
    console.warn('WeatherAPI fetch failed:', e);
    return null;
  }
}

export async function fetchOwmCurrent(lat, lon) {
  const key = typeof window !== 'undefined' ? window.STARGAZE_OWM_KEY : null;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`,
    );
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

export async function fetchWttrCurrent(lat, lon) {
  try {
    const res = await fetch(`https://wttr.in/${lat},${lon}?format=j1`);
    if (!res.ok) return null;
    const cur = (await res.json()).current_condition?.[0];
    if (!cur) return null;
    return {
      cloudCover: cur.cloudcover != null ? parseInt(cur.cloudcover, 10) : null,
      temperature: cur.temp_C != null ? parseFloat(cur.temp_C) : null,
      humidity: cur.humidity != null ? parseInt(cur.humidity, 10) : null,
      windSpeed: cur.windspeedKmph != null ? parseInt(cur.windspeedKmph, 10) : null,
      visibility: cur.visibility != null ? parseInt(cur.visibility, 10) * 1000 : null,
    };
  } catch (e) {
    console.warn('wttr.in fetch failed:', e);
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
  const key = typeof window !== 'undefined' ? window.STARGAZE_WEATHERAPI_KEY : null;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${lat},${lon}&days=3&aqi=no`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = [];
    for (const day of data.forecast?.forecastday || []) {
      for (const hour of day.hour || []) {
        result.push({
          time: new Date(hour.time),
          cloudCover: hour.cloud ?? null,
        });
      }
    }
    return result.length ? result : null;
  } catch (e) {
    console.warn('WeatherAPI forecast fetch failed:', e);
    return null;
  }
}

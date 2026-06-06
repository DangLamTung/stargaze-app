/**
 * WeatherService — fetches, parses, and patches weather from 7 sources.
 * Source fetchers live in ./weather-sources.js.
 */

import {
  fetchSatelliteCloud,
  fetchMetarCurrent,
  fetchWeatherApiCurrent,
  fetchWeatherApiForecast,
  fetchOwmCurrent,
  fetchWttrCurrent,
  fetchMetNoCurrent,
  fetchMetNoForecast,
} from './weather-sources.js';

const BASE_URL = 'https://api.open-meteo.com/v1';

const HOURLY_PARAMS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'apparent_temperature',
  'is_day',
].join(',');

const DAILY_PARAMS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'sunrise',
  'sunset',
  'uv_index_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
].join(',');

const CURRENT_PARAMS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'precipitation',
  'weather_code',
  'is_day',
].join(',');

/** WMO Weather Code descriptions */
const WEATHER_CODES = {
  0: { description: 'Clear sky', icon: '☀️', night: '🌙' },
  1: { description: 'Mainly clear', icon: '🌤️', night: '🌙' },
  2: { description: 'Partly cloudy', icon: '⛅', night: '☁️' },
  3: { description: 'Overcast', icon: '☁️', night: '☁️' },
  45: { description: 'Foggy', icon: '🌫️', night: '🌫️' },
  48: { description: 'Rime fog', icon: '🌫️', night: '🌫️' },
  51: { description: 'Light drizzle', icon: '🌦️', night: '🌧️' },
  53: { description: 'Moderate drizzle', icon: '🌦️', night: '🌧️' },
  55: { description: 'Dense drizzle', icon: '🌦️', night: '🌧️' },
  61: { description: 'Slight rain', icon: '🌧️', night: '🌧️' },
  63: { description: 'Moderate rain', icon: '🌧️', night: '🌧️' },
  65: { description: 'Heavy rain', icon: '🌧️', night: '🌧️' },
  71: { description: 'Slight snow', icon: '🌨️', night: '🌨️' },
  73: { description: 'Moderate snow', icon: '🌨️', night: '🌨️' },
  75: { description: 'Heavy snow', icon: '🌨️', night: '🌨️' },
  77: { description: 'Snow grains', icon: '🌨️', night: '🌨️' },
  80: { description: 'Rain showers', icon: '🌦️', night: '🌧️' },
  81: { description: 'Moderate showers', icon: '🌦️', night: '🌧️' },
  82: { description: 'Violent showers', icon: '🌦️', night: '🌧️' },
  85: { description: 'Snow showers', icon: '🌨️', night: '🌨️' },
  86: { description: 'Heavy snow showers', icon: '🌨️', night: '🌨️' },
  95: { description: 'Thunderstorm', icon: '⛈️', night: '⛈️' },
  96: { description: 'Thunderstorm + hail', icon: '⛈️', night: '⛈️' },
  99: { description: 'Severe thunderstorm', icon: '⛈️', night: '⛈️' },
};

export function getWeatherDescription(code, isNight = false) {
  const w = WEATHER_CODES[code] || { description: 'Unknown', icon: '❓', night: '❓' };
  return { description: w.description, icon: isNight ? w.night : w.icon };
}

/**
 * Search for locations by name
 */
export async function searchLocations(query, count = 8) {
  if (!query || query.trim().length < 2) return [];
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${count}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);
    const data = await res.json();
    return (data.features || []).map(f => {
      const p = f.properties;
      const coords = f.geometry.coordinates; // [lon, lat]
      return {
        id: p.osm_id || Math.random().toString(),
        name: p.name,
        country: p.country || '',
        countryCode: p.countrycode || '',
        admin1: p.state || p.county || '',
        latitude: coords[1],
        longitude: coords[0],
        timezone: 'auto',
        population: 0,
        elevation: 0,
      };
    });
  } catch (err) {
    console.error('Location search failed:', err);
    return [];
  }
}

/**
 * Reverse geocode latitude and longitude to get a location name
 */
export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.address) {
      const name =
        data.address.city ||
        data.address.town ||
        data.address.village ||
        data.address.county ||
        data.address.state ||
        'Selected Location';
      const country = data.address.country || '';
      return { name, country };
    }
    return { name: 'Selected Location', country: '' };
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return { name: 'Selected Location', country: '' };
  }
}

function findNearestHourlyIndex(hourly, time = Date.now()) {
  if (!hourly?.length) return -1;
  let idx = 0;
  let best = Infinity;
  hourly.forEach((h, i) => {
    const diff = Math.abs(h.time - time);
    if (diff < best) {
      best = diff;
      idx = i;
    }
  });
  return idx;
}

function patchCurrentConditions(parsed, patch) {
  if (!patch || !parsed.hourly?.length) return;

  const idx = findNearestHourlyIndex(parsed.hourly);
  if (idx < 0) return;

  const slot = parsed.hourly[idx];
  if (patch.cloudCover != null) slot.cloudCover = patch.cloudCover;
  if (patch.temperature != null) slot.temperature = patch.temperature;
  if (patch.humidity != null) slot.humidity = patch.humidity;
  if (patch.windSpeed != null) slot.windSpeed = patch.windSpeed;
  if (patch.visibility != null) slot.visibility = patch.visibility;

  if (!parsed.current) {
    parsed.current = { ...slot, time: new Date() };
  }
  if (patch.cloudCover != null) parsed.current.cloudCover = patch.cloudCover;
  if (patch.temperature != null) parsed.current.temperature = patch.temperature;
  if (patch.humidity != null) parsed.current.humidity = patch.humidity;
  if (patch.windSpeed != null) parsed.current.windSpeed = patch.windSpeed;
  if (patch.visibility != null) parsed.current.visibility = patch.visibility;
  if (patch.allCloudSources) parsed.current.allCloudSources = patch.allCloudSources;
}

/**
 * Build a live "right now" snapshot using priority fallback.
 *
 * Priority chain (first source with non-null cloudCover wins):
 *   1. METAR          — real airport observation, free, no key
 *   2. WeatherAPI.com — observation-blended global, 1M free calls/mo (needs key)
 *   3. OpenWeatherMap — station + satellite blend (needs key)
 *   4. wttr.in        — public station aggregator, free (reports rain correctly)
 *   5. Satellite IR   — Himawari-8 B13 infrared. Demoted: IR misses warm tropical rain clouds.
 *   6. Met.no         — model nowcast
 *   7. Open-Meteo     — model forecast, last resort
 *
 * Cloud cover is validated against the recent trend.
 */
function buildLivePatch(satData, metarData, weatherapiData, owmData, wttrData, metNoData, parsed) {
  const chain = [
    { label: 'metar', data: metarData },
    { label: 'weatherapi', data: weatherapiData },
    { label: 'owm', data: owmData },
    { label: 'wttr', data: wttrData },
    { label: 'satellite', data: satData },
    { label: 'metno', data: metNoData },
    {
      label: 'open-meteo',
      data: parsed.current
        ? {
            cloudCover: parsed.current.cloudCover,
            humidity: parsed.current.humidity,
            visibility: parsed.current.visibility,
            windSpeed: parsed.current.windSpeed,
            temperature: parsed.current.temperature,
          }
        : null,
    },
  ].filter(s => s.data);

  if (!chain.length) return null;

  const first = key => {
    for (const s of chain) {
      if (s.data[key] != null) return s.data[key];
    }
    return null;
  };

  // Validate cloud cover against recent trend
  let cloudCover = first('cloudCover');
  if (cloudCover != null && parsed.hourly?.length) {
    cloudCover = validateAgainstTrend(cloudCover, parsed.hourly);
  }

  // Rain override: satellite IR (B13) cannot see warm tropical rain clouds.
  // If other sources agree on high cloud/rain but satellite says clear, ignore satellite.
  if (cloudCover != null && chain[0].label === 'satellite' && cloudCover < 30) {
    const nonSatClouds = chain
      .filter(s => s.label !== 'satellite' && s.data.cloudCover != null)
      .map(s => s.data.cloudCover);
    if (nonSatClouds.length >= 2) {
      const avgOther = nonSatClouds.reduce((a, b) => a + b, 0) / nonSatClouds.length;
      if (avgOther > 60) {
        cloudCover = Math.round(avgOther);
        chain[0].label = chain[1]?.label || 'wttr';
      }
    }
  }

  // Collect all source cloud values for consensus display
  const allSources = {};
  for (const s of chain) {
    if (s.data.cloudCover != null) {
      allSources[s.label] = s.data.cloudCover;
    }
  }

  return {
    cloudCover,
    temperature: first('temperature'),
    humidity: first('humidity'),
    windSpeed: first('windSpeed'),
    visibility: first('visibility'),
    source: chain[0].label,
    allCloudSources: allSources,
  };
}

/**
 * Cloud cover is continuous — it doesn't jump from clear to overcast instantly.
 * Models tend to overestimate clouds; sudden clearing is usually real.
 *
 * Only cap UPWARD jumps: if live says 100% but trend says 0-20%, cap it.
 * Downward jumps (live says 0% while trend says 80%) are trusted —
 * the model was probably wrong all along and the live observation is correct.
 */
function validateAgainstTrend(liveCloud, hourly, lookbackHours = 4, maxJump = 35) {
  const now = Date.now();
  const cutoff = now - lookbackHours * 60 * 60 * 1000;

  const recent = [];
  for (const h of hourly) {
    const t = h.time.getTime();
    if (t >= cutoff && t <= now && h.cloudCover != null) {
      recent.push(h.cloudCover);
    }
  }

  if (recent.length < 2) return liveCloud;

  // Median of recent observations
  const sorted = [...recent].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // Only cap if live is suspiciously HIGHER than recent trend.
  // If live is lower (clearing), trust it — models overestimate clouds.
  if (liveCloud > median + maxJump) {
    return Math.round(Math.min(100, median + maxJump));
  }

  return liveCloud;
}

/**
 * Blend multiple forecast sources into Open-Meteo hourly cloud data.
 * Sources are matched to the nearest hour (±30 min tolerance).
 * Weights: Open-Meteo 2×, WeatherAPI 2×, Met.no 1×
 */
function blendForecastClouds(hourly, metNoTimeseries, wapiTimeseries) {
  if (!hourly?.length) return;
  const sources = [
    { data: metNoTimeseries, weight: 1 },
    { data: wapiTimeseries, weight: 2 },
  ].filter(s => s.data?.length);

  if (!sources.length) return;

  for (const h of hourly) {
    const t = h.time.getTime();
    if (h.cloudCover == null) continue;

    let weightedSum = h.cloudCover * 2; // Open-Meteo base weight
    let totalWeight = 2;

    for (const src of sources) {
      let best = null;
      let bestDiff = Infinity;
      for (const entry of src.data) {
        const diff = Math.abs(entry.time.getTime() - t);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = entry;
        }
      }
      if (best && bestDiff < 30 * 60 * 1000 && best.cloudCover != null) {
        weightedSum += best.cloudCover * src.weight;
        totalWeight += src.weight;
      }
    }

    h.cloudCover = Math.round(weightedSum / totalWeight);
  }
}

/** Return the best available snapshot for "right now". */
export function getCurrentConditions(weatherData) {
  if (weatherData?.current) return weatherData.current;
  if (!weatherData?.hourly?.length) return null;
  const now = Date.now();
  return weatherData.hourly.reduce((closest, h) =>
    Math.abs(h.time - now) < Math.abs(closest.time - now) ? h : closest,
  );
}

/**
 * Fetch combined weather data: past 7 days + next 7 days
 */
export async function getWeatherData(lat, lon, timezone = 'auto') {
  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);
  if (isNaN(numLat) || isNaN(numLon) || numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) {
    throw new Error('Invalid lat lng');
  }

  const url =
    `${BASE_URL}/forecast?` +
    new URLSearchParams({
      latitude: numLat,
      longitude: numLon,
      hourly: HOURLY_PARAMS,
      daily: DAILY_PARAMS,
      current: CURRENT_PARAMS,
      past_days: 7,
      forecast_days: 7,
      timezone: timezone,
      models: 'best_match',
    });
  try {
    const [weatherRes, satData, metarData, weatherapiData, owmData, wttrData, metNoData, metNoForecast, wapiForecast] =
      await Promise.all([
        fetch(url),
        fetchSatelliteCloud(numLat, numLon),
        fetchMetarCurrent(numLat, numLon),
        fetchWeatherApiCurrent(numLat, numLon),
        fetchOwmCurrent(numLat, numLon),
        fetchWttrCurrent(numLat, numLon),
        fetchMetNoCurrent(numLat, numLon),
        fetchMetNoForecast(numLat, numLon),
        fetchWeatherApiForecast(numLat, numLon),
      ]);
    if (!weatherRes.ok) throw new Error(`Weather API error: ${weatherRes.status}`);
    const weatherJson = await weatherRes.json();

    const parsed = parseWeatherData(weatherJson);

    // Blend multiple forecast sources into Open-Meteo hourly data
    blendForecastClouds(parsed.hourly, metNoForecast, wapiForecast);

    const livePatch = buildLivePatch(satData, metarData, weatherapiData, owmData, wttrData, metNoData, parsed);

    if (livePatch) {
      patchCurrentConditions(parsed, livePatch);
    }

    return parsed;
  } catch (err) {
    console.error('Weather fetch failed:', err);
    throw err;
  }
}

export function parseWeatherData(raw) {
  const hourly = (raw.hourly?.time || []).map((t, i) => ({
    time: new Date(t),
    temperature: raw.hourly.temperature_2m?.[i],
    apparentTemp: raw.hourly.apparent_temperature?.[i],
    humidity: raw.hourly.relative_humidity_2m?.[i],
    dewPoint: raw.hourly.dew_point_2m?.[i],
    cloudCover: raw.hourly.cloud_cover?.[i],
    cloudCoverLow: raw.hourly.cloud_cover_low?.[i],
    cloudCoverMid: raw.hourly.cloud_cover_mid?.[i],
    cloudCoverHigh: raw.hourly.cloud_cover_high?.[i],
    visibility: raw.hourly.visibility?.[i],
    windSpeed: raw.hourly.wind_speed_10m?.[i],
    windDirection: raw.hourly.wind_direction_10m?.[i],
    precipProbability: raw.hourly.precipitation_probability?.[i],
    precipitation: raw.hourly.precipitation?.[i],
    weatherCode: raw.hourly.weather_code?.[i],
    isDaytime: raw.hourly.is_day?.[i] === 1,
  }));

  const daily = (raw.daily?.time || []).map((t, i) => {
    const d = {
      date: t,
      weatherCode: raw.daily.weather_code?.[i],
      tempMax: raw.daily.temperature_2m_max?.[i],
      tempMin: raw.daily.temperature_2m_min?.[i],
      sunrise: raw.daily.sunrise?.[i],
      sunset: raw.daily.sunset?.[i],
      uvIndexMax: raw.daily.uv_index_max?.[i],
      precipSum: raw.daily.precipitation_sum?.[i],
      precipProbMax: raw.daily.precipitation_probability_max?.[i],
      windSpeedMax: raw.daily.wind_speed_10m_max?.[i],
    };
    d.moonPhase = calculateMoonPhase(new Date(t));
    d.moonPhaseName = getMoonPhaseName(d.moonPhase);
    d.moonPhaseIcon = getMoonPhaseIcon(d.moonPhase);
    return d;
  });

  let current = null;
  if (raw.current?.time) {
    current = {
      time: new Date(raw.current.time),
      temperature: raw.current.temperature_2m,
      apparentTemp: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      cloudCover: raw.current.cloud_cover,
      visibility: raw.current.visibility,
      windSpeed: raw.current.wind_speed_10m,
      windDirection: raw.current.wind_direction_10m,
      precipitation: raw.current.precipitation,
      weatherCode: raw.current.weather_code,
      isDay: raw.current.is_day,
    };
  }

  return {
    hourly,
    daily,
    current,
    timezone: raw.timezone,
    timezoneAbbr: raw.timezone_abbreviation,
    latitude: raw.latitude,
    longitude: raw.longitude,
    elevation: raw.elevation,
  };
}

/** Calculate moon phase (0=new, 0.5=full, 1=new) */
export function calculateMoonPhase(date) {
  const knownNew = new Date('2000-01-06T18:14:00Z');
  const synodic = 29.53058770576;
  const days = (date.getTime() - knownNew.getTime()) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  return phase / synodic;
}

export function getMoonPhaseName(p) {
  if (p < 0.0625 || p >= 0.9375) return 'New Moon';
  if (p < 0.1875) return 'Waxing Crescent';
  if (p < 0.3125) return 'First Quarter';
  if (p < 0.4375) return 'Waxing Gibbous';
  if (p < 0.5625) return 'Full Moon';
  if (p < 0.6875) return 'Waning Gibbous';
  if (p < 0.8125) return 'Last Quarter';
  return 'Waning Crescent';
}

export function getMoonPhaseIcon(p) {
  if (p < 0.0625 || p >= 0.9375) return '🌑';
  if (p < 0.1875) return '🌒';
  if (p < 0.3125) return '🌓';
  if (p < 0.4375) return '🌔';
  if (p < 0.5625) return '🌕';
  if (p < 0.6875) return '🌖';
  if (p < 0.8125) return '🌗';
  return '🌘';
}

/** Moon illumination percentage */
export function getMoonIllumination(phase) {
  return Math.round(((1 - Math.cos(phase * 2 * Math.PI)) / 2) * 100);
}

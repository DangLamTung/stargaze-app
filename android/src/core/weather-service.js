/**
 * WeatherService — Open-Meteo API wrapper
 * 
 * Reusable module for fetching weather data.
 * No API key required. Works in browser & React Native.
 * Data source: ECMWF, NOAA, DWD via Open-Meteo
 */

const BASE_URL = 'https://api.open-meteo.com/v1';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1';

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
      const name = data.address.city || data.address.town || data.address.village || data.address.county || data.address.state || 'Selected Location';
      const country = data.address.country || '';
      return { name, country };
    }
    return { name: 'Selected Location', country: '' };
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return { name: 'Selected Location', country: '' };
  }
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

  const url = `${BASE_URL}/forecast?` + new URLSearchParams({
    latitude: numLat, longitude: numLon,
    hourly: HOURLY_PARAMS, daily: DAILY_PARAMS,
    past_days: 7, forecast_days: 7,
    timezone: timezone,
    models: 'best_match' // Uses Open-Meteo seamless AI models (ECMWF AIFS, GraphCast, etc)
  });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    return parseWeatherData(await res.json());
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

  return {
    hourly, daily,
    timezone: raw.timezone,
    timezoneAbbr: raw.timezone_abbreviation,
    latitude: raw.latitude, longitude: raw.longitude,
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
  return Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);
}

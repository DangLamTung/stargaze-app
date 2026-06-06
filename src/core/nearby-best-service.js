/**
 * Nearby Best Place Service
 * Finds cities/provinces within a radius and scores them for stargazing.
 */

import { parseWeatherData } from './weather-service.js';
import { calculateAllScores, findBestNight } from './stargazing-score.js';

const WEATHER_BASE = 'https://api.open-meteo.com/v1';

/**
 * Find nearby places — queries backend Overpass + GeoNames.
 * Falls back to current location on failure so UI still works.
 */
export async function searchNearbyPlaces(lat, lon, radiusKm, country = null) {
  let url = `/api/nearby?lat=${lat}&lon=${lon}&radius=${radiusKm}`;
  if (country) url += `&country=${encodeURIComponent(country)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Backend error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Nearby search failed:', err);
    return [{ id: 'current', name: 'Current Search Location', latitude: lat, longitude: lon, distance: 0 }];
  }
}

/**
 * Fetch weather data for multiple locations simultaneously.
 * Splits into batches of 50 to avoid URL length limits.
 */
export async function getBatchWeatherData(places, timezone = 'auto') {
  if (!places.length) return [];

  const BATCH_SIZE = 50;
  const results = [];

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const lats = batch.map(p => p.latitude).join(',');
    const lons = batch.map(p => p.longitude).join(',');

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

    const url =
      `${WEATHER_BASE}/forecast?` +
      new URLSearchParams({
        latitude: lats,
        longitude: lons,
        hourly: HOURLY_PARAMS,
        daily: DAILY_PARAMS,
        past_days: 0,
        forecast_days: 7,
        timezone: timezone,
      });

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
      const rawData = await res.json();

      // If only 1 place, Open-Meteo returns an object, not an array
      const dataArray = Array.isArray(rawData) ? rawData : [rawData];
      results.push(...dataArray.map(raw => parseWeatherData(raw)));
    } catch (err) {
      console.error(`Batch weather fetch failed (batch ${i / BATCH_SIZE + 1}):`, err);
      // Fill failed batch with nulls so indices stay aligned
      results.push(...batch.map(() => null));
    }
  }

  return results;
}

/**
 * Rank locations by their best night's score
 */
export function rankBestLocations(places, weatherDataArray) {
  return places
    .map((place, i) => {
      const data = weatherDataArray[i];
      if (!data) return null;

      let bortle = 4;
      const p = place.population;
      if (p > 1000000) bortle = 9;
      else if (p > 300000) bortle = 8;
      else if (p > 100000) bortle = 7;
      else if (p > 30000) bortle = 6;
      else if (p > 10000) bortle = 5;
      else if (p > 2000) bortle = 4;
      else if (p > 500) bortle = 3;
      else if (p > 0) bortle = 2;
      else {
        if (place.type === 'city') bortle = 8;
        else if (place.type === 'town') bortle = 5;
        else if (place.type === 'village') bortle = 3;
        else if (place.type === 'hamlet') bortle = 2;
      }

      const scores = calculateAllScores(data, bortle);
      const bestNight = findBestNight(scores);
      return { place, bestNight, scores, bortle };
    })
    .filter(r => r && r.bestNight != null)
    .sort((a, b) => {
      if (b.bestNight.score !== a.bestNight.score) {
        return b.bestNight.score - a.bestNight.score;
      }
      return a.place.distance - b.place.distance;
    });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

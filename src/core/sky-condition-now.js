/**
 * SkyConditionNow — Real-time sky condition scoring & cloud trend prediction
 *
 * Computes:
 * 1. "Right Now" stargazing score based on current hour's conditions
 * 2. Cloud cover trend from past N hours via linear regression
 * 3. Predicted cloud cover for the next few hours
 * 4. Auto-refresh polling to keep predictions fresh
 */

import { calculateHourlyScore, getScoreRating, getScoreColor } from './stargazing-score.js';
import { buildSkyQualityReport } from './sky-quality.js';

// ─── Exponential smoothing (recency-weighted average) ───
// Gives more weight to recent observations — "soft" pattern matching
function expSmoothPredict(values, alpha = 0.5) {
  if (!values.length) return 50;
  // Weighted: most recent = alpha, previous = alpha*(1-alpha), etc.
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < values.length; i++) {
    const w = Math.pow(1 - alpha, values.length - 1 - i);
    weightedSum += values[i] * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : values[values.length - 1];
}

// ─── Linear Regression ───
function linearRegression(points) {
  // points: [{ x: number, y: number }, ...]
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 50, r2: 0 };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const yMean = sumY / n;
  const ssTot = sumY2 - n * yMean * yMean;
  const ssRes = points.reduce((s, p) => {
    const pred = slope * p.x + intercept;
    return s + (p.y - pred) * (p.y - pred);
  }, 0);
  const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

// ─── Trend Analysis ───
export function analyzeCloudTrend(hourlyData, lookbackHours = 6) {
  if (!hourlyData || hourlyData.length < 2) {
    return { slope: 0, trend: 'stable', confidence: 0, predicted: null, pastPoints: [] };
  }

  const now = Date.now();
  const lookbackMs = lookbackHours * 60 * 60 * 1000;

  // Collect past cloud cover points within lookback window
  const pastPoints = [];
  for (const h of hourlyData) {
    const t = h.time.getTime();
    if (t >= now - lookbackMs && t <= now) {
      pastPoints.push({ x: t / 3600000, y: h.cloudCover ?? 50 });
    }
  }

  if (pastPoints.length < 2) {
    return { slope: 0, trend: 'stable', confidence: 0, predicted: null, pastPoints };
  }

  const { slope, intercept, r2 } = linearRegression(pastPoints);

  // slope is % cloud change per hour
  let trend = 'stable';
  if (slope > 2.0) trend = 'worsening';
  else if (slope > 0.5) trend = 'slightly-worsening';
  else if (slope < -2.0) trend = 'improving';
  else if (slope < -0.5) trend = 'slightly-improving';

  // Predict next 3 hours using exponential smoothing + linear trend
  const nowH = now / 3600000;
  const recentWeighted = expSmoothPredict(pastPoints.map(p => p.y));
  const predicted = [1, 2, 3].map(h => {
    const linPred = Math.max(0, Math.min(100, slope * (nowH + h) + intercept));
    const expPred = recentWeighted;
    const blend =
      h === 1 ? expPred * 0.7 + linPred * 0.3 : h === 2 ? expPred * 0.5 + linPred * 0.5 : expPred * 0.3 + linPred * 0.7;
    return { hoursAhead: h, cloudCover: Math.round(blend) };
  });

  return { slope, trend, confidence: Math.round(r2 * 100), predicted, pastPoints };
}

// ─── Now Score ───
export function getNowScore(weatherData, bortleClass = 7) {
  if (!weatherData?.hourly?.length) return null;

  const now = Date.now();

  // Find the nearest hourly slot
  let bestHour = weatherData.hourly[0];
  let bestDiff = Infinity;
  for (const h of weatherData.hourly) {
    const diff = Math.abs(h.time.getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestHour = h;
    }
  }

  // Merge live current conditions (already averaged from multiple sources)
  const hourData = { ...bestHour };
  const cur = weatherData.current;
  if (cur) {
    if (cur.cloudCover != null) hourData.cloudCover = cur.cloudCover;
    if (cur.humidity != null) hourData.humidity = cur.humidity;
    if (cur.visibility != null) hourData.visibility = cur.visibility;
    if (cur.windSpeed != null) hourData.windSpeed = cur.windSpeed;
    if (cur.cloudBaseFt != null) hourData.cloudBaseFt = cur.cloudBaseFt;
  }

  // Derive moon phase from today's daily entry
  const todayStr = new Date().toISOString().split('T')[0];
  const todayDay = weatherData.daily?.find(d => d.date === todayStr);
  const effectivePhase = todayDay?.moonPhase ?? 0.5;

  const score = calculateHourlyScore(hourData, effectivePhase, bortleClass);
  const trend = analyzeCloudTrend(weatherData.hourly, 6);

  // Augment predicted hours with actual data from nearest hourly slots and compute scores
  if (trend.predicted && weatherData.hourly) {
    var nowTs = Date.now();
    var todayStr2 = new Date().toISOString().split('T')[0];
    var todayDay2 = weatherData.daily?.find(d => d.date === todayStr2);
    var moonPhaseForScore = todayDay2?.moonPhase ?? 0.5;
    trend.predicted = trend.predicted.map(function (p) {
      var targetTs = nowTs + p.hoursAhead * 3600000;
      var nearest = null,
        bestDiff = Infinity;
      for (var h = 0; h < weatherData.hourly.length; h++) {
        var d = Math.abs(weatherData.hourly[h].time.getTime() - targetTs);
        if (d < bestDiff) {
          bestDiff = d;
          nearest = weatherData.hourly[h];
        }
      }
      var result = { hoursAhead: p.hoursAhead, cloudCover: p.cloudCover };
      if (nearest && bestDiff < 90 * 60000) {
        result.cloudCoverLow = nearest.cloudCoverLow;
        result.cloudCoverMid = nearest.cloudCoverMid;
        result.cloudCoverHigh = nearest.cloudCoverHigh;
        result.humidity = nearest.humidity;
        result.temperature = nearest.temperature;
        result.precipProbability = nearest.precipProbability;
        result.windSpeed = nearest.windSpeed;
        result.visibility = nearest.visibility;
        result.weatherCode = nearest.weatherCode;
        result.isDay = nearest.isDay;
        // Compute stargazing score for this slot
        result.score = calculateHourlyScore(nearest, moonPhaseForScore, bortleClass);
        result.rating = getScoreRating(result.score);
      }
      return result;
    });
  }

  // Build advanced sky quality report
  const skyQuality = buildSkyQualityReport({
    pm25: hourData.pm25,
    wind200hPa: hourData.wind200hPa,
    wind850hPa: hourData.wind850hPa,
    moonPhase: effectivePhase,
    moonAltDeg: -90, // approximate — actual moon position requires more complex calc
    dewPointC: hourData.dewPoint,
    cloudCoverHigh: hourData.cloudCoverHigh,
    cloudCoverTotal: hourData.cloudCover,
    elevationM: weatherData.elevation || 0,
  });

  return {
    score,
    rating: getScoreRating(score),
    ratingColor: getScoreColor(score),
    cloudCover: hourData.cloudCover ?? null,
    cloudCoverLow: hourData.cloudCoverLow ?? null,
    cloudCoverMid: hourData.cloudCoverMid ?? null,
    cloudCoverHigh: hourData.cloudCoverHigh ?? null,
    pm25: hourData.pm25 ?? null,
    humidity: hourData.humidity ?? null,
    visibility: hourData.visibility ?? null,
    windSpeed: hourData.windSpeed ?? null,
    temperature: hourData.temperature ?? null,
    weatherCode: hourData.weatherCode ?? null,
    isDaytime: hourData.isDaytime,
    time: bestHour.time,
    trend,
    // Tier 2 advanced metrics
    skyQuality,
  };
}

// ─── Trend Formatting ───
export function getTrendIcon(trend) {
  switch (trend) {
    case 'improving':
      return '📈☀️';
    case 'slightly-improving':
      return '📈';
    case 'worsening':
      return '📉☁️';
    case 'slightly-worsening':
      return '📉';
    default:
      return '➡️';
  }
}

export function getTrendLabel(trend) {
  switch (trend) {
    case 'improving':
      return 'Clearing up quickly';
    case 'slightly-improving':
      return 'Slowly clearing';
    case 'worsening':
      return 'Clouding over';
    case 'slightly-worsening':
      return 'Slightly worsening';
    default:
      return 'Stable conditions';
  }
}

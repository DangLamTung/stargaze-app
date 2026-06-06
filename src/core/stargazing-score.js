/**
 * StargazingScorer — Stargazing quality scoring algorithm
 *
 * Cloud cover is the primary weather factor for stargazing.
 * Bortle and moon still matter, but clear skies should score well.
 */

const WEIGHTS = {
  bortle: 0.15,
  cloudCover: 0.45,
  moonPhase: 0.2,
  humidity: 0.08,
  visibility: 0.07,
  precipitation: 0.05,
};

function scoreCloud(pct) {
  if (pct == null) return 50;
  return Math.max(0, Math.min(100, 100 - pct));
}

function scoreMoonPhase(phase) {
  return 100 - phase * 100;
}

function scoreBortle(bortleClass) {
  return Math.max(0, 100 - (bortleClass - 1) * 12.5);
}

function scoreHumidity(h) {
  if (h == null) return 50;
  if (h <= 40) return 100;
  if (h >= 90) return 0;
  return ((90 - h) / 50) * 100;
}

function scoreVisibility(v) {
  if (v == null) return 50;
  if (v >= 24000) return 100;
  if (v <= 1000) return 0;
  return ((v - 1000) / 23000) * 100;
}

function scorePrecip(p) {
  if (p == null) return 75;
  if (p <= 0) return 100;
  if (p >= 50) return 0;
  return ((50 - p) / 50) * 100;
}

export function calculateHourlyScore(hourData, moonPhase, bortleClass = 5) {
  if (!hourData) return 0;

  const cloudPct = hourData.cloudCover ?? 50;

  const scores = {
    bortle: scoreBortle(bortleClass),
    cloudCover: scoreCloud(hourData.cloudCover),
    moonPhase: scoreMoonPhase(moonPhase),
    humidity: scoreHumidity(hourData.humidity),
    visibility: scoreVisibility(hourData.visibility),
    precipitation: scorePrecip(hourData.precipProbability),
  };

  let totalScore = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    totalScore += scores[key] * weight;
  }

  // Heavy cloud / rain penalties only when skies are actually cloudy
  if (cloudPct > 80) totalScore *= 0.35;
  else if (cloudPct > 60) totalScore *= 0.65;

  const precip = hourData.precipProbability ?? 0;
  if (precip > 50 && cloudPct > 40) totalScore *= 0.25;
  else if (precip > 30 && cloudPct > 55) totalScore *= 0.5;

  // Clear skies should not be dragged down by model rain probability alone
  if (hourData.cloudCover != null && hourData.cloudCover <= 15) {
    const clearBase =
      scores.cloudCover * WEIGHTS.cloudCover +
      scores.moonPhase * WEIGHTS.moonPhase +
      scores.bortle * WEIGHTS.bortle +
      scores.humidity * WEIGHTS.humidity +
      scores.visibility * WEIGHTS.visibility +
      scores.precipitation * WEIGHTS.precipitation;
    totalScore = Math.max(totalScore, clearBase);
  }

  return Math.round(Math.max(0, Math.min(100, totalScore)));
}

/**
 * Bias-correct model cloud forecast using actual observed cloud cover.
 * If satellite/METAR says 5% but the model says 100% now,
 * shift ALL future hours down by ~95% so the forecast tracks reality.
 */
function applyCloudBias(hourly, observedPct) {
  if (observedPct == null || !hourly?.length) return hourly;

  const now = Date.now();
  let modelNow = null;
  let bestDiff = Infinity;
  for (const h of hourly) {
    const diff = Math.abs(h.time.getTime() - now);
    if (diff < bestDiff && h.cloudCover != null) {
      bestDiff = diff;
      modelNow = h;
    }
  }
  if (!modelNow || bestDiff > 2 * 60 * 60 * 1000) return hourly; // skip if stale

  const bias = observedPct - modelNow.cloudCover;
  if (Math.abs(bias) < 15) return hourly; // skip if model is close enough

  // Decay bias over time — bias matters most for near-term, less for day 7
  const biasDecayHours = 72; // bias fully decays after 72 hours
  return hourly.map(h => {
    if (h.cloudCover == null) return h;
    const hoursAhead = Math.max(0, (h.time.getTime() - now) / 3600000);
    const decay = Math.max(0, 1 - hoursAhead / biasDecayHours);
    const corrected = h.cloudCover + bias * decay;
    return { ...h, cloudCover: Math.round(Math.max(0, Math.min(100, corrected))) };
  });
}

function getNightHours(hourly, sunset, sunrise) {
  const t0 = new Date(sunset).getTime();
  const t1 = new Date(sunrise).getTime();
  return hourly.filter(h => {
    const t = h.time.getTime();
    return t >= t0 && t <= t1 && !h.isDaytime;
  });
}

const avg = (arr, key) => {
  const vals = arr.map(h => h[key]).filter(v => v != null && v !== undefined);
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
};

export function calculateAllScores(weatherData, bortleClass = 5, observedCloudPct = null) {
  const { hourly, daily } = weatherData;

  // Bias-correct the forecast: if we know the actual cloud cover now,
  // shift the entire model forecast by the same bias.
  // Fixes the case where model says 100% but satellite says 5%.
  const correctedHourly = applyCloudBias(hourly, observedCloudPct);

  const scores = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < daily.length - 1; i++) {
    const day = daily[i];
    const next = daily[i + 1];
    const dayDate = new Date(day.date);

    if (dayDate < today && dayDate.toDateString() !== today.toDateString()) continue;
    if (!day.sunset || !next.sunrise) continue;

    const nightHrs = getNightHours(correctedHourly, day.sunset, next.sunrise);
    if (!nightHrs.length) continue;

    const hourlyScores = nightHrs.map(h => calculateHourlyScore(h, day.moonPhase, bortleClass));
    const bestIdx = hourlyScores.indexOf(Math.max(...hourlyScores));
    const avgScore = Math.round(hourlyScores.reduce((s, v) => s + v, 0) / hourlyScores.length);
    const bestScore = hourlyScores[bestIdx] || avgScore;
    const avgCloud = avg(nightHrs, 'cloudCover');

    // When skies are clear, reflect the best viewing window — not a noisy model average
    const displayScore = avgCloud != null && avgCloud <= 20 ? Math.max(avgScore, bestScore) : avgScore;

    scores.push({
      date: day.date,
      dayOfWeek: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
      dayOfMonth: dayDate.getDate(),
      month: dayDate.toLocaleDateString('en-US', { month: 'short' }),
      score: displayScore,
      rating: getScoreRating(displayScore),
      ratingColor: getScoreColor(displayScore),

      cloudCoverScore: scoreCloud(avgCloud),
      moonPhaseScore: scoreMoonPhase(day.moonPhase),
      humidityScore: scoreHumidity(avg(nightHrs, 'humidity')),
      visibilityScore: scoreVisibility(avg(nightHrs, 'visibility')),
      precipScore: scorePrecip(avg(nightHrs, 'precipProbability')),

      avgCloudCover: avgCloud,
      avgHumidity: avg(nightHrs, 'humidity'),
      avgVisibility: avg(nightHrs, 'visibility'),
      avgPrecipProb: avg(nightHrs, 'precipProbability'),
      avgWindSpeed: avg(nightHrs, 'windSpeed'),

      moonPhase: day.moonPhase,
      moonPhaseName: day.moonPhaseName,
      moonPhaseIcon: day.moonPhaseIcon,

      weatherCode: day.weatherCode,
      tempMax: day.tempMax,
      tempMin: day.tempMin,
      sunset: day.sunset,
      sunrise: next.sunrise,

      bestViewingTime: nightHrs[bestIdx]?.time || null,
      bestViewingScore: bestScore,

      hourlyScores: nightHrs.map((h, idx) => ({
        time: h.time,
        score: hourlyScores[idx],
        cloudCover: h.cloudCover,
        cloudCoverLow: h.cloudCoverLow,
        cloudCoverMid: h.cloudCoverMid,
        cloudCoverHigh: h.cloudCoverHigh,
        humidity: h.humidity,
        visibility: h.visibility,
      })),
    });
  }
  return scores;
}

export function findBestNight(scores) {
  if (!scores.length) return null;
  return scores.reduce((best, n) => (n.score > best.score ? n : best));
}

export function getScoreRating(s) {
  if (s >= 80) return 'Excellent';
  if (s >= 60) return 'Good';
  if (s >= 40) return 'Fair';
  if (s >= 20) return 'Poor';
  return 'Bad';
}

export function getScoreColor(s) {
  if (s >= 80) return '#00e676';
  if (s >= 60) return '#76ff03';
  if (s >= 40) return '#ffea00';
  if (s >= 20) return '#ff9100';
  return '#ff1744';
}

export function getScoreGradient(s) {
  if (s >= 80) return ['#00e676', '#00bcd4'];
  if (s >= 60) return ['#76ff03', '#00e676'];
  if (s >= 40) return ['#ffea00', '#ff9100'];
  if (s >= 20) return ['#ff9100', '#ff5722'];
  return ['#ff5722', '#ff1744'];
}

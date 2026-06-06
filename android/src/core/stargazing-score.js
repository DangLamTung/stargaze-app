/**
 * StargazingScorer — Stargazing quality scoring algorithm
 * 
 * Reusable module. No DOM dependencies.
 * Weighted scoring: bortle(20%) + cloud(35%) + moon(20%) + humidity(10%) + visibility(10%) + precip(5%)
 */

const WEIGHTS = {
  bortle: 0.20,
  cloudCover: 0.35,
  moonPhase: 0.20,
  humidity: 0.10,
  visibility: 0.10,
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
  return Math.max(0, 100 - ((bortleClass - 1) * 12.5));
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
  if (!hourData || hourData.isDaytime) return 0;

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

  // Heavy penalties
  if (hourData.cloudCover > 80) totalScore *= 0.3;
  if (hourData.precipProbability > 50) totalScore *= 0.1;

  return Math.round(Math.max(0, Math.min(100, totalScore)));
}

function getNightHours(hourly, sunset, sunrise) {
  const t0 = new Date(sunset).getTime();
  const t1 = new Date(sunrise).getTime();
  return hourly.filter(h => h.time.getTime() >= t0 && h.time.getTime() <= t1);
}

const avg = (arr, key) => {
  const vals = arr.map(h => h[key]).filter(v => v != null);
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
};

export function calculateAllScores(weatherData, bortleClass = 5) {
  const { hourly, daily } = weatherData;
  const scores = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < daily.length - 1; i++) {
    const day = daily[i];
    const next = daily[i + 1];
    const dayDate = new Date(day.date);

    if (dayDate < today && dayDate.toDateString() !== today.toDateString()) continue;
    if (!day.sunset || !next.sunrise) continue;

    const nightHrs = getNightHours(hourly, day.sunset, next.sunrise);
    if (!nightHrs.length) continue;

    const hourlyScores = nightHrs.map(h => calculateHourlyScore(h, day.moonPhase, bortleClass));
    const avgScore = Math.round(hourlyScores.reduce((s, v) => s + v, 0) / hourlyScores.length);

    const bestIdx = hourlyScores.indexOf(Math.max(...hourlyScores));

    scores.push({
      date: day.date,
      dayOfWeek: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
      dayOfMonth: dayDate.getDate(),
      month: dayDate.toLocaleDateString('en-US', { month: 'short' }),
      score: avgScore,
      rating: getScoreRating(avgScore),
      ratingColor: getScoreColor(avgScore),

      cloudCoverScore: scoreCloud(avg(nightHrs, 'cloudCover')),
      moonPhaseScore: scoreMoonPhase(day.moonPhase),
      humidityScore: scoreHumidity(avg(nightHrs, 'humidity')),
      visibilityScore: scoreVisibility(avg(nightHrs, 'visibility')),
      precipScore: scorePrecip(avg(nightHrs, 'precipProbability')),

      avgCloudCover: avg(nightHrs, 'cloudCover'),
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
      bestViewingScore: hourlyScores[bestIdx] || avgScore,

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
  return scores.reduce((best, n) => n.score > best.score ? n : best);
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

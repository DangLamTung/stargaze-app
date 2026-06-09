package com.stargaze.app.domain.scorer

import com.stargaze.app.data.model.*
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Port of stargazing-score.js.
 * Weights: cloud(0.45) + moon(0.20) + bortle(0.15) + humidity(0.08) + vis(0.07) + precip(0.05)
 */
object StargazingScorer {

    private data class Weights(
        val bortle: Double = 0.15,
        val cloudCover: Double = 0.45,
        val moonPhase: Double = 0.20,
        val humidity: Double = 0.08,
        val visibility: Double = 0.07,
        val precipitation: Double = 0.05
    )

    private val weights = Weights()

    // ─── Individual scorers ───

    private fun scoreCloud(pct: Double?): Int {
        if (pct == null) return 50
        return max(0.0, min(100.0, 100.0 - pct)).roundToInt()
    }

    private fun scoreMoonPhase(phase: Double): Int =
        (100.0 - phase * 100.0).roundToInt()

    private fun scoreBortle(bortleClass: Int): Int =
        max(0.0, 100.0 - (bortleClass - 1) * 12.5).roundToInt()

    private fun scoreHumidity(h: Double?): Int {
        if (h == null) return 50
        if (h <= 40.0) return 100
        if (h >= 90.0) return 0
        return ((90.0 - h) / 50.0 * 100.0).roundToInt()
    }

    private fun scoreVisibility(v: Double?): Int {
        if (v == null) return 50
        if (v >= 24000.0) return 100
        if (v <= 1000.0) return 0
        return ((v - 1000.0) / 23000.0 * 100.0).roundToInt()
    }

    private fun scorePrecip(p: Double?): Int {
        if (p == null) return 75
        if (p <= 0.0) return 100
        if (p >= 50.0) return 0
        return ((50.0 - p) / 50.0 * 100.0).roundToInt()
    }

    // ─── Hourly score ───

    fun calculateHourlyScore(
        hourData: HourlyWeather,
        moonPhase: Double,
        bortleClass: Int = 5
    ): Int {
        val cloudPct = hourData.cloudCover ?: 50.0

        val scores = mapOf(
            "bortle" to scoreBortle(bortleClass).toDouble(),
            "cloudCover" to scoreCloud(hourData.cloudCover).toDouble(),
            "moonPhase" to scoreMoonPhase(moonPhase).toDouble(),
            "humidity" to scoreHumidity(hourData.humidity).toDouble(),
            "visibility" to scoreVisibility(hourData.visibility).toDouble(),
            "precipitation" to scorePrecip(hourData.precipitationProbability).toDouble()
        )

        var totalScore = 0.0
        totalScore += scores["bortle"]!! * weights.bortle
        totalScore += scores["cloudCover"]!! * weights.cloudCover
        totalScore += scores["moonPhase"]!! * weights.moonPhase
        totalScore += scores["humidity"]!! * weights.humidity
        totalScore += scores["visibility"]!! * weights.visibility
        totalScore += scores["precipitation"]!! * weights.precipitation

        // Heavy cloud / rain penalties only when skies actually cloudy
        if (cloudPct > 80) totalScore *= 0.35
        else if (cloudPct > 60) totalScore *= 0.65

        val precip = hourData.precipitationProbability ?: 0.0
        if (precip > 50 && cloudPct > 40) totalScore *= 0.25
        else if (precip > 30 && cloudPct > 55) totalScore *= 0.5

        // Clear skies should not be dragged down by model rain probability alone
        if (hourData.cloudCover != null && hourData.cloudCover <= 15) {
            val clearBase =
                scores["cloudCover"]!! * weights.cloudCover +
                scores["moonPhase"]!! * weights.moonPhase +
                scores["bortle"]!! * weights.bortle +
                scores["humidity"]!! * weights.humidity +
                scores["visibility"]!! * weights.visibility +
                scores["precipitation"]!! * weights.precipitation
            totalScore = max(totalScore, clearBase)
        }

        return max(0.0, min(100.0, totalScore)).roundToInt()
    }

    // ─── Helpers ───

    private fun avg(arr: List<HourlyWeather>, key: (HourlyWeather) -> Double?): Int? {
        val vals = arr.mapNotNull(key)
        return if (vals.isEmpty()) null else vals.average().roundToInt()
    }

    private fun isNight(h: HourlyWeather): Boolean = h.isDay == 0

    private data class SunsetSunrise(val sunset: Instant, val sunrise: Instant)

    // ─── Calculate all night scores ───

    fun calculateAllScores(
        weatherData: WeatherResponse,
        bortleClass: Int = 5,
        observedCloudPct: Double? = null
    ): List<NightScore> {
        val hourly = weatherData.hourly
        val daily = weatherData.daily
        if (hourly.isEmpty() || daily.isEmpty()) return emptyList()

        val correctedHourly = if (observedCloudPct != null) {
            applyCloudBias(hourly, observedCloudPct)
        } else hourly

        val scores = mutableListOf<NightScore>()
        val today = ZonedDateTime.now().toLocalDate()

        for (i in 0 until daily.size - 1) {
            val day = daily[i]
            val next = daily[i + 1]
            val dayDate = runCatching {
                ZonedDateTime.parse(day.date + "T00:00:00Z")
            }.getOrNull()?.toLocalDate() ?: continue

            if (dayDate.isBefore(today) && dayDate != today) continue
            if (day.sunset == null || next.sunrise == null) continue

            val sunsetInstant = runCatching { Instant.parse(day.sunset) }.getOrNull() ?: continue
            val sunriseInstant = runCatching { Instant.parse(next.sunrise) }.getOrNull() ?: continue

            val nightHrs = correctedHourly.filter { h ->
                val t = runCatching { Instant.parse(h.time) }.getOrNull() ?: return@filter false
                !t.isBefore(sunsetInstant) && t.isBefore(sunriseInstant) && isNight(h)
            }
            if (nightHrs.isEmpty()) continue

            val hourlyScores = nightHrs.map { calculateHourlyScore(it, day.moonPhase, bortleClass) }
            val bestIdx = hourlyScores.indexOf(hourlyScores.maxOrNull() ?: 0)
            val avgScore = hourlyScores.average().roundToInt()
            val bestScore = hourlyScores.getOrElse(bestIdx) { avgScore }
            val avgCloud = avg(nightHrs) { it.cloudCover }

            val displayScore = if (avgCloud != null && avgCloud <= 20) max(avgScore, bestScore) else avgScore

            scores.add(
                NightScore(
                    date = day.date,
                    dayOfWeek = dayDate.dayOfWeek.toString().take(3),
                    dayOfMonth = dayDate.dayOfMonth,
                    month = dayDate.month.toString().take(3),
                    score = displayScore,
                    rating = getScoreRating(displayScore),
                    ratingColor = getScoreColor(displayScore),

                    cloudCoverScore = scoreCloud(avgCloud?.toDouble()),
                    moonPhaseScore = scoreMoonPhase(day.moonPhase),
                    humidityScore = scoreHumidity(avg(nightHrs) { it.humidity }?.toDouble()),
                    visibilityScore = scoreVisibility(avg(nightHrs) { it.visibility }?.toDouble()),
                    precipScore = scorePrecip(avg(nightHrs) { it.precipitationProbability }?.toDouble()),

                    avgCloudCover = avgCloud,
                    avgHumidity = avg(nightHrs) { it.humidity },
                    avgVisibility = avg(nightHrs) { it.visibility },
                    avgPrecipProb = avg(nightHrs) { it.precipitationProbability },
                    avgWindSpeed = avg(nightHrs) { it.windSpeed },

                    moonPhase = day.moonPhase,
                    moonPhaseName = day.moonPhaseName,
                    moonPhaseIcon = day.moonPhaseIcon,

                    tempMax = day.tempMax,
                    tempMin = day.tempMin,
                    sunset = day.sunset,
                    sunrise = next.sunrise,

                    bestViewingTime = nightHrs.getOrNull(bestIdx)?.time,
                    bestViewingScore = bestScore,

                    hourlyScores = nightHrs.mapIndexed { idx, h ->
                        HourlyScore(
                            time = h.time,
                            score = hourlyScores[idx],
                            cloudCover = h.cloudCover,
                            cloudCoverLow = h.cloudCoverLow,
                            cloudCoverMid = h.cloudCoverMid,
                            cloudCoverHigh = h.cloudCoverHigh,
                            humidity = h.humidity,
                            visibility = h.visibility
                        )
                    }
                )
            )
        }
        return scores
    }

    fun findBestNight(scores: List<NightScore>): NightScore? =
        scores.maxByOrNull { it.score }

    // ─── Cloud bias correction ───

    private fun applyCloudBias(
        hourly: List<HourlyWeather>,
        observedPct: Double
    ): List<HourlyWeather> {
        if (hourly.isEmpty()) return hourly
        val modelNow = hourly.firstOrNull()?.cloudCover ?: return hourly
        if (modelNow == null) return hourly
        val bias = observedPct - modelNow
        if (abs(bias) < 5.0) return hourly

        return hourly.map { h ->
            h.copy(
                cloudCover = h.cloudCover?.let { max(0.0, min(100.0, it + bias)) },
                cloudCoverLow = h.cloudCoverLow?.let { max(0.0, min(100.0, it + bias)) },
                cloudCoverMid = h.cloudCoverMid?.let { max(0.0, min(100.0, it + bias)) },
                cloudCoverHigh = h.cloudCoverHigh?.let { max(0.0, min(100.0, it + bias)) }
            )
        }
    }
}
